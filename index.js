const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const fs = require('fs-extra');
const config = require('./config.json');
const http = require('http');
const { Server } = require('socket.io');

// Initialize apps
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// ===== FIXED SOCKET.IO CONFIGURATION =====
const io = new Server(server, {
  cors: { 
    origin: "*" 
  },
  transports: ['polling', 'websocket'],
  allowUpgrades: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false
});

// Track online users
const onlineUsers = new Map();
const onlineStatusTimeout = 180000;

// Global setup
global.GoatBot = { config };
global.utils = {
  log: {
    info: (...args) => console.log("[INFO]", ...args),
    err: (...args) => console.error("[ERROR]", ...args)
  },
  getText: () => "✅ Bot is running smoothly"
};

// Initialize Supabase
const supabase = createClient(
  'https://rqissetffrnkfzfgsngm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXNzZXRmZnJua2Z6ZmdzbmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxNzU2NzIsImV4cCI6MjA3NDc1MTY3Mn0.6tCuI4yhn3EXlua9na4kkgMqX6PL00GxjEuY0QG2bTg',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false
    }
  }
);

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

// Render-specific configuration
const isRender = process.env.RENDER === 'true';
const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ===== ENHANCED USER AUTHENTICATION SYSTEM =====

// Simple password hashing function
function simpleHash(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

// Initialize users table if it doesn't exist
async function initializeUsersTable() {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .limit(1);

    if (error && error.code === '42P01') {
      console.log('⚠️ Users table does not exist. Please create it in Supabase.');
      console.log('📋 SQL to create users table:');
      console.log(`
        CREATE TABLE IF NOT EXISTS users (
          id BIGSERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_login TIMESTAMPTZ DEFAULT NOW()
        );
        
        CREATE TABLE IF NOT EXISTS user_profiles (
          id BIGSERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          firstname VARCHAR(100),
          lastname VARCHAR(100),
          bio TEXT,
          age INTEGER,
          gender VARCHAR(50),
          location VARCHAR(100),
          interests TEXT,
          avatar TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
    } else if (!error) {
      console.log('✅ Users table exists');
    }
  } catch (error) {
    console.error('❌ Error checking users table:', error);
  }
}

// Call initialization
initializeUsersTable();

// ===== AUTHENTICATION ENDPOINTS =====

// User registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Username and password are required" 
      });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ 
        success: false, 
        error: "Username must be between 3-20 characters" 
      });
    }

    if (password.length < 4 || password.length > 20) {
      return res.status(400).json({ 
        success: false, 
        error: "Password must be between 4-20 characters" 
      });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ 
        success: false, 
        error: "Username can only contain letters, numbers, and underscores" 
      });
    }

    // Check if username already exists
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('username')
      .ilike('username', username);

    if (checkError) {
      console.error('❌ Database error checking username:', checkError);
      return res.status(500).json({ 
        success: false, 
        error: "Database error" 
      });
    }

    if (existingUsers && existingUsers.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: "Username already exists" 
      });
    }

    // Simple password hashing
    const hashedPassword = simpleHash(password);

    // Create user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([
        { 
          username: username.trim(),
          password_hash: hashedPassword,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString()
        }
      ])
      .select();

    if (createError) {
      console.error('❌ Database error creating user:', createError);
      return res.status(500).json({ 
        success: false, 
        error: "Failed to create user" 
      });
    }

    // Generate a simple token for persistent login
    const userToken = generateUserToken(username);
    
    res.status(201).json({ 
      success: true, 
      message: "User registered successfully",
      username: username,
      user_id: newUser[0].id,
      token: userToken
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// User login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Username and password are required" 
      });
    }

    // Find user
    const { data: users, error: findError } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .limit(1);

    if (findError) {
      console.error('❌ Database error finding user:', findError);
      return res.status(500).json({ 
        success: false, 
        error: "Database error" 
      });
    }

    if (!users || users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid username or password" 
      });
    }

    const user = users[0];

    // Verify password with simple hash
    const isPasswordValid = simpleHash(password) === user.password_hash;
    
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid username or password" 
      });
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Generate a token for persistent login
    const userToken = generateUserToken(username);

    res.json({ 
      success: true, 
      message: "Login successful",
      username: user.username,
      user_id: user.id,
      token: userToken
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// Simple token generation function
function generateUserToken(username) {
  const timestamp = Date.now();
  return Buffer.from(`${username}:${timestamp}`).toString('base64');
}

// Token verification middleware - FIXED VERSION
function verifyToken(req, res, next) {
  console.log('🔐 Checking authentication...');
  
  // Check for token in Authorization header
  const authHeader = req.headers.authorization;
  console.log('📋 Authorization header:', authHeader ? 'Present' : 'Missing');
  
  if (!authHeader) {
    console.log('❌ No Authorization header found');
    return res.status(401).json({ 
      success: false, 
      error: "Authentication token required" 
    });
  }

  // Extract token
  const token = authHeader.replace('Bearer ', '').trim();
  
  if (!token) {
    console.log('❌ No token found in Authorization header');
    return res.status(401).json({ 
      success: false, 
      error: "Authentication token required" 
    });
  }

  try {
    // Decode token
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    console.log('🔍 Decoded token:', decoded);
    
    const [username, timestamp] = decoded.split(':');
    
    if (!username || !timestamp) {
      console.log('❌ Invalid token format');
      return res.status(401).json({ 
        success: false, 
        error: "Invalid token format" 
      });
    }
    
    // Check if token is not too old (30 days)
    const tokenAge = Date.now() - parseInt(timestamp);
    const maxTokenAge = 30 * 24 * 60 * 60 * 1000;
    
    if (tokenAge > maxTokenAge) {
      console.log('❌ Token expired');
      return res.status(401).json({ 
        success: false, 
        error: "Token expired" 
      });
    }
    
    req.user = { username };
    console.log('✅ Token verified for user:', username);
    next();
  } catch (error) {
    console.error('❌ Token verification error:', error);
    return res.status(401).json({ 
      success: false, 
      error: "Invalid token" 
    });
  }
}

// Check username availability
app.post('/api/check-username', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.json({ available: true });
    }

    const { data: existingUsers, error } = await supabase
      .from('users')
      .select('username')
      .ilike('username', username)
      .limit(1);

    if (error) {
      console.error('❌ Database error checking username:', error);
      return res.status(500).json({ 
        success: false, 
        error: "Database error" 
      });
    }

    const available = !existingUsers || existingUsers.length === 0;
    
    res.json({ 
      available: available,
      suggestion: available ? null : "Username is already taken"
    });

  } catch (error) {
    console.error('❌ Check username error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// ===== COMPLETELY FIXED PROFILE ENDPOINTS =====

// Get user profile - WORKING VERSION
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    console.log('🔐 Profile request received for user:', req.user.username);
    
    const username = req.user.username;
    
    if (!username) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid token: no username found" 
      });
    }
    
    // First check if user_profiles table exists
    let tableExists = true;
    try {
      const { error: tableError } = await supabase
        .from('user_profiles')
        .select('username')
        .limit(1);
      
      if (tableError && tableError.code === '42P01') {
        tableExists = false;
        console.log('⚠️ user_profiles table does not exist');
      }
    } catch (tableError) {
      tableExists = false;
    }

    if (!tableExists) {
      // Return default profile with instructions
      const defaultProfile = {
        username: username,
        firstname: '',
        lastname: '',
        bio: '',
        age: null,
        gender: '',
        location: '',
        interests: '',
        avatar: `https://i.pravatar.cc/150?u=${username}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      return res.json({ 
        success: true,
        profile: defaultProfile,
        message: "Using default profile (table not found)",
        instructions: "Visit /api/create-user-profiles-table to create the profile table"
      });
    }

    // Try to get the profile
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('username', username)
      .limit(1);

    if (error) {
      console.error('❌ Database query error:', error);
      
      // Return default profile on error
      const defaultProfile = {
        username: username,
        firstname: '',
        lastname: '',
        bio: '',
        age: null,
        gender: '',
        location: '',
        interests: '',
        avatar: `https://i.pravatar.cc/150?u=${username}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      return res.json({ 
        success: true,
        profile: defaultProfile,
        message: "Using default profile (database error)",
        error: error.message
      });
    }

    if (!profiles || profiles.length === 0) {
      // Return default profile if none exists
      const defaultProfile = {
        username: username,
        firstname: '',
        lastname: '',
        bio: '',
        age: null,
        gender: '',
        location: '',
        interests: '',
        avatar: `https://i.pravatar.cc/150?u=${username}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      return res.json({ 
        success: true,
        profile: defaultProfile,
        message: "Using default profile (no existing profile)"
      });
    }

    // Ensure all fields are present
    const profile = profiles[0];
    const completeProfile = {
      username: profile.username || username,
      firstname: profile.firstname || '',
      lastname: profile.lastname || '',
      bio: profile.bio || '',
      age: profile.age || null,
      gender: profile.gender || '',
      location: profile.location || '',
      interests: profile.interests || '',
      avatar: profile.avatar || `https://i.pravatar.cc/150?u=${username}`,
      created_at: profile.created_at || new Date().toISOString(),
      updated_at: profile.updated_at || new Date().toISOString()
    };

    console.log('✅ Profile loaded successfully for:', username);
    res.json({ 
      success: true,
      profile: completeProfile
    });

  } catch (error) {
    console.error('❌ Get profile error:', error);
    
    // Even on error, try to return a default profile
    const username = req.user?.username || 'unknown';
    const defaultProfile = {
      username: username,
      firstname: '',
      lastname: '',
      bio: '',
      age: null,
      gender: '',
      location: '',
      interests: '',
      avatar: `https://i.pravatar.cc/150?u=${username}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    res.json({ 
      success: true,
      profile: defaultProfile,
      error: "Server error but returning default profile"
    });
  }
});

// Update user profile - WORKING VERSION
app.put('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    const profileData = req.body;

    console.log('💾 Saving profile for:', username);
    console.log('📝 Profile data:', JSON.stringify(profileData, null, 2));

    if (!username) {
      return res.status(400).json({ 
        success: false, 
        error: "Username is required" 
      });
    }

    // First check if table exists
    let tableExists = true;
    try {
      const { error: tableError } = await supabase
        .from('user_profiles')
        .select('username')
        .limit(1);
      
      if (tableError && tableError.code === '42P01') {
        tableExists = false;
        console.log('⚠️ user_profiles table does not exist');
        return res.status(500).json({ 
          success: false, 
          error: "Profile table does not exist.",
          instructions: "Visit /api/create-user-profiles-table to create the table"
        });
      }
    } catch (tableError) {
      tableExists = false;
    }

    if (!tableExists) {
      return res.status(500).json({ 
        success: false, 
        error: "Profile table does not exist.",
        instructions: "Visit /api/create-user-profiles-table to create the table"
      });
    }

    // Check if profile exists
    const { data: existingProfiles, error: checkError } = await supabase
      .from('user_profiles')
      .select('id, username')
      .eq('username', username)
      .limit(1);

    if (checkError) {
      console.error('❌ Database error checking profile:', checkError);
      return res.status(500).json({ 
        success: false, 
        error: "Database error: " + checkError.message 
      });
    }

    let result;
    const now = new Date().toISOString();
    const avatarUrl = profileData.avatar || `https://i.pravatar.cc/150?u=${username}`;
    
    if (existingProfiles && existingProfiles.length > 0) {
      // Update existing profile
      result = await supabase
        .from('user_profiles')
        .update({
          firstname: profileData.firstname || '',
          lastname: profileData.lastname || '',
          bio: profileData.bio || '',
          age: profileData.age || null,
          gender: profileData.gender || '',
          location: profileData.location || '',
          interests: profileData.interests || '',
          avatar: avatarUrl,
          updated_at: now
        })
        .eq('username', username)
        .select();
    } else {
      // Create new profile
      result = await supabase
        .from('user_profiles')
        .insert([
          {
            username: username,
            firstname: profileData.firstname || '',
            lastname: profileData.lastname || '',
            bio: profileData.bio || '',
            age: profileData.age || null,
            gender: profileData.gender || '',
            location: profileData.location || '',
            interests: profileData.interests || '',
            avatar: avatarUrl,
            created_at: now,
            updated_at: now
          }
        ])
        .select();
    }

    if (result.error) {
      console.error('❌ Database error saving profile:', result.error);
      return res.status(500).json({ 
        success: false, 
        error: "Failed to save profile: " + result.error.message
      });
    }

    console.log('✅ Profile saved successfully for:', username);
    
    // Ensure we return a complete profile
    const savedProfile = result.data[0];
    const completeProfile = {
      username: savedProfile.username || username,
      firstname: savedProfile.firstname || '',
      lastname: savedProfile.lastname || '',
      bio: savedProfile.bio || '',
      age: savedProfile.age || null,
      gender: savedProfile.gender || '',
      location: savedProfile.location || '',
      interests: savedProfile.interests || '',
      avatar: savedProfile.avatar || avatarUrl,
      created_at: savedProfile.created_at || now,
      updated_at: savedProfile.updated_at || now
    };
    
    res.json({ 
      success: true, 
      message: "Profile updated successfully",
      profile: completeProfile
    });

  } catch (error) {
    console.error('❌ Update profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error: " + error.message
    });
  }
});

// Create user_profiles table if it doesn't exist
app.get('/api/create-user-profiles-table', async (req, res) => {
  try {
    console.log('🔧 Checking user_profiles table...');
    
    const { data: tableCheck, error: checkError } = await supabase
      .from('user_profiles')
      .select('*')
      .limit(1);

    if (checkError && checkError.code === '42P01') {
      res.json({
        success: false,
        error: "Table doesn't exist",
        instructions: [
          "1. Go to your Supabase dashboard",
          "2. Go to the SQL Editor",
          "3. Run this SQL to create the table:",
          `
          CREATE TABLE IF NOT EXISTS user_profiles (
            id BIGSERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            firstname VARCHAR(100),
            lastname VARCHAR(100),
            bio TEXT,
            age INTEGER,
            gender VARCHAR(50),
            location VARCHAR(100),
            interests TEXT,
            avatar TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          );
          `,
          "4. Enable RLS if needed",
          "5. Add policies for users to read/write their own profiles"
        ]
      });
    } else if (checkError) {
      throw checkError;
    } else {
      console.log('✅ user_profiles table exists');
      res.json({
        success: true,
        message: "user_profiles table exists",
        sampleData: tableCheck?.[0],
        rowCount: tableCheck?.length || 0
      });
    }

  } catch (error) {
    console.error('❌ Error checking table:', error);
    res.status(500).json({ 
      success: false,
      error: "Error checking table: " + error.message 
    });
  }
});

// Test profile endpoint without authentication
app.get('/api/test-profile', async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username) {
      return res.status(400).json({ 
        success: false, 
        error: "Username query parameter is required" 
      });
    }
    
    console.log('🧪 Test profile endpoint for:', username);
    
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('username', username)
      .limit(1);

    if (error) {
      console.error('❌ Database error:', error);
      return res.status(500).json({ 
        success: false, 
        error: "Database error: " + error.message
      });
    }

    if (!profiles || profiles.length === 0) {
      return res.json({ 
        success: true,
        message: "No profile found for user",
        username: username,
        defaultProfile: {
          username: username,
          firstname: '',
          lastname: '',
          bio: '',
          age: null,
          gender: '',
          location: '',
          interests: '',
          avatar: `https://i.pravatar.cc/150?u=${username}`
        }
      });
    }

    console.log('✅ Found profile:', profiles[0]);
    res.json({ 
      success: true,
      profile: profiles[0]
    });

  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error: " + error.message
    });
  }
});

// Get user profile by username (public access)
app.get('/api/user/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
    console.log('📋 Loading public profile for user:', username);

    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('username', username)
      .limit(1);

    if (error) {
      console.error('❌ Database error fetching profile:', error);
      if (error.code === '42P01') {
        const defaultProfile = {
          username: username,
          firstname: '',
          lastname: '',
          bio: '',
          age: null,
          gender: '',
          location: '',
          interests: '',
          avatar: `https://i.pravatar.cc/150?u=${username}`
        };
        return res.json({ 
          success: true,
          profile: defaultProfile,
          message: "Using default profile (table not found)"
        });
      }
      return res.status(500).json({ 
        success: false, 
        error: "Database error" 
      });
    }

    if (!profiles || profiles.length === 0) {
      const defaultProfile = {
        username: username,
        firstname: '',
        lastname: '',
        bio: '',
        age: null,
        gender: '',
        location: '',
        interests: '',
        avatar: `https://i.pravatar.cc/150?u=${username}`
      };
      return res.json({ 
        success: true,
        profile: defaultProfile
      });
    }

    res.json({ 
      success: true,
      profile: profiles[0]
    });

  } catch (error) {
    console.error('❌ Get user profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// ===== ADDITIONAL AUTH ENDPOINTS =====

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Username and password are required" 
      });
    }

    // Check if username already exists
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('username')
      .ilike('username', username);

    if (checkError) {
      console.error('❌ Database error checking username:', checkError);
      return res.status(500).json({ 
        success: false, 
        error: "Database error" 
      });
    }

    if (existingUsers && existingUsers.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: "Username already exists" 
      });
    }

    // Simple password hashing
    const hashedPassword = simpleHash(password);

    // Create user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([
        { 
          username: username.trim(),
          password_hash: hashedPassword,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString()
        }
      ])
      .select();

    if (createError) {
      console.error('❌ Database error creating user:', createError);
      return res.status(500).json({ 
        success: false, 
        error: "Failed to create user" 
      });
    }
    
    const userToken = generateUserToken(username);
    
    res.status(201).json({ 
      success: true, 
      message: "User registered successfully",
      username: username,
      user_id: newUser[0].id,
      token: userToken
    });

  } catch (error) {
    console.error('❌ Auth registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        error: "Username and password are required" 
      });
    }

    const { data: users, error: findError } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .limit(1);

    if (findError) {
      console.error('❌ Database error finding user:', findError);
      return res.status(500).json({ 
        success: false, 
        error: "Database error" 
      });
    }

    if (!users || users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid username or password" 
      });
    }

    const user = users[0];
    const isPasswordValid = simpleHash(password) === user.password_hash;
    
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid username or password" 
      });
    }

    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    const userToken = generateUserToken(username);

    res.json({ 
      success: true, 
      message: "Login successful",
      username: user.username,
      user_id: user.id,
      token: userToken
    });

  } catch (error) {
    console.error('❌ Auth login error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

app.post('/api/auth/auto-login', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;

    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .limit(1);

    if (error || !users || users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: "User not found" 
      });
    }

    const user = users[0];

    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    res.json({ 
      success: true, 
      message: "Auto-login successful",
      username: user.username,
      user_id: user.id
    });

  } catch (error) {
    console.error('❌ Auto-login error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// ===== AI ENDPOINTS =====

app.post('/api/ai/private', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await axios.get(
      `https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(message)}&cb=${Date.now()}`,
      { 
        headers: { 
          Accept: "application/json",
          "User-Agent": "GoatBot/1.0"
        },
        timeout: 15000,
        validateStatus: () => true
      }
    );

    let responseData;
    let aiResponse;

    if (typeof response.data === 'string') {
      try {
        responseData = JSON.parse(response.data);
      } catch (e) {
        if (response.data.includes('error') || response.status !== 200) {
          throw new Error(response.data || `API returned status ${response.status}`);
        }
        aiResponse = response.data;
      }
    } else {
      responseData = response.data;
    }

    if (!aiResponse) {
      if (responseData.response) {
        aiResponse = responseData.response;
      } else if (responseData.message) {
        aiResponse = responseData.message;
      } else if (responseData.data) {
        aiResponse = responseData.data;
      } else {
        aiResponse = JSON.stringify(responseData) || "⚠️ No recognizable response format";
      }
    }

    res.json({ reply: aiResponse });
  } catch (error) {
    console.error("❌ Private AI Error:", error);
    res.status(500).json({ error: `Private AI Error: ${error.message}` });
  }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const response = await axios.get(
      `https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(message)}&cb=${Date.now()}`,
      { 
        headers: { 
          Accept: "application/json",
          "User-Agent": "GoatBot/1.0"
        },
        timeout: 15000,
        validateStatus: () => true
      }
    );

    let responseData;
    let aiResponse;

    if (typeof response.data === 'string') {
      try {
        responseData = JSON.parse(response.data);
      } catch (e) {
        if (response.data.includes('error') || response.status !== 200) {
          throw new Error(response.data || `API returned status ${response.status}`);
        }
        aiResponse = response.data;
      }
    } else {
      responseData = response.data;
    }

    if (!aiResponse) {
      if (responseData.response) {
        aiResponse = responseData.response;
      } else if (responseData.message) {
        aiResponse = responseData.message;
      } else if (responseData.data) {
        aiResponse = responseData.data;
      } else {
        aiResponse = JSON.stringify(responseData) || "⚠️ No recognizable response format";
      }
    }

    res.json({ reply: aiResponse });
  } catch (error) {
    console.error("❌ Main AI Error:", error);
    res.status(500).json({ error: `Main AI Error: ${error.message}` });
  }
});

// ===== MESSAGES ENDPOINTS =====

app.get('/api/messages', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chatter')
      .select('id, content, username, created_at, image_url, reply_to')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { content, username, image_url, reply_to } = req.body;

    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ error: "Content or image is required" });
    }

    if (!username || username.trim() === '') {
      return res.status(400).json({ error: "Username is required" });
    }

    const insertData = {
      content: (content && content.trim() !== '') ? content.trim() : '',
      username: username.trim(),
      image_url: image_url || '',
      reply_to: reply_to || ''
    };

    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Database insert error:', error);
      
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        const minimalData = {
          content: (content && content.trim() !== '') ? content.trim() : 'Message',
          username: username.trim()
        };
        
        const { data: retryData, error: retryError } = await supabase
          .from('chatter')
          .insert([minimalData])
          .select();
          
        if (retryError) {
          throw retryError;
        }
        
        io.emit('new-message', retryData[0]);
        return res.status(201).json(retryData[0]);
      }
      throw error;
    }
    
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save message via API:', error);
    res.status(500).json({ error: "Failed to save message: " + error.message });
  }
});

app.delete('/api/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('chatter')
      .delete()
      .eq('id', id);

    if (error) throw error;
    
    io.emit('message-deleted', id);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// ===== TEST ENDPOINTS =====

app.get('/api/auth-test', (req, res) => {
  res.json({
    message: "✅ Authentication endpoints are working!",
    timestamp: new Date().toISOString(),
    endpoints: [
      {
        method: "POST",
        path: "/api/register",
        description: "Register a new user"
      },
      {
        method: "POST",
        path: "/api/login",
        description: "Login user"
      },
      {
        method: "GET",
        path: "/api/user/profile",
        description: "Get user profile (requires auth)"
      },
      {
        method: "PUT",
        path: "/api/user/profile",
        description: "Update user profile (requires auth)"
      }
    ]
  });
});

// ===== SOCKET.IO HANDLING =====

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  socket.on('request-messages', async () => {
    try {
      const { data, error } = await supabase
        .from('chatter')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (!error && data) {
        socket.emit('chat-messages', data.reverse());
      }
    } catch (error) {
      console.error('Error sending messages to client:', error);
    }
  });

  socket.on('user-online', (username) => {
    if (username) {
      console.log('👤 User online:', username);
      
      onlineUsers.set(username, {
        socketId: socket.id,
        username: username,
        lastSeen: Date.now(),
        isOnline: true
      });
      
      const onlineUsersArray = Array.from(onlineUsers.keys());
      
      io.emit('user-status-change', { 
        username, 
        status: 'online',
        onlineUsers: onlineUsersArray
      });
    }
  });

  socket.on('user-offline', (username) => {
    if (username) {
      console.log('🔴 User offline:', username);
      removeUserFromOnlineList(username);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 User disconnected:', socket.id, 'Reason:', reason);
    
    let foundUsername = null;
    for (let [username, data] of onlineUsers.entries()) {
      if (data.socketId === socket.id) {
        foundUsername = username;
        data.lastSeen = Date.now();
        data.isOnline = false;
        break;
      }
    }
    
    if (foundUsername) {
      io.emit('user-status-change', { 
        username: foundUsername, 
        status: 'away',
        onlineUsers: Array.from(onlineUsers.keys())
      });
    }
  });
  
  function removeUserFromOnlineList(username) {
    if (onlineUsers.has(username)) {
      onlineUsers.delete(username);
      
      const onlineUsersArray = Array.from(onlineUsers.keys());
      
      io.emit('user-status-change', { 
        username, 
        status: 'offline',
        onlineUsers: onlineUsersArray
      });
    }
  }
});

// 3 MINUTE CLEANUP
setInterval(() => {
  const now = Date.now();
  const removedUsers = [];
  
  for (let [username, data] of onlineUsers.entries()) {
    if (now - data.lastSeen > onlineStatusTimeout) {
      console.log('⏰ Removing inactive user (3 minutes):', username);
      onlineUsers.delete(username);
      removedUsers.push(username);
    }
  }
  
  if (removedUsers.length > 0) {
    const onlineUsersArray = Array.from(onlineUsers.keys());
    removedUsers.forEach(username => {
      io.emit('user-status-change', { 
        username, 
        status: 'offline',
        onlineUsers: onlineUsersArray
      });
    });
  }
}, 30000);

// ===== BASIC ENDPOINTS =====

app.get('/online-users', (req, res) => {
  const onlineUsersArray = Array.from(onlineUsers.keys());
  res.json(onlineUsersArray);
});

app.get('/health', (req, res) => {
  res.json({
    status: "healthy",
    version: '1.0.0',
    node: process.version,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development"
  });
});

app.get('/uptime', (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// ===== COMMAND HANDLING =====

const COMMANDS_DIR = path.join(__dirname, "commands");
const PREFIX = config.prefix || "!";
const commands = {};

function loadCommands() {
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(COMMANDS_DIR)) delete require.cache[key];
  });

  const commandFiles = fs.readdirSync(COMMANDS_DIR).filter(file => file.endsWith(".js"));
  commandFiles.forEach(file => {
    try {
      const cmd = require(path.join(COMMANDS_DIR, file));
      if (cmd.config?.name) {
        commands[cmd.config.name] = cmd;
        if (Array.isArray(cmd.config.aliases)) {
          cmd.config.aliases.forEach(alias => commands[alias] = cmd);
        }
        console.log(`✅ Loaded command: ${PREFIX}${cmd.config.name}`);
      }
    } catch (err) {
      console.error(`❌ Failed to load ${file}:`, err);
    }
  });
}

fs.ensureDirSync(COMMANDS_DIR);
loadCommands();

function handleCommand(input) {
  if (!input.startsWith(PREFIX)) return null;
  const args = input.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const text = args.join(" ");
  return { commandName, args, text };
}

app.post("/api/command", async (req, res) => {
  try {
    let { message, source = 'main-chat' } = req.body;
    
    if (!message) return res.status(400).json({ reply: "❌ Message is required" });

    // AUTO-PREFIX FOR PRIVATE AI
    if (source === 'private-ai' && !message.startsWith(PREFIX)) {
      const trimmedMessage = message.trim().toLowerCase();
      const firstWord = trimmedMessage.split(' ')[0];
      
      const commandWords = ['ai', 'help', 'ping', 'prefix', 'ask', 'chat'];
      
      if (commandWords.includes(firstWord)) {
        message = PREFIX + message;
      } else {
        message = PREFIX + 'ai ' + message;
      }
    }

    if (message.trim().toLowerCase() === "prefix") {
      const reply = `🔹 My command prefix is: \`${PREFIX}\``;
      return res.json({ reply });
    }

    const cmd = handleCommand(message);
    if (!cmd) {
      console.log('❌ Not a command or wrong prefix');
      return res.end();
    }

    let finalReply = null;
    let responder = null;

    // AI COMMANDS
    if (cmd.commandName === "ai") {
      responder = 'AI';
      
      try {
        const response = await axios.get(
          `https://yau-cener-gpt4-api.vercel.app/ai?prompt=${encodeURIComponent(cmd.text)}&cb=${Date.now()}`,
          { 
            headers: { 
              Accept: "application/json",
              "User-Agent": "GoatBot/1.0"
            },
            timeout: 15000,
            validateStatus: () => true
          }
        );

        let responseData;
        let aiResponse;

        if (typeof response.data === 'string') {
          try {
            responseData = JSON.parse(response.data);
          } catch (e) {
            if (response.data.includes('error') || response.status !== 200) {
              throw new Error(response.data || `API returned status ${response.status}`);
            }
            aiResponse = response.data;
          }
        } else {
          responseData = response.data;
        }

        if (!aiResponse) {
          if (responseData.response) {
            aiResponse = responseData.response;
          } else if (responseData.message) {
            aiResponse = responseData.message;
          } else if (responseData.data) {
            aiResponse = responseData.data;
          } else {
            aiResponse = JSON.stringify(responseData) || "⚠️ No recognizable response format";
          }
        }

        finalReply = aiResponse;

      } catch (aiError) {
        console.error("❌ AI Processing Error:", aiError);
        finalReply = `❌ AI Error: ${aiError.message.replace(/[\n\r]/g, ' ').substring(0, 200)}`;
      }
    } 
    // BOT COMMANDS
    else {
      responder = 'Bot';
      
      const command = commands[cmd.commandName];
      if (!command) {
        finalReply = "❌ Command not found";
      } else if (typeof command.onStart !== "function") {
        finalReply = "❌ This command does not support execution";
      } else {
        const replies = [];
        await command.onStart({
          api: {
            sendMessage: (msg) => replies.push(typeof msg === "string" ? msg : JSON.stringify(msg))
          },
          event: { body: cmd.text },
          args: cmd.args,
          message: {
            reply: (content) => replies.push(content)
          }
        });

        if (replies.length > 0) {
          finalReply = replies.length === 1 ? replies[0] : replies.join('\n');
        } else {
          finalReply = "❌ Command executed but no response generated";
        }
      }
    }

    if (finalReply) {
      return res.json({ reply: finalReply });
    } else {
      return res.json({ reply: "❌ No response generated" });
    }

  } catch (error) {
    console.error("❌ Server Error:", error);
    res.status(500).json({ reply: `❌ Server Error: ${error.message}` });
  }
});

// ===== SERVER START =====

server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🔹 Command prefix: "${PREFIX}"`);
  console.log(`🔐 Profile endpoints:`);
  console.log(`   GET /api/user/profile - Get profile (requires auth)`);
  console.log(`   PUT /api/user/profile - Update profile (requires auth)`);
  console.log(`   GET /api/user/profile/:username - Get public profile`);
  console.log(`   GET /api/test-profile?username=X - Test profile endpoint`);
  console.log(`🔐 Auth endpoints:`);
  console.log(`   POST /api/register - Register`);
  console.log(`   POST /api/login - Login`);
  console.log(`   POST /api/auth/register - Register (client-compatible)`);
  console.log(`   POST /api/auth/login - Login (client-compatible)`);
  console.log(`📝 Table setup:`);
  console.log(`   GET /api/create-user-profiles-table - Create profile table`);
  console.log(`🌐 Health check:`);
  console.log(`   GET /health - Server health`);
  console.log(`   GET /uptime - Uptime status`);
  
  if (isRender && renderExternalUrl) {
    console.log(`🌐 Render External URL: ${renderExternalUrl}`);
    console.log(`🔐 Test profile: ${renderExternalUrl}/api/test-profile?username=test`);
    console.log(`🔐 Create table: ${renderExternalUrl}/api/create-user-profiles-table`);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Export for testing
module.exports = { app, server, io, supabase };
