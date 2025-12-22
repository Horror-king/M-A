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

// ===== FIXED SOCKET.IO CONFIGURATION FOR OPERA =====
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

// Track online users - 3 MINUTE TIMEOUT
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
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
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
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          email VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_login TIMESTAMPTZ DEFAULT NOW(),
          is_active BOOLEAN DEFAULT TRUE
        );
        
        CREATE TABLE IF NOT EXISTS user_profiles (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          username TEXT UNIQUE NOT NULL,
          display_name TEXT,
          avatar_url TEXT,
          bio TEXT,
          location VARCHAR(100),
          website TEXT,
          social_links JSONB DEFAULT '{}'::jsonb,
          preferences JSONB DEFAULT '{
            "theme": "light",
            "privacy": "public",
            "language": "en",
            "soundEnabled": true,
            "notifications": true
          }'::jsonb,
          message_count INTEGER DEFAULT 0,
          last_active TIMESTAMPTZ DEFAULT NOW(),
          status VARCHAR(20) DEFAULT 'online',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          firstname VARCHAR(100),
          lastname VARCHAR(100),
          age INTEGER,
          gender VARCHAR(50),
          interests TEXT
        );
      `);
    } else if (!error) {
      console.log('✅ Users table exists');
    }
  } catch (error) {
    console.error('❌ Error checking users table:', error);
  }
}

initializeUsersTable();

// ===== AUTHENTICATION ENDPOINTS =====
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    console.log('📝 Registration attempt:', { username, email });

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

    const hashedPassword = simpleHash(password);

    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([
        { 
          username: username.trim(),
          password_hash: hashedPassword,
          email: email || null,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
          is_active: true
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

    console.log('✅ User registered successfully:', username);
    
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

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('🔐 Login attempt:', { username });

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

    console.log('✅ User logged in successfully:', username);
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

function generateUserToken(username) {
  const timestamp = Date.now();
  const data = `${username}:${timestamp}:${Math.random().toString(36).substr(2, 9)}`;
  return Buffer.from(data).toString('base64');
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  console.log('🔐 Auth header received:', authHeader ? 'Present' : 'Missing');
  
  if (!authHeader) {
    console.log('❌ No auth header found');
    return res.status(401).json({ 
      success: false, 
      error: "Authentication token required" 
    });
  }

  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    console.log('❌ Empty token after removing Bearer prefix');
    return res.status(401).json({ 
      success: false, 
      error: "Authentication token required" 
    });
  }

  try {
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    console.log('🔐 Decoded token:', decoded);
    
    const [username, timestamp] = decoded.split(':');
    
    if (!username) {
      console.log('❌ No username found in token');
      return res.status(401).json({ 
        success: false, 
        error: "Invalid token format" 
      });
    }
    
    const tokenAge = Date.now() - parseInt(timestamp);
    const maxTokenAge = 30 * 24 * 60 * 60 * 1000;
    
    if (isNaN(tokenAge) || tokenAge > maxTokenAge) {
      console.log('❌ Token expired or invalid timestamp');
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

// ===== ADD AUTH ENDPOINTS TO MATCH CLIENT EXPECTATIONS =====
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    console.log('📝 Auth Registration attempt:', { username, email });

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

    const hashedPassword = simpleHash(password);

    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([
        { 
          username: username.trim(),
          password_hash: hashedPassword,
          email: email || null,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
          is_active: true
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

    console.log('✅ User registered successfully via auth endpoint:', username);
    
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
    console.log('🔐 Auth Login attempt:', { username });

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

    console.log('✅ User logged in successfully via auth endpoint:', username);
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

app.post('/api/auth/check-username', async (req, res) => {
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
    console.error('❌ Auth check username error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

app.post('/api/auth/auto-login', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    console.log('🔄 Auto-login attempt for:', username);

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

    console.log('✅ Auto-login successful for:', username);

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

// ===== ADD GET ENDPOINTS FOR TESTING =====
app.get('/api/login', (req, res) => {
  res.status(405).json({
    success: false,
    error: "Method Not Allowed",
    message: "Use POST method for login",
    example: {
      method: "POST",
      url: "/api/login",
      body: {
        username: "your_username",
        password: "your_password"
      }
    }
  });
});

app.get('/api/register', (req, res) => {
  res.status(405).json({
    success: false,
    error: "Method Not Allowed",
    message: "Use POST method for registration",
    example: {
      method: "POST",
      url: "/api/register",
      body: {
        username: "new_username",
        password: "new_password"
      }
    }
  });
});

app.get('/api/check-username', (req, res) => {
  res.status(405).json({
    success: false,
    error: "Method Not Allowed",
    message: "Use POST method for checking username",
    example: {
      method: "POST",
      url: "/api/check-username",
      body: {
        username: "username_to_check"
      }
    }
  });
});

app.get('/api/auth-test', (req, res) => {
  res.json({
    message: "✅ Authentication endpoints are working!",
    timestamp: new Date().toISOString(),
    endpoints: [
      {
        method: "POST",
        path: "/api/register",
        description: "Register a new user",
        body: {
          username: "string (3-20 characters)",
          password: "string (4-20 characters)"
        }
      },
      {
        method: "POST",
        path: "/api/login",
        description: "Login user",
        body: {
          username: "string",
          password: "string"
        }
      },
      {
        method: "POST",
        path: "/api/check-username",
        description: "Check username availability",
        body: {
          username: "string"
        }
      },
      {
        method: "GET",
        path: "/api/user/profile/:username",
        description: "Get user profile"
      },
      {
        method: "POST",
        path: "/api/user/profile",
        description: "Update user profile",
        body: {
          username: "string",
          profileData: "object"
        }
      }
    ],
    testInstructions: [
      "1. Use POST /api/check-username to check availability",
      "2. Use POST /api/register to create account",
      "3. Use POST /api/login to authenticate",
      "4. Use GET/POST /api/user/profile to manage profile"
    ]
  });
});

// ===== FIXED PROFILE MANAGEMENT ENDPOINTS =====
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    console.log('🔐 Profile request received');
    console.log('📋 Headers:', req.headers);
    console.log('👤 User from token:', req.user);
    
    const username = req.user.username;
    
    if (!username) {
      return res.status(401).json({ 
        success: false, 
        error: "Invalid token: no username found" 
      });
    }
    
    console.log('📋 Loading profile for:', username);

    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, username, email, created_at, last_login')
      .ilike('username', username)
      .limit(1);

    if (userError || !users || users.length === 0) {
      console.error('❌ User not found:', userError);
      return res.status(404).json({ 
        success: false, 
        error: "User not found" 
      });
    }

    const user = users[0];

    const { data: profiles, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('username', username)
      .limit(1);

    let profileData;
    
    if (profileError && profileError.code === '42P01') {
      console.log('⚠️ user_profiles table does not exist, returning default profile');
      
      profileData = {
        username: username,
        firstname: '',
        lastname: '',
        bio: '',
        age: null,
        gender: '',
        location: '',
        interests: '',
        avatar_url: `https://i.pravatar.cc/150?u=${username}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        display_name: username,
        status: 'online'
      };
      
      try {
        await supabase
          .from('user_profiles')
          .insert([
            {
              user_id: user.id,
              username: username,
              display_name: username,
              avatar_url: `https://i.pravatar.cc/150?u=${username}`,
              firstname: '',
              lastname: '',
              bio: '',
              age: null,
              gender: '',
              location: '',
              interests: '',
              status: 'online'
            }
          ]);
      } catch (createError) {
        console.log('⚠️ Could not create profile, table might not exist');
      }
      
    } else if (profileError) {
      console.error('❌ Profile query error:', profileError);
      profileData = {
        username: username,
        firstname: '',
        lastname: '',
        bio: '',
        age: null,
        gender: '',
        location: '',
        interests: '',
        avatar_url: `https://i.pravatar.cc/150?u=${username}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        display_name: username,
        status: 'online'
      };
    } else if (!profiles || profiles.length === 0) {
      profileData = {
        username: username,
        firstname: '',
        lastname: '',
        bio: '',
        age: null,
        gender: '',
        location: '',
        interests: '',
        avatar_url: `https://i.pravatar.cc/150?u=${username}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        display_name: username,
        status: 'online'
      };
      
      try {
        const { data: newProfile } = await supabase
          .from('user_profiles')
          .insert([
            {
              user_id: user.id,
              username: username,
              display_name: username,
              avatar_url: `https://i.pravatar.cc/150?u=${username}`,
              firstname: '',
              lastname: '',
              bio: '',
              age: null,
              gender: '',
              location: '',
              interests: '',
              status: 'online'
            }
          ])
          .select();
          
        if (newProfile && newProfile.length > 0) {
          profileData = { ...profileData, ...newProfile[0] };
        }
      } catch (createError) {
        console.log('⚠️ Could not create profile:', createError);
      }
    } else {
      profileData = profiles[0];
    }

    const completeProfile = {
      username: username,
      email: user.email,
      user_id: user.id,
      created_at: user.created_at,
      last_login: user.last_login,
      
      firstname: profileData.firstname || '',
      lastname: profileData.lastname || '',
      bio: profileData.bio || '',
      age: profileData.age || null,
      gender: profileData.gender || '',
      location: profileData.location || '',
      interests: profileData.interests || '',
      avatar: profileData.avatar_url || `https://i.pravatar.cc/150?u=${username}`,
      display_name: profileData.display_name || username,
      status: profileData.status || 'online',
      profile_created_at: profileData.created_at || new Date().toISOString(),
      profile_updated_at: profileData.updated_at || new Date().toISOString()
    };

    console.log('✅ Profile loaded successfully');
    res.json({ 
      success: true,
      profile: completeProfile
    });

  } catch (error) {
    console.error('❌ Get profile error:', error);
    console.error('❌ Error stack:', error.stack);
    
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
      error: "Server error but returning default profile: " + error.message
    });
  }
});

app.put('/api/user/profile', verifyToken, async (req, res) => {
  await updateProfileHandler(req, res);
});

app.post('/api/user/profile', verifyToken, async (req, res) => {
  await updateProfileHandler(req, res);
});

async function updateProfileHandler(req, res) {
  try {
    const username = req.user.username;
    const profileData = req.body;

    console.log('💾 Saving profile for:', username);
    console.log('📝 Profile data received:', JSON.stringify(profileData, null, 2));

    if (!username) {
      return res.status(400).json({ 
        success: false, 
        error: "Username is required" 
      });
    }

    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id')
      .ilike('username', username)
      .limit(1);

    if (userError || !users || users.length === 0) {
      console.error('❌ User not found:', userError);
      return res.status(404).json({ 
        success: false, 
        error: "User not found" 
      });
    }

    const userId = users[0].id;

    const { data: existingProfiles, error: checkError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('username', username)
      .limit(1);

    if (checkError && checkError.code === '42P01') {
      console.log('⚠️ user_profiles table does not exist');
      return res.status(500).json({ 
        success: false, 
        error: "Profile table does not exist. Please run the database setup script.",
        instructions: "Run the SQL script provided in Supabase SQL Editor to create all tables"
      });
    }

    let result;
    const now = new Date().toISOString();
    
    const profileUpdateData = {
      username: username,
      user_id: userId,
      display_name: profileData.display_name || username,
      avatar_url: profileData.avatar || `https://i.pravatar.cc/150?u=${username}`,
      bio: profileData.bio || '',
      location: profileData.location || '',
      firstname: profileData.firstname || '',
      lastname: profileData.lastname || '',
      age: profileData.age || null,
      gender: profileData.gender || '',
      interests: profileData.interests || '',
      status: 'online',
      updated_at: now
    };

    if (existingProfiles && existingProfiles.length > 0) {
      console.log('📝 Updating existing profile for:', username);
      result = await supabase
        .from('user_profiles')
        .update(profileUpdateData)
        .eq('username', username)
        .select();
    } else {
      console.log('📝 Creating new profile for:', username);
      result = await supabase
        .from('user_profiles')
        .insert([
          {
            ...profileUpdateData,
            created_at: now
          }
        ])
        .select();
    }

    if (result.error) {
      console.error('❌ Database error saving profile:', result.error);
      
      if (result.error.code === '42P01') {
        return res.status(500).json({ 
          success: false, 
          error: "Profile table does not exist. Please run the database setup script.",
          instructions: "Run the SQL script in Supabase SQL Editor to create all tables"
        });
      }
      
      if (result.error.message.includes('column') && result.error.message.includes('does not exist')) {
        return res.status(500).json({ 
          success: false, 
          error: "Database schema mismatch. Please update your database with the new schema.",
          details: "The user_profiles table is missing required columns. Run the updated SQL script."
        });
      }
      
      return res.status(500).json({ 
        success: false, 
        error: "Failed to save profile: " + result.error.message,
        details: result.error.details,
        hint: result.error.hint
      });
    }

    console.log('✅ Profile saved successfully for:', username);
    
    const savedProfile = result.data[0];
    const responseProfile = {
      ...savedProfile,
      avatar: savedProfile.avatar_url || `https://i.pravatar.cc/150?u=${username}`
    };
    
    res.json({ 
      success: true, 
      message: "Profile updated successfully",
      profile: responseProfile
    });

  } catch (error) {
    console.error('❌ Update profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error: " + error.message,
      stack: error.stack
    });
  }
}

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
          -- Drop if exists and recreate with new schema
          DROP TABLE IF EXISTS public.user_profiles CASCADE;

          CREATE TABLE public.user_profiles (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT,
            avatar_url TEXT,
            bio TEXT,
            location VARCHAR(100),
            website TEXT,
            social_links JSONB DEFAULT '{}'::jsonb,
            preferences JSONB DEFAULT '{
              "theme": "light",
              "privacy": "public",
              "language": "en",
              "soundEnabled": true,
              "notifications": true
            }'::jsonb,
            message_count INTEGER DEFAULT 0,
            last_active TIMESTAMPTZ DEFAULT NOW(),
            status VARCHAR(20) DEFAULT 'online',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            firstname VARCHAR(100),
            lastname VARCHAR(100),
            age INTEGER,
            gender VARCHAR(50),
            interests TEXT
          );

          CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON public.user_profiles(username);
          CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
          CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON public.user_profiles(status);

          ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

          DROP POLICY IF EXISTS "allow_all_user_profiles_operations" ON public.user_profiles;
          CREATE POLICY "allow_all_user_profiles_operations" ON public.user_profiles FOR ALL USING (true) WITH CHECK (true);
          `,
          "4. Run the complete database setup script for all tables"
        ]
      });
    } else if (checkError) {
      throw checkError;
    } else {
      console.log('✅ user_profiles table exists');
      
      const sampleRow = tableCheck?.[0];
      const hasRequiredFields = sampleRow && 
        'firstname' in sampleRow && 
        'lastname' in sampleRow && 
        'age' in sampleRow;
        
      res.json({
        success: true,
        message: hasRequiredFields ? "user_profiles table exists with all required fields" : "Table exists but missing some fields",
        hasRequiredFields: hasRequiredFields,
        sampleData: sampleRow,
        rowCount: tableCheck?.length || 0,
        missingFields: hasRequiredFields ? [] : ["firstname", "lastname", "age", "gender", "interests"],
        instructions: !hasRequiredFields ? "Run the updated SQL script to add missing fields" : null
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
        error: "Database error: " + error.message,
        code: error.code,
        hint: error.hint
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
    
    const profile = profiles[0];
    const responseProfile = {
      ...profile,
      avatar: profile.avatar_url || `https://i.pravatar.cc/150?u=${username}`
    };
    
    res.json({ 
      success: true,
      profile: responseProfile
    });

  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error: " + error.message,
      stack: error.stack
    });
  }
});

app.get('/api/user/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
    console.log('📋 Loading profile for user:', username);

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

    const profile = profiles[0];
    const responseProfile = {
      ...profile,
      avatar: profile.avatar_url || `https://i.pravatar.cc/150?u=${username}`
    };
    
    res.json({ 
      success: true,
      profile: responseProfile
    });

  } catch (error) {
    console.error('❌ Get user profile error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// ===== ADD MISSING AI ENDPOINTS =====
app.post('/api/ai/private', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('🤫 Private AI request:', { message });

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
    console.log('🤖 Main AI request:', { message });

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

// ===== CRITICAL FIX: MODIFIED MESSAGES ENDPOINTS WITH SOFT DELETE =====
app.get('/api/messages', async (req, res) => {
  try {
    // MODIFIED: Only fetch messages that are not soft-deleted
    const { data, error } = await supabase
      .from('chatter')
      .select('id, content, username, created_at, image_url, reply_to, is_deleted')
      .eq('is_deleted', false)  // Only get non-deleted messages
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Filter out any messages that might have is_deleted = true (double check)
    const filteredData = (data || []).filter(msg => !msg.is_deleted);
    
    console.log(`📨 Fetched ${filteredData.length} messages (excluding deleted)`);
    res.json(filteredData);
  } catch (err) {
    console.error('❌ Server error fetching messages:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// MODIFIED: POST messages endpoint with better validation
app.post('/api/messages', async (req, res) => {
  try {
    const { content, username, image_url, reply_to } = req.body;

    console.log('📨 Received message via API:', { content, username, image_url, reply_to });

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
      reply_to: reply_to || '',
      is_deleted: false  // Add is_deleted field
    };

    console.log('📝 Inserting message to Supabase via API:', insertData);

    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Database insert error:', error);
      
      // Try minimal insert
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        console.log('🔄 Retrying with minimal fields...');
        const minimalData = {
          content: (content && content.trim() !== '') ? content.trim() : 'Message',
          username: username.trim(),
          is_deleted: false
        };
        
        const { data: retryData, error: retryError } = await supabase
          .from('chatter')
          .insert([minimalData])
          .select();
          
        if (retryError) {
          throw retryError;
        }
        console.log('✅ Message saved with minimal fields. ID:', retryData[0]?.id);
        
        // BROADCAST NEW MESSAGE TO ALL CLIENTS
        io.emit('new-message', retryData[0]);
        return res.status(201).json(retryData[0]);
      }
      throw error;
    }
    
    console.log('✅ Message saved successfully via API. ID:', data[0]?.id);
    
    // BROADCAST NEW MESSAGE TO ALL CLIENTS
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save message via API:', error);
    res.status(500).json({ error: "Failed to save message: " + error.message });
  }
});

// CRITICAL FIX: MODIFIED DELETE ENDPOINT WITH SOFT DELETE
app.delete('/api/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Attempting to delete message:', id);
    
    // MODIFIED: Use soft delete instead of hard delete
    const { error } = await supabase
      .from('chatter')
      .update({ is_deleted: true })
      .eq('id', id);

    if (error) {
      console.error('❌ Soft delete error:', error);
      
      // Fallback: Try hard delete if soft delete fails
      console.log('🔄 Falling back to hard delete...');
      const { error: hardDeleteError } = await supabase
        .from('chatter')
        .delete()
        .eq('id', id);
        
      if (hardDeleteError) {
        throw hardDeleteError;
      }
      console.log('✅ Message hard deleted:', id);
    } else {
      console.log('✅ Message soft deleted:', id);
    }
    
    // Broadcast deletion via Socket.io
    io.emit('message-deleted', id);
    res.status(200).json({ 
      success: true, 
      message: "Message deleted successfully",
      deletedId: id 
    });
  } catch (error) {
    console.error('❌ Failed to delete message:', error);
    res.status(500).json({ 
      success: false,
      error: "Failed to delete message",
      details: error.message 
    });
  }
});

// ===== PRIVATE MESSAGES ENDPOINTS =====
app.get('/api/private/conversations', async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username) {
      return res.status(400).json({ error: "Username query parameter is required" });
    }

    console.log('📨 Fetching conversations for:', username);

    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .eq('is_deleted', false)  // Only get non-deleted messages
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Database error fetching conversations:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    const conversationMap = new Map();
    
    (messages || []).forEach(msg => {
      const otherUser = msg.sender_username === username ? msg.receiver_username : msg.sender_username;
      
      if (!conversationMap.has(otherUser)) {
        conversationMap.set(otherUser, {
          username: otherUser,
          lastMessage: msg.content,
          lastMessageTime: msg.created_at,
          unread: msg.receiver_username === username && !msg.read,
          isSender: msg.sender_username === username
        });
      } else {
        const existing = conversationMap.get(otherUser);
        if (new Date(msg.created_at) > new Date(existing.lastMessageTime)) {
          existing.lastMessage = msg.content;
          existing.lastMessageTime = msg.created_at;
          existing.unread = msg.receiver_username === username && !msg.read;
          existing.isSender = msg.sender_username === username;
        }
      }
    });

    const conversationList = Array.from(conversationMap.values())
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

    console.log(`✅ Found ${conversationList.length} conversations for ${username}`);
    res.json(conversationList);

  } catch (error) {
    console.error('❌ Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations: ' + error.message });
  }
});

app.get('/api/private/messages/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { otherUser } = req.query;
    
    if (!username || !otherUser) {
      return res.status(400).json({ error: "Username and otherUser parameters are required" });
    }
    
    console.log('📨 Fetching messages between:', username, 'and', otherUser);

    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .or(`sender_username.eq.${otherUser},receiver_username.eq.${otherUser}`)
      .eq('is_deleted', false)  // Only get non-deleted messages
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Database error fetching messages:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    const filteredMessages = (messages || []).filter(msg => 
      (msg.sender_username === username && msg.receiver_username === otherUser) ||
      (msg.sender_username === otherUser && msg.receiver_username === username)
    );

    const unreadMessages = filteredMessages.filter(msg => 
      msg.receiver_username === username && !msg.read
    );

    if (unreadMessages.length > 0) {
      await supabase
        .from('private_messages')
        .update({ read: true })
        .in('id', unreadMessages.map(msg => msg.id));
    }

    console.log(`✅ Found ${filteredMessages.length} messages between ${username} and ${otherUser}`);
    res.json(filteredMessages);

  } catch (error) {
    console.error('❌ Error fetching private messages:', error);
    res.status(500).json({ error: 'Failed to fetch private messages: ' + error.message });
  }
});

app.post('/api/private/messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, image_url } = req.body;

    console.log('📨 Private message via API:', { sender_username, receiver_username, content, image_url });

    if (!sender_username || !receiver_username) {
      return res.status(400).json({ 
        success: false,
        error: "Sender and receiver usernames are required" 
      });
    }

    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ 
        success: false,
        error: "Content or image is required" 
      });
    }

    const insertData = {
      sender_username: sender_username.trim(),
      receiver_username: receiver_username.trim(),
      content: content ? content.trim() : '',
      image_url: image_url || null,
      read: false,
      is_deleted: false  // Add is_deleted field
    };

    console.log('📝 Inserting private message with corrected data:', insertData);

    const { data, error } = await supabase
      .from('private_messages')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Private message insert failed:', error);
      
      return res.status(500).json({ 
        success: false,
        error: "Database error: " + error.message,
        details: "Make sure your private_messages table has the correct structure",
        required_fields: ["sender_username", "receiver_username", "content", "read"]
      });
    }

    console.log('✅ Private message saved successfully. ID:', data[0]?.id);
    
    io.emit('new-private-message', data[0]);
    
    res.status(201).json({
      success: true,
      data: data[0]
    });

  } catch (error) {
    console.error('❌ Failed to save private message:', error);
    res.status(500).json({ 
      success: false,
      error: "Failed to send private message: " + error.message 
    });
  }
});

// CRITICAL FIX: MODIFIED PRIVATE MESSAGE DELETE ENDPOINT
app.delete('/api/private/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Attempting to delete private message:', id);
    
    // Use soft delete
    const { error } = await supabase
      .from('private_messages')
      .update({ is_deleted: true })
      .eq('id', id);

    if (error) {
      console.error('❌ Private message soft delete error:', error);
      
      // Fallback to hard delete
      const { error: hardDeleteError } = await supabase
        .from('private_messages')
        .delete()
        .eq('id', id);
        
      if (hardDeleteError) {
        throw hardDeleteError;
      }
      console.log('✅ Private message hard deleted:', id);
    } else {
      console.log('✅ Private message soft deleted:', id);
    }
    
    // Broadcast deletion
    io.emit('private-message-deleted', id);
    res.status(200).json({ 
      success: true, 
      message: "Private message deleted successfully",
      deletedId: id 
    });

  } catch (error) {
    console.error('❌ Failed to delete private message:', error);
    res.status(500).json({ 
      success: false,
      error: "Failed to delete private message",
      details: error.message 
    });
  }
});

app.get('/api/private/unread', async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username) {
      return res.status(400).json({ error: "Username query parameter is required" });
    }

    const { count, error } = await supabase
      .from('private_messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_username', username)
      .eq('read', false)
      .eq('is_deleted', false);  // Only count non-deleted messages

    if (error) {
      console.error('❌ Database error fetching unread count:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    res.json({ unreadCount: count || 0 });

  } catch (error) {
    console.error('❌ Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count: ' + error.message });
  }
});

app.put('/api/private/messages/read', async (req, res) => {
  try {
    const { sender_username, receiver_username } = req.body;

    if (!sender_username || !receiver_username) {
      return res.status(400).json({ error: "Sender and receiver usernames are required" });
    }

    const { error } = await supabase
      .from('private_messages')
      .update({ read: true })
      .eq('sender_username', sender_username)
      .eq('receiver_username', receiver_username)
      .eq('read', false)
      .eq('is_deleted', false);  // Only update non-deleted messages

    if (error) {
      console.error('❌ Database error marking messages as read:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    res.json({ success: true });

  } catch (error) {
    console.error('❌ Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read: ' + error.message });
  }
});

// ===== DATABASE TABLE CREATION ENDPOINTS =====
app.get('/api/create-posts-table', async (req, res) => {
  try {
    console.log('🔧 Checking posts table via GET...');
    
    const { data: tableCheck, error: checkError } = await supabase
      .from('posts')
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
          CREATE TABLE IF NOT EXISTS posts (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            author_username TEXT NOT NULL,
            content TEXT NOT NULL,
            media_url TEXT,
            media_type TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            likes_count INTEGER DEFAULT 0,
            comments_count INTEGER DEFAULT 0,
            is_deleted BOOLEAN DEFAULT FALSE
          );
          `,
          "4. Create comments table:",
          `
          CREATE TABLE IF NOT EXISTS post_comments (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
            author_username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            is_deleted BOOLEAN DEFAULT FALSE
          );
          `,
          "5. Create post_likes table:",
          `
          CREATE TABLE IF NOT EXISTS post_likes (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
            username TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            UNIQUE(post_id, username)
          );
          `,
          "6. Update chatter table with is_deleted column:",
          `
          ALTER TABLE chatter ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
          `,
          "7. Update private_messages table with is_deleted column:",
          `
          ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
          `
        ]
      });
    } else if (checkError) {
      throw checkError;
    } else {
      console.log('✅ Posts table exists (GET check)');
      res.json({
        success: true,
        message: "Posts table exists",
        sampleData: tableCheck?.[0],
        instructions: "Use POST /api/create-posts-table to create the table if it doesn't exist"
      });
    }

  } catch (error) {
    console.error('❌ Error checking posts table (GET):', error);
    res.status(500).json({ 
      success: false,
      error: "Error checking table: " + error.message 
    });
  }
});

// ===== ADDED: DATABASE SETUP ENDPOINT =====
app.post('/api/setup-database', async (req, res) => {
  try {
    console.log('🔧 Setting up database tables...');
    
    // Run SQL to add is_deleted columns if they don't exist
    const tablesToUpdate = ['chatter', 'private_messages', 'posts', 'post_comments'];
    
    for (const table of tablesToUpdate) {
      try {
        const { error } = await supabase.rpc('add_is_deleted_column_if_not_exists', {
          table_name: table
        });
        
        if (error && !error.message.includes('function does not exist')) {
          console.log(`⚠️ Could not add is_deleted to ${table}:`, error.message);
          
          // Manual SQL for adding column
          const sql = `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;`;
          console.log(`Run this SQL for ${table}:`, sql);
        } else {
          console.log(`✅ Added/verified is_deleted column in ${table}`);
        }
      } catch (err) {
        console.log(`⚠️ Error checking ${table}:`, err.message);
      }
    }
    
    res.json({
      success: true,
      message: "Database setup initiated. Please run the SQL commands in Supabase SQL Editor.",
      sqlCommands: [
        "ALTER TABLE chatter ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;",
        "CREATE INDEX IF NOT EXISTS idx_chatter_is_deleted ON chatter(is_deleted);",
        "CREATE INDEX IF NOT EXISTS idx_private_messages_is_deleted ON private_messages(is_deleted);"
      ]
    });
    
  } catch (error) {
    console.error('❌ Database setup error:', error);
    res.status(500).json({ 
      success: false,
      error: "Database setup error: " + error.message 
    });
  }
});

// ===== DEBUG ENDPOINTS =====
app.get('/api/debug/messages', async (req, res) => {
  try {
    console.log('🔍 Debugging messages...');
    
    const { data: messages, error } = await supabase
      .from('chatter')
      .select('id, content, username, created_at, is_deleted')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }
    
    const deletedCount = messages.filter(msg => msg.is_deleted).length;
    
    res.json({
      success: true,
      totalMessages: messages.length,
      deletedMessages: deletedCount,
      messages: messages,
      hasIsDeletedColumn: messages.length > 0 ? 'is_deleted' in messages[0] : 'unknown',
      fixInstructions: deletedCount > 0 ? 
        "Some messages are marked as deleted but still showing. Run /api/cleanup-deleted-messages to remove them." : 
        "All good! No deleted messages in the list."
    });
    
  } catch (error) {
    console.error('❌ Debug error:', error);
    res.status(500).json({ 
      success: false,
      error: "Debug error: " + error.message 
    });
  }
});

// ===== CLEANUP ENDPOINT =====
app.post('/api/cleanup-deleted-messages', async (req, res) => {
  try {
    console.log('🧹 Cleaning up deleted messages...');
    
    // First, check if we have is_deleted column
    const { data: sample, error: sampleError } = await supabase
      .from('chatter')
      .select('id, is_deleted')
      .limit(1);
    
    if (sampleError && sampleError.message.includes('column')) {
      // Column doesn't exist, create it
      console.log('⚠️ is_deleted column doesn\'t exist, creating it...');
      return res.json({
        success: false,
        error: "is_deleted column doesn't exist",
        instructions: "Run this SQL in Supabase: ALTER TABLE chatter ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE;"
      });
    }
    
    // Get all deleted messages
    const { data: deletedMessages, error } = await supabase
      .from('chatter')
      .select('id, content, username')
      .eq('is_deleted', true)
      .limit(100);

    if (error) {
      throw error;
    }
    
    if (!deletedMessages || deletedMessages.length === 0) {
      return res.json({
        success: true,
        message: "No deleted messages found to cleanup",
        cleanedCount: 0
      });
    }
    
    // Actually delete them permanently
    const deletedIds = deletedMessages.map(msg => msg.id);
    const { error: deleteError } = await supabase
      .from('chatter')
      .delete()
      .in('id', deletedIds);

    if (deleteError) {
      throw deleteError;
    }
    
    console.log(`✅ Permanently deleted ${deletedIds.length} messages`);
    
    // Broadcast cleanup event
    io.emit('messages-cleaned-up', { count: deletedIds.length });
    
    res.json({
      success: true,
      message: `Successfully cleaned up ${deletedIds.length} deleted messages`,
      cleanedCount: deletedIds.length,
      deletedMessages: deletedMessages.map(msg => ({ id: msg.id, username: msg.username }))
    });
    
  } catch (error) {
    console.error('❌ Cleanup error:', error);
    res.status(500).json({ 
      success: false,
      error: "Cleanup error: " + error.message 
    });
  }
});

// ===== ADD MESSAGE HISTORY ENDPOINT =====
app.get('/api/messages/history', async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    
    const { data, error } = await supabase
      .from('chatter')
      .select('id, content, username, created_at, image_url, reply_to, is_deleted')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) throw error;
    
    // Count total non-deleted messages
    const { count, error: countError } = await supabase
      .from('chatter')
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', false);
    
    if (countError) {
      console.error('Count error:', countError);
    }
    
    res.json({
      messages: data || [],
      total: count || 0,
      limit: parseInt(limit),
      offset: parseInt(offset),
      hasMore: count ? (parseInt(offset) + parseInt(limit) < count) : false
    });
  } catch (err) {
    console.error('History error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== LEGACY ENDPOINTS (for backward compatibility) =====
app.get('/messages', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chatter')
      .select('id, content, username, created_at, image_url, reply_to, is_deleted')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/messages', async (req, res) => {
  try {
    const { content, username, image_url, reply_to } = req.body;

    console.log('📨 Received message via legacy endpoint:', { content, username, image_url, reply_to });

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
      reply_to: reply_to || '',
      is_deleted: false
    };

    console.log('📝 Inserting message to Supabase via legacy endpoint:', insertData);

    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Database insert error:', error);
      
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        console.log('🔄 Retrying with minimal fields...');
        const minimalData = {
          content: (content && content.trim() !== '') ? content.trim() : 'Message',
          username: username.trim(),
          is_deleted: false
        };
        
        const { data: retryData, error: retryError } = await supabase
          .from('chatter')
          .insert([minimalData])
          .select();
          
        if (retryError) {
          throw retryError;
        }
        console.log('✅ Message saved with minimal fields. ID:', retryData[0]?.id);
        
        io.emit('new-message', retryData[0]);
        return res.status(201).json(retryData[0]);
      }
      throw error;
    }
    
    console.log('✅ Message saved successfully via legacy endpoint. ID:', data[0]?.id);
    
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save message via legacy endpoint:', error);
    res.status(500).json({ error: "Failed to save message: " + error.message });
  }
});

app.delete('/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🗑️ Legacy delete for message:', id);
    
    // Try soft delete first
    const { error } = await supabase
      .from('chatter')
      .update({ is_deleted: true })
      .eq('id', id);

    if (error) {
      console.error('❌ Legacy soft delete error:', error);
      
      // Fallback to hard delete
      const { error: hardDeleteError } = await supabase
        .from('chatter')
        .delete()
        .eq('id', id);
        
      if (hardDeleteError) {
        throw hardDeleteError;
      }
      console.log('✅ Message hard deleted via legacy endpoint:', id);
    } else {
      console.log('✅ Message soft deleted via legacy endpoint:', id);
    }
    
    io.emit('message-deleted', id);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Legacy delete error:', error);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// ===== IMAGE UPLOAD =====
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const fileBuffer = req.file.buffer;
    const fileName = `${Date.now()}-${req.file.originalname}`;
    const filePath = `images/${fileName}`;

    const { data, error } = await supabase.storage
      .from('chat-images')
      .upload(filePath, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from('chat-images')
      .getPublicUrl(filePath);

    res.json({ 
      imageUrl: urlData.publicUrl,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload image' });
  }
});

// ===== BOT RESPONSE SAVING =====
async function saveBotResponseToSupabase(content, originalCommand, commandType = 'AI') {
  try {
    console.log(`🔄 Attempting to save ${commandType} response to Supabase...`);
    
    const insertData = {
      content: content || `${commandType} Response`, 
      username: commandType === 'AI' ? 'AI' : 'Bot',
      image_url: '',
      reply_to: originalCommand || '',
      is_deleted: false
    };
    
    console.log('📝 Insert data:', insertData);
    
    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Supabase insertion error:', error);
      
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        console.log('🔄 Retrying with minimal fields...');
        const minimalData = {
          content: content || `${commandType} Response`,
          username: commandType === 'AI' ? 'AI' : 'Bot',
          is_deleted: false
        };
        
        const { data: retryData, error: retryError } = await supabase
          .from('chatter')
          .insert([minimalData])
          .select();
          
        if (retryError) {
          throw retryError;
        }
        console.log(`✅ ${commandType} response saved to Supabase (minimal fields). ID:`, retryData[0]?.id);
        
        io.emit('new-message', retryData[0]);
        return retryData;
      }
      throw error;
    }
    
    console.log(`✅ ${commandType} response saved to Supabase. ID:`, data[0]?.id);
    
    io.emit('new-message', data[0]);
    return data;
  } catch (error) {
    console.error(`❌ Error saving ${commandType} response to Supabase:`, error);
    throw error;
  }
}

// ===== TEST ENDPOINTS =====
app.get('/test-supabase', async (req, res) => {
  try {
    console.log('🧪 Testing Supabase connection (GET)...');
    
    const { data: readData, error: readError } = await supabase
      .from('chatter')
      .select('*')
      .limit(5)
      .order('created_at', { ascending: false });

    if (readError) {
      console.error('❌ Read test failed:', readError);
      return res.status(500).json({ 
        success: false, 
        test: 'read',
        error: readError.message
      });
    }

    const testData = {
      content: 'Test regular message from server',
      username: 'TestBot',
      image_url: '',
      reply_to: '',
      is_deleted: false
    };
    
    const { data: insertData, error: insertError } = await supabase
      .from('chatter')
      .insert([testData])
      .select();

    if (insertError) {
      console.error('❌ Insert test failed:', insertError);
      return res.status(500).json({ 
        success: false, 
        test: 'insert',
        error: insertError.message,
        details: insertError
      });
    }
    
    console.log('✅ All tests successful!');
    res.json({ 
      success: true, 
      message: 'Supabase connection test successful',
      tests: {
        read: {
          success: true,
          messageCount: readData?.length || 0
        },
        insert: {
          success: true,
          insertedId: insertData[0]?.id
        }
      },
      recentMessages: readData,
      insertedMessage: insertData[0]
    });
  } catch (error) {
    console.error('❌ Test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===== COMMAND API HANDLER =====
app.post("/api/command", async (req, res) => {
  try {
    let { message, source = 'main-chat' } = req.body;
    console.log('📨 Received command:', { message, source });
    
    if (!message) return res.status(400).json({ reply: "❌ Message is required" });

    const PREFIX = config.prefix || "!";
    
    if (source === 'private-ai' && !message.startsWith(PREFIX)) {
      console.log('🤫 Private AI detected - checking for prefix-free commands...');
      
      const trimmedMessage = message.trim().toLowerCase();
      const firstWord = trimmedMessage.split(' ')[0];
      
      const commandWords = ['ai', 'help', 'ping', 'prefix', 'ask', 'chat'];
      
      if (commandWords.includes(firstWord)) {
        message = PREFIX + message;
        console.log('🔍 Auto-added prefix to command:', message);
      } else {
        message = PREFIX + 'ai ' + message;
        console.log('🤖 Auto-treated as AI command:', message);
      }
    }

    if (message.trim().toLowerCase() === "prefix") {
      const reply = `🔹 My command prefix is: \`${PREFIX}\``;
      
      if (source === 'main-chat') {
        console.log('💾 Saving prefix command response to Supabase...');
        try {
          await saveBotResponseToSupabase(reply, 'prefix', 'Bot');
        } catch (saveError) {
          console.error('❌ Failed to save prefix response:', saveError);
        }
      }
      
      return res.json({ reply });
    }

    const cmd = handleCommand(message);
    if (!cmd) {
      console.log('❌ Not a command or wrong prefix');
      return res.end();
    }

    console.log('🔍 Command detected:', cmd.commandName);
    console.log('📍 Source:', source);

    let finalReply = null;
    let responder = null;

    if (cmd.commandName === "ai") {
      console.log('🤖 Processing EXCLUSIVELY as AI command');
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
        console.log('🤖 AI Response received');

      } catch (aiError) {
        console.error("❌ AI Processing Error:", aiError);
        finalReply = `❌ AI Error: ${aiError.message.replace(/[\n\r]/g, ' ').substring(0, 200)}`;
      }
    } else {
      console.log('🤖 Processing EXCLUSIVELY as Bot command');
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

    if (finalReply && source === 'main-chat') {
      console.log(`💾 Saving ${responder} response to Supabase...`);
      try {
        await saveBotResponseToSupabase(finalReply, cmd.commandName, responder);
      } catch (saveError) {
        console.error(`❌ Failed to save ${responder} response:`, saveError);
      }
    }

    if (finalReply) {
      return res.json({ reply: finalReply });
    } else {
      return res.json({ reply: "❌ No response generated" });
    }

  } catch (error) {
    console.error("❌ Server Error:", error);
    const errorReply = `❌ Server Error: ${error.message}`;
    
    if (source === 'main-chat') {
      console.log('💾 Saving server error response to Supabase...');
      try {
        await saveBotResponseToSupabase(errorReply, 'unknown', 'Bot');
      } catch (saveError) {
        console.error('❌ Failed to save server error response:', saveError);
      }
    }
    
    res.status(500).json({ reply: errorReply });
  }
});

// ===== COMMAND LOADER SETUP =====
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

function handleCommand(input) {
  if (!input.startsWith(PREFIX)) return null;
  const args = input.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const text = args.join(" ");
  return { commandName, args, text };
}

// Create commands directory if it doesn't exist
fs.ensureDirSync(COMMANDS_DIR);
loadCommands();

// ===== SOCKET.IO REAL-TIME MESSAGING =====
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  socket.on('request-messages', async () => {
    try {
      const { data, error } = await supabase
        .from('chatter')
        .select('*')
        .eq('is_deleted', false)  // Only send non-deleted messages
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
      console.log('📊 Updated online users:', onlineUsersArray);
      
      io.emit('user-status-change', { 
        username, 
        status: 'online',
        onlineUsers: onlineUsersArray
      });
    }
  });

  socket.on('user-away', (username) => {
    if (username && onlineUsers.has(username)) {
      console.log('⏸️ User away:', username);
      
      const userData = onlineUsers.get(username);
      userData.lastSeen = Date.now();
      userData.isOnline = false;
      
      io.emit('user-status-change', { 
        username, 
        status: 'away',
        onlineUsers: Array.from(onlineUsers.keys())
      });
    }
  });

  socket.on('user-offline', (username) => {
    if (username) {
      console.log('🔴 User offline (manual):', username);
      removeUserFromOnlineList(username);
    }
  });

  socket.on('typing-start', (data) => {
    socket.broadcast.emit('user-typing', {
      username: data.username,
      isTyping: true
    });
  });
  
  socket.on('typing-stop', (data) => {
    socket.broadcast.emit('user-typing', {
      username: data.username,
      isTyping: false
    });
  });

  // Handle message deletion events
  socket.on('message-deleted-client', (messageId) => {
    console.log('🗑️ Client reported message deletion:', messageId);
    // Broadcast to all other clients
    socket.broadcast.emit('message-deleted', messageId);
  });

  socket.on('private-message-deleted-client', (data) => {
    console.log('🗑️ Client reported private message deletion:', data);
    socket.broadcast.emit('private-message-deleted', data);
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 User disconnected:', socket.id, 'Reason:', reason);
    
    let foundUsername = null;
    for (let [username, data] of onlineUsers.entries()) {
      if (data.socketId === socket.id) {
        foundUsername = username;
        data.lastSeen = Date.now();
        data.isOnline = false;
        console.log('⏸️ User marked as inactive:', username);
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
      console.log('🗑️ After removal, online users:', onlineUsersArray);
      
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
    console.log('🧹 Cleaned up inactive users (3min timeout):', removedUsers);
    console.log('📊 Current online users after cleanup:', onlineUsersArray);
  }
}, 30000);

// ===== UPTIME SYSTEM =====
if (config.autoUptime?.enable || isRender) {
  const myUrl = renderExternalUrl || config.autoUptime?.url || `http://localhost:${port}`;

  global.utils.log.info("RENDER UPTIME", `Monitoring endpoint available at: ${myUrl}/uptime`);

  app.get("/uptime", (req, res) => {
    res.status(200).json({
      status: "OK",
      timestamp: Date.now(),
      uptime: process.uptime(),
      platform: "Render",
      monitor: "UptimeRobot"
    });
  });

  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      version: require('./package.json').version || "1.0.0",
      node: process.version,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      platform: process.platform,
      render: isRender,
      endpoints: {
        uptime: `${myUrl}/uptime`,
        api: `${myUrl}/api/command`
      }
    });
  });

  if (isRender) {
    const pingInterval = setInterval(() => {
      axios.get(`${myUrl}/uptime`)
        .then(() => global.utils.log.info("RENDER PING", "Keeping Render instance alive"))
        .catch(err => global.utils.log.err("RENDER PING", err.message));
    }, 4 * 60 * 1000);

    process.on('exit', () => clearInterval(pingInterval));
  }
}

// ===== START SERVER =====
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🔹 Command prefix: "${PREFIX}"`);
  console.log(`👥 Online users tracking: ACTIVE (3 minute timeout)`);
  console.log(`🗑️ MESSAGE DELETION FIX: IMPLEMENTED (Soft delete + is_deleted column)`);
  console.log(`🔄 Client now gets only non-deleted messages on refresh`);
  console.log(`🔍 Debug endpoint: GET /api/debug/messages`);
  console.log(`🧹 Cleanup endpoint: POST /api/cleanup-deleted-messages`);
  console.log(`🔧 Database setup: POST /api/setup-database`);
  
  if (isRender && renderExternalUrl) {
    console.log(`🌐 Render External URL: ${renderExternalUrl}`);
    console.log(`⏱️ UptimeRobot monitoring URL: ${renderExternalUrl}/health`);
    console.log(`🔍 Debug messages: ${renderExternalUrl}/api/debug/messages`);
    console.log(`🧪 Test Supabase: ${renderExternalUrl}/test-supabase`);
  }
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
  console.error('❌ Global Error Handler:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 route handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: {
      authentication: [
        'POST /api/register',
        'POST /api/login', 
        'POST /api/check-username',
        'GET /api/auth-test'
      ],
      chat: [
        'GET /api/messages',
        'POST /api/messages',
        'DELETE /api/messages/:id',
        'GET /api/messages/history',
        'POST /api/command'
      ],
      debug: [
        'GET /api/debug/messages',
        'POST /api/cleanup-deleted-messages',
        'POST /api/setup-database',
        'GET /test-supabase',
        'GET /health',
        'GET /uptime'
      ]
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

process.on('unhandledRejection', (err) => {
  global.utils.log.err("UNHANDLED REJECTION", err);
});

process.on('uncaughtException', (err) => {
  global.utils.log.err("UNCAUGHT EXCEPTION", err);
  process.exit(1);
});

// Export for testing
module.exports = { app, server, io, supabase };
