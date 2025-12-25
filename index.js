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
// Force polling for Opera and mobile data compatibility
const io = new Server(server, {
  cors: { 
    origin: "*" 
  },
  transports: ['polling', 'websocket'], // Polling first, then websocket
  allowUpgrades: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  cookie: false
});

// Track online users - 3 MINUTE TIMEOUT
const onlineUsers = new Map();
const onlineStatusTimeout = 180000; // 3 minutes = 180000 milliseconds

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
    fileSize: 5 * 1024 * 1024, // 5MB limit
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

// Simple password hashing function (basic implementation)
function simpleHash(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

// Initialize users table if it doesn't exist
async function initializeUsersTable() {
  try {
    // First check if table exists by trying to select from it
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .limit(1);

    if (error && error.code === '42P01') { // Table doesn't exist
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

// Call initialization
initializeUsersTable();

// ===== AUTHENTICATION ENDPOINTS =====

// User registration endpoint - POST
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

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ 
        success: false, 
        error: "Username can only contain letters, numbers, and underscores" 
      });
    }

    // Check if username already exists (case-insensitive)
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

// User login endpoint - POST
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

    // Find user (case-insensitive search)
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

    console.log('✅ User logged in successfully:', username);

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
  const data = `${username}:${timestamp}:${Math.random().toString(36).substr(2, 9)}`;
  return Buffer.from(data).toString('base64');
}

// Token verification middleware - FIXED: Now handles both Bearer token and basic token
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

  // Remove 'Bearer ' prefix if present
  const token = authHeader.replace('Bearer ', '');
  
  if (!token) {
    console.log('❌ Empty token after removing Bearer prefix');
    return res.status(401).json({ 
      success: false, 
      error: "Authentication token required" 
    });
  }

  try {
    // Simple token verification
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
    
    // Check if token is not too old (30 days)
    const tokenAge = Date.now() - parseInt(timestamp);
    const maxTokenAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    
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
    console.error('❌ Token that failed:', token);
    return res.status(401).json({ 
      success: false, 
      error: "Invalid token" 
    });
  }
}

// Check username availability - POST
app.post('/api/check-username', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.json({ available: true });
    }

    // Check if username exists (case-insensitive)
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

// Add /api/auth/register endpoint (same as /api/register)
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

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ 
        success: false, 
        error: "Username can only contain letters, numbers, and underscores" 
      });
    }

    // Check if username already exists (case-insensitive)
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
    
    // Generate token for persistent login
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

// Add /api/auth/login endpoint (same as /api/login)
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

    // Find user (case-insensitive search)
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

    console.log('✅ User logged in successfully via auth endpoint:', username);

    // Generate token for persistent login
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

// Add /api/auth/check-username endpoint (same as /api/check-username)
app.post('/api/auth/check-username', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.json({ available: true });
    }

    // Check if username exists (case-insensitive)
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

// Add auto-login endpoint
app.post('/api/auth/auto-login', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;

    console.log('🔄 Auto-login attempt for:', username);

    // Find user
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

    // Update last login
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

// GET endpoint for login (for testing in browser)
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

// GET endpoint for register (for testing in browser)
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

// GET endpoint for check-username (for testing in browser)
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

// ===== ADD MISSING AUTH TEST ENDPOINT =====

// Test authentication endpoints - GET
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

// Get current user's profile - FIXED WITH BETTER ERROR HANDLING
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

    // First get user info
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

    // Now get user profile
    const { data: profiles, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('username', username)
      .limit(1);

    let profileData;
    
    if (profileError && profileError.code === '42P01') {
      console.log('⚠️ user_profiles table does not exist, returning default profile');
      
      // Create default profile structure
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
      
      // Try to create the profile
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
      // Create default profile if none exists
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
      
      // Try to create the profile
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
      // Profile exists, use it
      profileData = profiles[0];
    }

    // Ensure all fields are present and map avatar_url to avatar for frontend compatibility
    const completeProfile = {
      // User table fields
      username: username,
      email: user.email,
      user_id: user.id,
      created_at: user.created_at,
      last_login: user.last_login,
      
      // Profile fields with defaults
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
      error: "Server error but returning default profile: " + error.message
    });
  }
});

// Update user profile - FIXED: Now accepts both PUT and POST methods
app.put('/api/user/profile', verifyToken, async (req, res) => {
  await updateProfileHandler(req, res);
});

// Add POST method for profile update for compatibility
app.post('/api/user/profile', verifyToken, async (req, res) => {
  await updateProfileHandler(req, res);
});

// Profile update handler function - FIXED FOR NEW SCHEMA
async function updateProfileHandler(req, res) {
  try {
    const username = req.user.username;
    const profileData = req.body;

    console.log('💾 Saving profile for:', username);
    console.log('📝 Profile data received:', JSON.stringify(profileData, null, 2));
    console.log('🔐 Using token from user:', req.user);

    if (!username) {
      return res.status(400).json({ 
        success: false, 
        error: "Username is required" 
      });
    }

    // First get user ID
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

    // Check if profile exists
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
    
    // Prepare data for update/insert - using new schema field names
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
      // Update existing profile
      console.log('📝 Updating existing profile for:', username);
      result = await supabase
        .from('user_profiles')
        .update(profileUpdateData)
        .eq('username', username)
        .select();
    } else {
      // Create new profile
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
      
      // Provide helpful error messages
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
    
    // Return the saved profile with avatar field for frontend compatibility
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

// ===== ADDED: ENDPOINT TO CREATE USER_PROFILES TABLE =====

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

          -- Create indexes
          CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON public.user_profiles(username);
          CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);
          CREATE INDEX IF NOT EXISTS idx_user_profiles_status ON public.user_profiles(status);

          -- Enable RLS
          ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

          -- RLS Policy
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
      
      // Check if it has the required columns
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

// ===== ADDED: TEST PROFILE ENDPOINT (NO AUTH REQUIRED) =====

// Test profile endpoint without authentication
app.get('/api/test-profile', async (req, res) => {
  try {
    // Get username from query parameter for testing
    const { username } = req.query;
    
    if (!username) {
      return res.status(400).json({ 
        success: false, 
        error: "Username query parameter is required" 
      });
    }
    
    console.log('🧪 Test profile endpoint for:', username);
    
    // Test if we can query the table
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
    
    // Map avatar_url to avatar for frontend compatibility
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

// Get user profile by username (for profile popups) - FIXED
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
        // Table doesn't exist, return basic profile
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
      // Return basic profile if none exists
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

    // Map avatar_url to avatar for frontend compatibility
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

// Private AI endpoint - FIXED: This was missing
app.post('/api/ai/private', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('🤫 Private AI request:', { message });

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Use the same AI service as the main chat
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

// Main AI chat endpoint - FIXED: This was missing
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message } = req.body;
    console.log('🤖 Main AI request:', { message });

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Use the same AI service
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

// ===== ADD MESSAGES ENDPOINTS TO MATCH CLIENT =====

// GET messages endpoint that client expects - FIXED: Add deleted flag check
app.get('/api/messages', async (req, res) => {
  try {
    // Check if chatter table has a 'deleted' column, if not, get all messages
    const { data: tableInfo, error: tableError } = await supabase
      .from('chatter')
      .select('*')
      .limit(1);

    let query = supabase
      .from('chatter')
      .select('id, content, username, created_at, image_url, reply_to')
      .order('created_at', { ascending: false });

    // If table has a 'deleted' column, filter out deleted messages
    if (!tableError && tableInfo && tableInfo.length > 0) {
      const hasDeletedColumn = 'deleted' in tableInfo[0];
      if (hasDeletedColumn) {
        query = query.eq('deleted', false);
      }
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST messages endpoint that client expects
app.post('/api/messages', async (req, res) => {
  try {
    const { content, username, image_url, reply_to } = req.body;

    console.log('📨 Received message via API:', { content, username, image_url, reply_to });

    // FIXED: Better validation - allow empty content if there's an image
    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ error: "Content or image is required" });
    }

    if (!username || username.trim() === '') {
      return res.status(400).json({ error: "Username is required" });
    }

    // FIXED: Proper data preparation for regular messages
    const insertData = {
      content: (content && content.trim() !== '') ? content.trim() : '',
      username: username.trim(),
      image_url: image_url || '',
      reply_to: reply_to || '',
      deleted: false // Add deleted flag
    };

    console.log('📝 Inserting message to Supabase via API:', insertData);

    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Database insert error:', error);
      
      // If there's still an issue, try minimal insert
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        console.log('🔄 Retrying with minimal fields...');
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
        console.log('✅ Message saved with minimal fields. ID:', retryData[0]?.id);
        
        // BROADCAST NEW MESSAGE TO ALL CLIENTS IMMEDIATELY
        io.emit('new-message', retryData[0]);
        return res.status(201).json(retryData[0]);
      }
      throw error;
    }
    
    console.log('✅ Message saved successfully via API. ID:', data[0]?.id);
    
    // BROADCAST NEW MESSAGE TO ALL CLIENTS IMMEDIATELY
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save message via API:', error);
    res.status(500).json({ error: "Failed to save message: " + error.message });
  }
});

// DELETE messages endpoint that client expects - FIXED: Use soft delete instead of hard delete
app.delete('/api/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    
    console.log('🗑️ Deleting message:', { id, username });
    
    // First check if the message exists and belongs to the user
    const { data: message, error: fetchError } = await supabase
      .from('chatter')
      .select('username, id')
      .eq('id', id)
      .single();
    
    if (fetchError) {
      console.error('❌ Message not found:', fetchError);
      return res.status(404).json({ error: "Message not found" });
    }
    
    // Check ownership - only allow deletion by message owner or admin
    if (message.username !== username && username !== 'admin') {
      return res.status(403).json({ error: "You can only delete your own messages" });
    }
    
    // Try soft delete first (update deleted flag)
    const { error: updateError } = await supabase
      .from('chatter')
      .update({ deleted: true })
      .eq('id', id);
    
    if (updateError) {
      console.log('⚠️ Soft delete failed, trying to add deleted column...');
      
      // Try to add the deleted column if it doesn't exist
      try {
        // First try hard delete
        const { error: deleteError } = await supabase
          .from('chatter')
          .delete()
          .eq('id', id);
        
        if (deleteError) throw deleteError;
        
      } catch (deleteError) {
        console.error('❌ Hard delete also failed:', deleteError);
        throw new Error("Failed to delete message");
      }
    }
    
    console.log('✅ Message marked as deleted:', id);
    
    // Broadcast deletion via Socket.io
    io.emit('message-deleted', id);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Delete error:', error);
    res.status(500).json({ error: "Failed to delete message: " + error.message });
  }
});

// ===== FIXED PRIVATE MESSAGES ENDPOINTS =====

// Get conversations for the current user - FIXED
app.get('/api/private/conversations', async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username) {
      return res.status(400).json({ error: "Username query parameter is required" });
    }

    console.log('📨 Fetching conversations for:', username);

    // Get all messages involving this user (excluding deleted ones)
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .is('deleted', false) // Exclude deleted messages
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Database error fetching conversations:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    // Process to get unique conversations with last message
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
        // Update if this message is newer
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

// Get messages between two users - FIXED (Fixed the quote issue here)
app.get('/api/private/messages/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { otherUser } = req.query;
    
    if (!username || !otherUser) {
      return res.status(400).json({ error: "Username and otherUser parameters are required" });
    }
    
    console.log('📨 Fetching messages between:', username, 'and', otherUser);

    // Get all messages involving these users (excluding deleted ones)
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .or(`sender_username.eq.${otherUser},receiver_username.eq.${otherUser}`)
      .is('deleted', false) // Exclude deleted messages
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Database error fetching messages:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    // Filter to get only messages between these two users
    const filteredMessages = (messages || []).filter(msg => 
      (msg.sender_username === username && msg.receiver_username === otherUser) ||
      (msg.sender_username === otherUser && msg.receiver_username === username)
    );

    // Mark messages as read when fetched
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

// Send private message - COMPLETELY FIXED
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

    // FIXED: Use only the fields that exist in the table
    const insertData = {
      sender_username: sender_username.trim(),
      receiver_username: receiver_username.trim(),
      content: content ? content.trim() : '',
      image_url: image_url || null, // Use null instead of empty string
      read: false,
      deleted: false
    };

    console.log('📝 Inserting private message with corrected data:', insertData);

    const { data, error } = await supabase
      .from('private_messages')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Private message insert failed:', error);
      
      // If there's still an issue, provide detailed error
      return res.status(500).json({ 
        success: false,
        error: "Database error: " + error.message,
        details: "Make sure your private_messages table has the correct structure",
        required_fields: ["sender_username", "receiver_username", "content", "read", "deleted"]
      });
    }

    console.log('✅ Private message saved successfully. ID:', data[0]?.id);
    
    // Broadcast via Socket.io to both users
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

// Get unread message count - FIXED
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
      .is('deleted', false); // Don't count deleted messages

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

// Mark messages as read - FIXED
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
      .is('deleted', false); // Don't update deleted messages

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

// Delete private message
app.delete('/api/private/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    
    console.log('🗑️ Deleting private message:', { id, username });
    
    // First check if the message exists
    const { data: message, error: fetchError } = await supabase
      .from('private_messages')
      .select('sender_username, receiver_username, id')
      .eq('id', id)
      .single();
    
    if (fetchError) {
      console.error('❌ Private message not found:', fetchError);
      return res.status(404).json({ error: "Message not found" });
    }
    
    // Check ownership - only sender or receiver can delete
    if (message.sender_username !== username && message.receiver_username !== username && username !== 'admin') {
      return res.status(403).json({ error: "You can only delete your own messages" });
    }
    
    // Try soft delete first
    const { error: updateError } = await supabase
      .from('private_messages')
      .update({ deleted: true })
      .eq('id', id);
    
    if (updateError) {
      console.log('⚠️ Soft delete failed, trying hard delete...');
      
      // Try hard delete
      const { error: deleteError } = await supabase
        .from('private_messages')
        .delete()
        .eq('id', id);
      
      if (deleteError) throw deleteError;
    }
    
    console.log('✅ Private message deleted:', id);
    
    // Broadcast deletion via Socket.io
    io.emit('private-message-deleted', { 
      messageId: id,
      sender: message.sender_username,
      receiver: message.receiver_username
    });
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Delete private message error:', error);
    res.status(500).json({ error: "Failed to delete private message: " + error.message });
  }
});

// ===== FIXED: NEW ENDPOINT TO HANDLE TEMP MESSAGE SYNC =====
// This endpoint prevents temp messages from being saved when they were deleted before server received them
app.post('/api/messages/confirm', async (req, res) => {
  try {
    const { tempId, content, username, image_url, reply_to, isDeleted = false } = req.body;
    
    console.log('🔍 Confirming temp message:', { tempId, content, username, isDeleted });
    
    // If the temp message was deleted before confirmation, don't save it
    if (isDeleted) {
      console.log('🚫 Skipping save for deleted temp message:', tempId);
      return res.json({ 
        success: true, 
        skipped: true,
        message: 'Message was deleted before being saved' 
      });
    }
    
    // Save the message normally
    const insertData = {
      content: (content && content.trim() !== '') ? content.trim() : '',
      username: username.trim(),
      image_url: image_url || '',
      reply_to: reply_to || '',
      deleted: false
    };
    
    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();
    
    if (error) {
      console.error('❌ Error saving confirmed message:', error);
      return res.status(500).json({ error: "Failed to save message" });
    }
    
    console.log('✅ Temp message confirmed and saved:', data[0]?.id);
    
    // Broadcast new message
    io.emit('new-message', data[0]);
    
    res.status(201).json({ 
      success: true, 
      data: data[0],
      tempId: tempId 
    });
    
  } catch (error) {
    console.error('❌ Error confirming temp message:', error);
    res.status(500).json({ error: "Failed to confirm message: " + error.message });
  }
});

// ===== FIXED: ENHANCED SOCKET.IO HANDLERS FOR TEMP MESSAGE SYNC =====
io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // Send existing messages to newly connected client (excluding deleted)
  socket.on('request-messages', async () => {
    try {
      const { data: tableInfo } = await supabase
        .from('chatter')
        .select('*')
        .limit(1);
      
      let query = supabase
        .from('chatter')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      
      // If table has a 'deleted' column, filter out deleted messages
      if (tableInfo && tableInfo.length > 0 && 'deleted' in tableInfo[0]) {
        query = query.eq('deleted', false);
      }
      
      const { data, error } = await query;
      
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
      
      // Update or add user to online users
      onlineUsers.set(username, {
        socketId: socket.id,
        username: username,
        lastSeen: Date.now(),
        isOnline: true
      });
      
      // Get current online users list
      const onlineUsersArray = Array.from(onlineUsers.keys());
      console.log('📊 Updated online users:', onlineUsersArray);
      
      // Broadcast to all users that this user is online
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
      
      // Update last seen but keep user in list
      const userData = onlineUsers.get(username);
      userData.lastSeen = Date.now();
      userData.isOnline = false;
      
      // Broadcast away status
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

  // Handle typing indicators
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

  // Handle private AI messages - FIXED: This was causing issues
  socket.on('send-private-message', async (data) => {
    try {
      console.log('🤫 Private AI message received via socket:', data);
      
      // Process private AI response using the new endpoint
      const response = await axios.post('http://localhost:3000/api/ai/private', {
        message: data.content
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.data.reply) {
        // Send private AI response back to the specific user
        socket.emit('new-private-message', {
          content: response.data.reply,
          username: 'Private AI',
          sender_username: 'Private AI',
          receiver_username: data.username,
          created_at: new Date().toISOString(),
          deleted: false
        });
      }
    } catch (error) {
      console.error('❌ Private AI message error:', error);
      socket.emit('new-private-message', {
        content: "Error: Could not process your private message",
        username: 'Private AI',
        sender_username: 'Private AI', 
        receiver_username: data.username,
        created_at: new Date().toISOString(),
        deleted: false
      });
    }
  });

  // ===== PRIVATE MESSAGING SOCKET EVENTS =====

  // Handle private messaging via Socket.io
  socket.on('send-private-message-socket', async (data) => {
    try {
      console.log('🤫 Private message via socket:', data);
      
      const { sender_username, receiver_username, content, image_url } = data;

      const insertData = {
        sender_username: sender_username.trim(),
        receiver_username: receiver_username.trim(),
        content: content ? content.trim() : '',
        image_url: image_url || '',
        read: false,
        deleted: false
      };

      const { data: messageData, error } = await supabase
        .from('private_messages')
        .insert([insertData])
        .select();

      if (error) throw error;

      // Emit to both sender and receiver
      io.emit('new-private-message', messageData[0]);
      
    } catch (error) {
      console.error('❌ Private message error:', error);
      socket.emit('private-message-error', { error: 'Failed to send private message' });
    }
  });

  // ===== FIXED: NEW SOCKET EVENT FOR TEMP MESSAGE DELETION SYNC =====
  socket.on('temp-message-deleted', (data) => {
    const { tempId, username } = data;
    console.log('🗑️ Temp message deleted event received:', { tempId, username });
    
    // Broadcast to all clients that this temp message was deleted
    // This ensures other clients don't show temp messages that were deleted
    socket.broadcast.emit('temp-message-removed', { tempId, username });
  });

  // ===== FIXED: NEW SOCKET EVENT FOR MESSAGE CONFIRMATION =====
  socket.on('confirm-temp-message', async (data) => {
    try {
      const { tempId, content, username, image_url, reply_to, isDeleted } = data;
      console.log('✅ Confirm temp message via socket:', { tempId, username, isDeleted });
      
      // Use the confirmation endpoint
      const response = await fetch(`http://localhost:${port}/api/messages/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempId, content, username, image_url, reply_to, isDeleted })
      });
      
      const result = await response.json();
      
      if (result.success && !result.skipped) {
        // Notify the sender that their message was confirmed
        socket.emit('temp-message-confirmed', { 
          tempId, 
          realId: result.data.id,
          success: true 
        });
      } else if (result.skipped) {
        // Notify that the message was skipped (deleted before confirmation)
        socket.emit('temp-message-skipped', { tempId, reason: 'Message was deleted' });
      }
      
    } catch (error) {
      console.error('❌ Error confirming temp message via socket:', error);
      socket.emit('temp-message-error', { error: 'Failed to confirm message' });
    }
  });

  socket.on('join-private-chat', (data) => {
    const { username, otherUser } = data;
    const roomName = getPrivateChatRoomName(username, otherUser);
    socket.join(roomName);
    console.log(`👥 ${username} joined private chat room: ${roomName}`);
  });

  socket.on('leave-private-chat', (data) => {
    const { username, otherUser } = data;
    const roomName = getPrivateChatRoomName(username, otherUser);
    socket.leave(roomName);
    console.log(`👋 ${username} left private chat room: ${roomName}`);
  });

  // Listen for new private messages and deliver to specific users
  socket.on('private-message-typing-start', (data) => {
    const { sender, receiver, isTyping } = data;
    const roomName = getPrivateChatRoomName(sender, receiver);
    socket.to(roomName).emit('private-typing-indicator', {
      username: sender,
      isTyping: true
    });
  });

  socket.on('private-message-typing-stop', (data) => {
    const { sender, receiver, isTyping } = data;
    const roomName = getPrivateChatRoomName(sender, receiver);
    socket.to(roomName).emit('private-typing-indicator', {
      username: sender,
      isTyping: false
    });
  });

  // Handle disconnect properly
  socket.on('disconnect', (reason) => {
    console.log('🔌 User disconnected:', socket.id, 'Reason:', reason);
    
    // Find user by socket ID but DON'T remove them immediately
    // They stay in the list for 3 minutes due to the timeout
    let foundUsername = null;
    for (let [username, data] of onlineUsers.entries()) {
      if (data.socketId === socket.id) {
        foundUsername = username;
        // Update last seen but keep in list
        data.lastSeen = Date.now();
        data.isOnline = false;
        console.log('⏸️ User marked as inactive:', username);
        break;
      }
    }
    
    // Don't remove from list immediately - let the timeout handle it
    if (foundUsername) {
      io.emit('user-status-change', { 
        username: foundUsername, 
        status: 'away',
        onlineUsers: Array.from(onlineUsers.keys())
      });
    }
  });
  
  // Helper function to remove user from online list
  function removeUserFromOnlineList(username) {
    if (onlineUsers.has(username)) {
      onlineUsers.delete(username);
      
      // Get updated online users list
      const onlineUsersArray = Array.from(onlineUsers.keys());
      console.log('🗑️ After removal, online users:', onlineUsersArray);
      
      // Broadcast that user went offline
      io.emit('user-status-change', { 
        username, 
        status: 'offline',
        onlineUsers: onlineUsersArray
      });
    }
  }
});

// Helper function for private chat room names
function getPrivateChatRoomName(user1, user2) {
  const users = [user1, user2].sort();
  return `private_chat_${users[0]}_${users[1]}`;
}

// 3 MINUTE CLEANUP - Remove users after 3 minutes of inactivity
setInterval(() => {
  const now = Date.now();
  const removedUsers = [];
  
  for (let [username, data] of onlineUsers.entries()) {
    // 3 minute timeout (180000 milliseconds)
    if (now - data.lastSeen > onlineStatusTimeout) {
      console.log('⏰ Removing inactive user (3 minutes):', username);
      onlineUsers.delete(username);
      removedUsers.push(username);
    }
  }
  
  // Notify clients about removed users
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
}, 30000); // Check every 30 seconds

// Start server
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🔹 Command prefix: "${PREFIX}"`);
  console.log(`👥 Online users tracking: ACTIVE (3 minute timeout)`);
  console.log(`💾 SINGLE RESPONSE SYSTEM: ENABLED`);
  console.log(`🤖 EXCLUSIVE ROUTING: -ai → AI only, other commands → Bot only`);
  console.log(`🚫 DUPLICATE FIX: GUARANTEED no double responses!`);
  console.log(`🎯 PREFIX-FREE AI: ENABLED for private AI (auto-adds !ai prefix)`);
  console.log(`💬 Real-time messaging: ENABLED via Socket.io`);
  console.log(`🔌 Socket.io configuration: POLLING FIRST for Opera/mobile data compatibility`);
  console.log(`🔌 Socket.io events: new-message, message-deleted, user-status-change`);
  console.log(`🤫 PRIVATE MESSAGING: ENABLED via Supabase`);
  console.log(`🔒 Private endpoints: /private-messages/*`);
  console.log(`🔐 USER AUTHENTICATION: ENABLED (Server-side, no localStorage)`);
  console.log(`🔐 Password hashing: SIMPLE HASH (basic implementation)`);
  console.log(`🌐 Cross-browser compatibility: ENABLED`);
  console.log(`📱 OPERA FIX: Using polling transport for real-time updates with limited data`);
  
  // NEW: Added missing endpoints
  console.log(`🤖 NEW: POST /api/ai/private - Private AI endpoint`);
  console.log(`🤖 NEW: POST /api/ai/chat - Main AI chat endpoint`);
  console.log(`💬 NEW: GET /api/private/conversations - Get conversations`);
  console.log(`💬 NEW: GET /api/private/messages/:username - Get private messages`);
  console.log(`💬 NEW: POST /api/private/messages - Send private message`);
  console.log(`💬 NEW: PUT /api/private/messages/read - Mark as read`);
  console.log(`💬 NEW: GET /api/private/unread - Get unread count`);
  
  // NEW: Temp message sync system
  console.log(`🔄 NEW: POST /api/messages/confirm - Confirm temp messages with deletion check`);
  console.log(`🔄 NEW: Socket event: temp-message-deleted - Sync temp message deletions`);
  console.log(`🔄 NEW: Socket event: confirm-temp-message - Confirm temp messages via socket`);
  console.log(`🔄 NEW: Socket event: temp-message-removed - Remove temp messages on all clients`);
  
  console.log(`🔐 AUTHENTICATION ENDPOINTS:`);
  console.log(`   POST /api/register - User registration`);
  console.log(`   POST /api/login - User login`);
  console.log(`   POST /api/check-username - Check username availability`);
  console.log(`   POST /api/auth/register - User registration (client-compatible)`);
  console.log(`   POST /api/auth/login - User login (client-compatible)`);
  console.log(`   POST /api/auth/check-username - Check username availability (client-compatible)`);
  console.log(`   POST /api/auth/auto-login - Auto-login with token`);
  console.log(`   GET /api/user/profile/:username - Get user profile`);
  console.log(`   POST /api/user/profile - Update user profile`);
  console.log(`   GET /api/auth-test - Test all authentication endpoints`);
  console.log(`📨 MESSAGES ENDPOINTS:`);
  console.log(`   GET /api/messages - Get messages (client-compatible)`);
  console.log(`   POST /api/messages - Send message (client-compatible)`);
  console.log(`   DELETE /api/messages/:id - Delete message (client-compatible)`);
  console.log(`   POST /api/messages/confirm - Confirm temp messages with deletion check (NEW!)`);
  console.log(`📝 POSTS SYSTEM: ENABLED via Supabase`);
  console.log(`   GET /api/create-posts-table - Check posts table (NEW!)`);
  console.log(`   POST /api/create-posts-table - Create posts table if needed`);
  console.log(`   GET /api/posts - Get all posts with comments and likes`);
  console.log(`   POST /api/posts - Create a new post`);
  console.log(`   POST /api/posts/:postId/comments - Add a comment to a post`);
  console.log(`   POST /api/posts/:postId/like - Like/unlike a post`);
  console.log(`   GET /api/posts/user/:username - Get posts for a specific user`);
  console.log(`   DELETE /api/posts/:postId - Delete a post (author only)`);
  console.log(`🧪 Test Supabase (GET): http://localhost:${port}/test-supabase`);
  console.log(`🧪 Test Message (POST): http://localhost:${port}/test-message`);
  console.log(`🔍 Debug ALL Commands: http://localhost:${port}/debug-all-commands`);
  console.log(`🔍 Debug Private Messages: http://localhost:${port}/debug-private-messages`);
  console.log(`🎯 PREFIX-FREE USAGE IN PRIVATE AI:`);
  console.log(`   "hello" → automatically becomes "!ai hello"`);
  console.log(`   "help" → automatically becomes "!help"`);
  console.log(`   "ai tell me a joke" → automatically becomes "!ai tell me a joke"`);
  console.log(`   "!ping" → works normally (prefix already present)`);
  console.log(`🔄 TEMP MESSAGE SYNC SYSTEM:`);
  console.log(`   • Temp messages now check deletion status before saving`);
  console.log(`   • Deleted temp messages are skipped server-side`);
  console.log(`   • Deleted temp messages are removed from all clients`);

  if (isRender && renderExternalUrl) {
    console.log(`🌐 Render External URL: ${renderExternalUrl}`);
    console.log(`⏱️ UptimeRobot monitoring URL: ${renderExternalUrl}/health`);
    console.log(`🧪 Test Supabase: ${renderExternalUrl}/test-supabase`);
    console.log(`🧪 Test Message: ${renderExternalUrl}/test-message`);
    console.log(`🔍 Debug ALL Commands: ${renderExternalUrl}/debug-all-commands`);
    console.log(`🔍 Debug Private Messages: ${renderExternalUrl}/debug-private-messages`);
    console.log(`🧪 Test Private Message (GET): ${renderExternalUrl}/test-private-messages`);
    console.log(`🔐 Test Authentication: ${renderExternalUrl}/api/auth-test`);
    console.log(`📝 Test Posts Table: ${renderExternalUrl}/api/create-posts-table`);
    console.log(`👤 Test Profile: ${renderExternalUrl}/api/test-profile`);
    console.log(`👤 Create Profiles Table: ${renderExternalUrl}/api/create-user-profiles-table`);
  }
});

// Add error handling middleware
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
        'POST /api/messages/confirm', // NEW
        'POST /api/command'
      ],
      profiles: [
        'GET /api/user/profile',
        'POST /api/user/profile',  // Added POST method
        'PUT /api/user/profile',
        'GET /api/user/profile/:username',
        'GET /api/test-profile',
        'GET /api/create-user-profiles-table'
      ],
      ai: [
        'POST /api/ai/private',
        'POST /api/ai/chat'
      ],
      privateMessages: [
        'GET /api/private/conversations',
        'GET /api/private/messages/:username',
        'POST /api/private/messages',
        'GET /api/private/unread',
        'PUT /api/private/messages/read',
        'DELETE /api/private/messages/:id'
      ],
      posts: [
        'GET /api/posts',
        'POST /api/posts',
        'POST /api/posts/:postId/comments',
        'POST /api/posts/:postId/like',
        'GET /api/posts/user/:username',
        'DELETE /api/posts/:postId'
      ],
      debug: [
        'GET /test-supabase',
        'GET /debug-all-commands',
        'GET /debug-private-messages',
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
