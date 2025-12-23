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

// --- CUT HERE ---
// --- CUT HERE ---
// ===== SUPABASE POSTS AND COMMENTS ENDPOINTS =====

// Create posts table if it doesn't exist
app.post('/api/create-posts-table', async (req, res) => {
  try {
    console.log('🔧 Creating posts table...');
    
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
            comments_count INTEGER DEFAULT 0
          );
          `,
          "4. Create comments table:",
          `
          CREATE TABLE IF NOT EXISTS post_comments (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            post_id UUID REFERENCES posts(id) ON DELETE CASCADE,
            author_username TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
          `
        ]
      });
    } else if (checkError) {
      throw checkError;
    } else {
      console.log('✅ Posts table exists');
      res.json({
        success: true,
        message: "Posts table exists",
        sampleData: tableCheck?.[0]
      });
    }

  } catch (error) {
    console.error('❌ Error checking posts table:', error);
    res.status(500).json({ 
      success: false,
      error: "Error checking table: " + error.message 
    });
  }
});

// Get all posts with comments and like status
app.get('/api/posts', async (req, res) => {
  try {
    const { username } = req.query; // Current user for like status
    
    console.log('📝 Fetching posts from Supabase...');

    // Get posts with author info
    const { data: posts, error: postsError } = await supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });

    if (postsError) {
      console.error('❌ Error fetching posts:', postsError);
      return res.status(500).json({ error: 'Failed to fetch posts' });
    }

    // For each post, get comments and check if current user liked it
    const postsWithDetails = await Promise.all(
      (posts || []).map(async (post) => {
        // Get comments for this post
        const { data: comments } = await supabase
          .from('post_comments')
          .select('*')
          .eq('post_id', post.id)
          .order('created_at', { ascending: true });

        // Check if current user liked this post
        let userLiked = false;
        if (username) {
          const { data: like } = await supabase
            .from('post_likes')
            .select('id')
            .eq('post_id', post.id)
            .eq('username', username)
            .single();
          userLiked = !!like;
        }

        return {
          ...post,
          comments: comments || [],
          userLiked: userLiked,
          // For compatibility with existing frontend
          author: post.author_username,
          timestamp: post.created_at,
          likes: post.likes_count || 0,
          media: post.media_url ? {
            url: post.media_url,
            type: post.media_type || 'image'
          } : null
        };
      })
    );

    console.log(`✅ Found ${postsWithDetails.length} posts`);
    res.json(postsWithDetails);

  } catch (error) {
    console.error('❌ Error in get posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Create a new post
app.post('/api/posts', async (req, res) => {
  try {
    const { author_username, content, media_url, media_type } = req.body;

    console.log('📝 Creating new post:', { author_username, content, media_url, media_type });

    if (!author_username || !content) {
      return res.status(400).json({ error: "Author and content are required" });
    }

    const postData = {
      author_username: author_username.trim(),
      content: content.trim(),
      media_url: media_url || null,
      media_type: media_type || null,
      likes_count: 0,
      comments_count: 0
    };

    const { data: post, error } = await supabase
      .from('posts')
      .insert([postData])
      .select();

    if (error) {
      console.error('❌ Error creating post:', error);
      return res.status(500).json({ error: "Failed to create post: " + error.message });
    }

    console.log('✅ Post created successfully:', post[0]?.id);

    res.status(201).json({
      ...post[0],
      author: post[0].author_username,
      timestamp: post[0].created_at,
      likes: 0,
      comments: [],
      userLiked: false,
      media: post[0].media_url ? {
        url: post[0].media_url,
        type: post[0].media_type || 'image'
      } : null
    });

  } catch (error) {
    console.error('❌ Error creating post:', error);
    res.status(500).json({ error: "Failed to create post: " + error.message });
  }
});

// Add a comment to a post
app.post('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { author_username, content } = req.body;

    console.log('💬 Adding comment to post:', { postId, author_username, content });

    if (!author_username || !content) {
      return res.status(400).json({ error: "Author and content are required" });
    }

    // First, verify the post exists
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Create the comment
    const commentData = {
      post_id: postId,
      author_username: author_username.trim(),
      content: content.trim()
    };

    const { data: comment, error } = await supabase
      .from('post_comments')
      .insert([commentData])
      .select();

    if (error) {
      console.error('❌ Error adding comment:', error);
      return res.status(500).json({ error: "Failed to add comment: " + error.message });
    }

    // Update comments count on the post
    await supabase
      .from('posts')
      .update({ 
        comments_count: await getCommentsCount(postId),
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);

    console.log('✅ Comment added successfully:', comment[0]?.id);

    res.status(201).json(comment[0]);

  } catch (error) {
    console.error('❌ Error adding comment:', error);
    res.status(500).json({ error: "Failed to add comment: " + error.message });
  }
});

// Like a post
app.post('/api/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { username } = req.body;

    console.log('❤️ Liking post:', { postId, username });

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    // First, verify the post exists
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Check if user already liked the post
    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('username', username)
      .single();

    if (existingLike) {
      // Unlike the post
      await supabase
        .from('post_likes')
        .delete()
        .eq('id', existingLike.id);
    } else {
      // Like the post
      await supabase
        .from('post_likes')
        .insert([{
          post_id: postId,
          username: username
        }]);
    }

    // Update likes count
    const newLikesCount = await getLikesCount(postId);
    await supabase
      .from('posts')
      .update({ 
        likes_count: newLikesCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);

    console.log('✅ Post like updated. New count:', newLikesCount);

    res.json({ 
      success: true, 
      likesCount: newLikesCount,
      userLiked: !existingLike
    });

  } catch (error) {
    console.error('❌ Error liking post:', error);
    res.status(500).json({ error: "Failed to like post: " + error.message });
  }
});

// Get posts for a specific user
app.get('/api/posts/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { currentUser } = req.query; // For like status

    console.log('📝 Fetching posts for user:', username);

    const { data: posts, error } = await supabase
      .from('posts')
      .select('*')
      .eq('author_username', username)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching user posts:', error);
      return res.status(500).json({ error: 'Failed to fetch user posts' });
    }

    // Add comments and like status
    const postsWithDetails = await Promise.all(
      (posts || []).map(async (post) => {
        const { data: comments } = await supabase
          .from('post_comments')
          .select('*')
          .eq('post_id', post.id)
          .order('created_at', { ascending: true });

        let userLiked = false;
        if (currentUser) {
          const { data: like } = await supabase
            .from('post_likes')
            .select('id')
            .eq('post_id', post.id)
            .eq('username', currentUser)
            .single();
          userLiked = !!like;
        }

        return {
          ...post,
          comments: comments || [],
          userLiked: userLiked,
          author: post.author_username,
          timestamp: post.created_at,
          likes: post.likes_count || 0,
          media: post.media_url ? {
            url: post.media_url,
            type: post.media_type || 'image'
          } : null
        };
      })
    );

    console.log(`✅ Found ${postsWithDetails.length} posts for user ${username}`);
    res.json(postsWithDetails);

  } catch (error) {
    console.error('❌ Error in get user posts:', error);
    res.status(500).json({ error: 'Failed to fetch user posts' });
  }
});

// Delete a post (only by author)
app.delete('/api/posts/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const { username } = req.body; // Current user trying to delete

    console.log('🗑️ Deleting post:', { postId, username });

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    // First, verify the post exists and user is the author
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('author_username')
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (post.author_username !== username) {
      return res.status(403).json({ error: "You can only delete your own posts" });
    }

    // Delete the post (cascade will delete comments and likes)
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);

    if (deleteError) {
      console.error('❌ Error deleting post:', deleteError);
      return res.status(500).json({ error: "Failed to delete post: " + deleteError.message });
    }

    console.log('✅ Post deleted successfully');

    res.json({ success: true, message: "Post deleted successfully" });

  } catch (error) {
    console.error('❌ Error deleting post:', error);
    res.status(500).json({ error: "Failed to delete post: " + error.message });
  }
});

// Helper function to get comments count
async function getCommentsCount(postId) {
  const { count, error } = await supabase
    .from('post_comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  return count || 0;
}

// Helper function to get likes count
async function getLikesCount(postId) {
  const { count, error } = await supabase
    .from('post_likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);

  return count || 0;
}

// Real-time posts polling endpoint (alternative to WebSockets)
app.get('/api/posts/updates', async (req, res) => {
  try {
    const { lastUpdate } = req.query;
    
    // Get posts updated since lastUpdate
    const query = supabase
      .from('posts')
      .select('*')
      .order('updated_at', { ascending: false });

    if (lastUpdate) {
      query.gt('updated_at', new Date(lastUpdate).toISOString());
    }

    const { data: posts, error } = await query;

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      posts: posts || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fetching post updates:', error);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

// ===== ADD TABLE CREATION ENDPOINT =====

// Create private_messages table if it doesn't exist
app.post('/api/create-private-messages-table', async (req, res) => {
  try {
    console.log('🔧 Creating private_messages table...');
    
    // This is a conceptual endpoint - in practice you'd need to run SQL in Supabase dashboard
    // But we can check and provide instructions
    
    const { data: tableCheck, error: checkError } = await supabase
      .from('private_messages')
      .select('*')
      .limit(1);

    if (checkError && checkError.code === '42P01') {
      // Table doesn't exist
      console.log('❌ private_messages table does not exist');
      
      res.json({
        success: false,
        error: "Table doesn't exist",
        instructions: [
          "1. Go to your Supabase dashboard",
          "2. Go to the SQL Editor",
          "3. Run this SQL to create the table:",
          `
          CREATE TABLE IF NOT EXISTS private_messages (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            sender_username TEXT NOT NULL,
            receiver_username TEXT NOT NULL,
            content TEXT NOT NULL,
            image_url TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            read BOOLEAN DEFAULT FALSE,
            message_type TEXT DEFAULT 'text',
            deleted BOOLEAN DEFAULT FALSE
          );
          `,
          "4. Enable RLS (Row Level Security) if needed",
          "5. Add policies to allow insert, select, update"
        ]
      });
    } else if (checkError) {
      throw checkError;
    } else {
      console.log('✅ private_messages table exists');
      res.json({
        success: true,
        message: "private_messages table exists",
        sampleData: tableCheck?.[0]
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

// ===== ADD ALTERNATIVE PRIVATE MESSAGING =====

// Alternative private messaging using existing chatter table with type field
app.post('/api/private/alt-messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, image_url } = req.body;

    console.log('📨 Alternative private message:', { sender_username, receiver_username, content, image_url });

    if (!sender_username || !receiver_username) {
      return res.status(400).json({ error: "Sender and receiver usernames are required" });
    }

    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ error: "Content or image is required" });
    }

    // Use chatter table but mark as private message
    const insertData = {
      content: content ? content.trim() : '',
      username: sender_username.trim(),
      image_url: image_url || '',
      reply_to: receiver_username.trim(), // Using reply_to field to store receiver
      message_type: 'private', // Custom field to identify private messages
      deleted: false
    };

    console.log('📝 Inserting alternative private message:', insertData);

    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Alternative private message failed:', error);
      return res.status(500).json({ error: "Failed to send message: " + error.message });
    }

    console.log('✅ Alternative private message saved. ID:', data[0]?.id);
    
    // Broadcast via Socket.io
    io.emit('new-private-message', {
      ...data[0],
      sender_username: sender_username,
      receiver_username: receiver_username
    });
    
    res.status(201).json(data[0]);

  } catch (error) {
    console.error('❌ Failed to save alternative private message:', error);
    res.status(500).json({ error: "Failed to send message: " + error.message });
  }
});

// Get alternative private messages
app.get('/api/private/alt-messages/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { otherUser } = req.query;
    
    if (!username || !otherUser) {
      return res.status(400).json({ error: "Username and otherUser parameters are required" });
    }

    // Get messages where user is sender or receiver (excluding deleted)
    const { data: messages, error } = await supabase
      .from('chatter')
      .select('*')
      .eq('message_type', 'private')
      .eq('deleted', false)
      .or(`and(username.eq.${username},reply_to.eq.${otherUser}),and(username.eq.${otherUser},reply_to.eq.${username})`)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Database error fetching alt messages:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    // Transform data to match expected format
    const transformedMessages = (messages || []).map(msg => ({
      id: msg.id,
      sender_username: msg.username,
      receiver_username: msg.reply_to,
      content: msg.content,
      image_url: msg.image_url,
      read: true, // Assume read since we're fetching
      deleted: false,
      created_at: msg.created_at
    }));

    res.json(transformedMessages);

  } catch (error) {
    console.error('❌ Error fetching alternative private messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages: ' + error.message });
  }
});

// ===== ENHANCED DEBUGGING ENDPOINTS =====

// GET endpoint to test private messages (for browser testing)
app.get('/test-private-messages', async (req, res) => {
  try {
    console.log('🧪 GET: Testing private messages creation...');
    
    // Create a test private message
    const testData = {
      sender_username: 'test_user1',
      receiver_username: 'test_user2',
      content: 'This is a test private message from GET endpoint!',
      image_url: '',
      read: false,
      deleted: false
    };

    const { data, error } = await supabase
      .from('private_messages')
      .insert([testData])
      .select();

    if (error) {
      console.error('❌ GET Test private message failed:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }

    console.log('✅ GET Test private message saved:', data[0]);
    
    // Broadcast via Socket.io
    io.emit('new-private-message', data[0]);
    
    res.json({ 
      success: true, 
      message: 'GET Test private message saved successfully',
      data: data[0],
      nextSteps: [
        'Check all messages: GET /private-messages?username=test_user1',
        'Check conversations: GET /private-messages/conversations/test_user1',
        'Check between users: GET /private-messages/test_user1/test_user2'
      ]
    });

  } catch (error) {
    console.error('❌ GET Test private message error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST endpoint to test private messages (for API testing)
app.post('/test-private-messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content } = req.body;
    
    console.log('🧪 POST: Creating test private message:', { sender_username, receiver_username, content });

    if (!sender_username || !receiver_username || !content) {
      return res.status(400).json({ error: "Sender, receiver, and content are required" });
    }

    const testData = {
      sender_username: sender_username.trim(),
      receiver_username: receiver_username.trim(),
      content: content.trim(),
      image_url: '',
      read: false,
      deleted: false
    };

    const { data, error } = await supabase
      .from('private_messages')
      .insert([testData])
      .select();

    if (error) {
      console.error('❌ POST Test private message failed:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }

    console.log('✅ POST Test private message saved:', data[0]);
    
    // Broadcast via Socket.io
    io.emit('new-private-message', data[0]);
    res.json({ 
      success: true, 
      message: 'POST Test private message saved successfully',
      data: data[0]
    });

  } catch (error) {
    console.error('❌ POST Test private message error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Enhanced debug endpoint with more details
app.get('/debug-private-messages', async (req, res) => {
  try {
    console.log('🔍 Debugging private_messages table...');
    
    // Check table structure
    const { data: tableInfo, error: tableError } = await supabase
      .from('private_messages')
      .select('*')
      .limit(1);

    if (tableError) {
      console.error('❌ Table error:', tableError);
      return res.status(500).json({ 
        success: false,
        error: 'Table error: ' + tableError.message,
        details: 'The private_messages table might not exist or have RLS issues'
      });
    }

    // Count total messages (excluding deleted)
    const { count: totalCount, error: countError } = await supabase
      .from('private_messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_username', 'test_user1')
      .eq('read', false)
      .eq('deleted', false);

    if (countError) {
      console.error('❌ Count error:', countError);
      return res.status(500).json({ 
        success: false,
        error: 'Count error: ' + countError.message 
      });
    }

    // Get all messages (limit 10 for preview, excluding deleted)
    const { data: allMessages, error: messagesError } = await supabase
      .from('private_messages')
      .select('*')
      .eq('deleted', false)
      .order('created_at', { ascending: false })
      .limit(10);

    if (messagesError) {
      console.error('❌ Messages error:', messagesError);
      return res.status(500).json({ 
        success: false,
        error: 'Messages error: ' + messagesError.message 
      });
    }

    res.json({
      success: true,
      tableExists: true,
      totalMessages: totalCount || 0,
      sampleMessages: allMessages || [],
      message: totalCount === 0 ? 
        'Table exists but has no messages. Use /test-private-messages to create test data.' : 
        'Private messages table debug information',
      testEndpoints: {
        createTestMessageGET: 'GET /test-private-messages',
        createTestMessagePOST: 'POST /test-private-messages',
        getAllMessages: 'GET /private-messages?username=test_user1',
        getConversations: 'GET /private-messages/conversations/test_user1'
      }
    });

  } catch (error) {
    console.error('❌ Debug error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Debug error: ' + error.message 
    });
  }
});

// FIXED: Enhanced private messages endpoint
app.get('/private-messages', async (req, res) => {
  try {
    const { username } = req.query;
    
    console.log('📨 Fetching private messages for username:', username);

    if (!username) {
      return res.status(400).json({ 
        error: "Username query parameter is required",
        example: "/private-messages?username=test_user1" 
      });
    }

    // Try exact match first, then case-insensitive
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .eq('deleted', false) // Exclude deleted messages
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Database error:', error);
      throw error;
    }

    console.log(`✅ Found ${messages?.length || 0} private messages for ${username}`);
    
    if (messages.length === 0) {
      return res.json({
        messages: [],
        info: 'No private messages found',
        suggestion: 'Use GET /test-private-messages to create test data'
      });
    }
    
    res.json(messages);
  } catch (error) {
    console.error('❌ Error fetching private messages:', error);
    res.status(500).json({ error: 'Failed to fetch private messages: ' + error.message });
  }
});

// ===== SUPABASE POSTS AND COMMENTS ENDPOINTS =====

// FIXED: Add GET endpoint for /api/create-posts-table
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
            deleted BOOLEAN DEFAULT FALSE
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
            deleted BOOLEAN DEFAULT FALSE
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

// Enhanced Uptime System for Render
if (config.autoUptime?.enable || isRender) {
  const myUrl = renderExternalUrl || config.autoUptime?.url || `http://localhost:${port}`;

  global.utils.log.info("RENDER UPTIME", `Monitoring endpoint available at: ${myUrl}/uptime`);
  global.utils.log.info("UPTIMEROBOT TIP", `Add this URL to UptimeRobot: ${myUrl}/health`);

  // Simple keep-alive endpoint
  app.get("/uptime", (req, res) => {
    res.status(200).json({
      status: "OK",
      timestamp: Date.now(),
      uptime: process.uptime(),
      platform: "Render",
      monitor: "UptimeRobot"
    });
  });

  // Comprehensive health check
  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      version: require('./package.json').version,
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

  // Auto-ping for Render's inactivity timeout
  if (isRender) {
    const pingInterval = setInterval(() => {
      axios.get(`${myUrl}/uptime`)
        .then(() => global.utils.log.info("RENDER PING", "Keeping Render instance alive"))
        .catch(err => global.utils.log.err("RENDER PING", err.message));
    }, 4 * 60 * 1000); // Ping every 4 minutes

    process.on('exit', () => clearInterval(pingInterval));
  }
}

// Command loader setup
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

// Create commands directory if it doesn't exist
fs.ensureDirSync(COMMANDS_DIR);
loadCommands();

// Handle input
function handleCommand(input) {
  if (!input.startsWith(PREFIX)) return null;
  const args = input.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const text = args.join(" ");
  return { commandName, args, text };
}

// ===== PRIVATE MESSAGING ENDPOINTS =====

// Get all conversations for a user
app.get('/private-messages/conversations/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    // Get distinct conversations (people the user has chatted with)
    const { data: conversations, error } = await supabase
      .from('private_messages')
      .select('sender_username, receiver_username, content, created_at, read')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .eq('deleted', false) // Exclude deleted messages
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Process to get unique conversations with last message
    const conversationMap = new Map();
    
    conversations.forEach(msg => {
      const otherUser = msg.sender_username === username ? msg.receiver_username : msg.sender_username;
      
      if (!conversationMap.has(otherUser) || 
          new Date(msg.created_at) > new Date(conversationMap.get(otherUser).lastMessageTime)) {
        conversationMap.set(otherUser, {
          username: otherUser,
          lastMessage: msg.content,
          lastMessageTime: msg.created_at,
          unread: msg.receiver_username === username && !msg.read,
          isSender: msg.sender_username === username
        });
      }
    });

    const conversationList = Array.from(conversationMap.values())
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

    res.json(conversationList);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get messages between two users
app.get('/private-messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`and(sender_username.eq.${user1},receiver_username.eq.${user2}),and(sender_username.eq.${user2},receiver_username.eq.${user1})`)
      .eq('deleted', false) // Exclude deleted messages
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Mark messages as read when fetched
    await supabase
      .from('private_messages')
      .update({ read: true })
      .eq('receiver_username', user1)
      .eq('sender_username', user2)
      .eq('read', false)
      .eq('deleted', false);

    res.json(messages || []);
  } catch (error) {
    console.error('Error fetching private messages:', error);
    res.status(500).json({ error: 'Failed to fetch private messages' });
  }
});

// FIXED: Send private message - RLS issue resolved
app.post('/private-messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, image_url } = req.body;

    console.log('📨 Private message:', { sender_username, receiver_username, content, image_url });

    if (!sender_username || !receiver_username) {
      return res.status(400).json({ error: "Sender and receiver usernames are required" });
    }

    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ error: "Content or image is required" });
    }

    const insertData = {
      sender_username: sender_username.trim(),
      receiver_username: receiver_username.trim(),
      content: content ? content.trim() : '',
      image_url: image_url || '',
      read: false,
      deleted: false
    };

    console.log('📝 Inserting private message:', insertData);

    const { data, error } = await supabase
      .from('private_messages')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Private message insert failed:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message,
        details: 'This might be due to RLS policies. Check your database RLS settings.'
      });
    }

    console.log('✅ Private message saved. ID:', data[0]?.id);
    
    // Broadcast via Socket.io to both users
    io.emit('new-private-message', data[0]);
    
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save private message:', error);
    res.status(500).json({ error: "Failed to send private message: " + error.message });
  }
});

// Get unread message count
app.get('/private-messages/unread/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    const { count, error } = await supabase
      .from('private_messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_username', username)
      .eq('read', false)
      .eq('deleted', false); // Don't count deleted messages

    if (error) throw error;

    res.json({ unreadCount: count || 0 });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// Mark messages as read
app.put('/private-messages/read', async (req, res) => {
  try {
    const { sender_username, receiver_username } = req.body;

    const { error } = await supabase
      .from('private_messages')
      .update({ read: true })
      .eq('sender_username', sender_username)
      .eq('receiver_username', receiver_username)
      .eq('read', false)
      .eq('deleted', false); // Don't update deleted messages

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// ===== PUBLIC CHAT ENDPOINTS =====

// GET messages (legacy endpoint) - FIXED: Add deleted flag check
app.get('/messages', async (req, res) => {
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
    res.status(500).json({ error: 'Server error' });
  }
});

// POST messages (legacy endpoint) - FIXED: Proper handling for regular messages
app.post('/messages', async (req, res) => {
  try {
    const { content, username, image_url, reply_to } = req.body;

    console.log('📨 Received message via legacy endpoint:', { content, username, image_url, reply_to });

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

    console.log('📝 Inserting message to Supabase via legacy endpoint:', insertData);

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
    
    console.log('✅ Message saved successfully via legacy endpoint. ID:', data[0]?.id);
    
    // BROADCAST NEW MESSAGE TO ALL CLIENTS IMMEDIATELY
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save message via legacy endpoint:', error);
    res.status(500).json({ error: "Failed to save message: " + error.message });
  }
});

// Image upload endpoint
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const fileBuffer = req.file.buffer;
    const fileName = `${Date.now()}-${req.file.originalname}`;
    const filePath = `images/${fileName}`;

    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('chat-images')
      .upload(filePath, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) throw error;

    // Get public URL
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

// DELETE messages (legacy endpoint) - FIXED: Use soft delete
app.delete('/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    
    console.log('🗑️ Deleting message (legacy):', { id, username });
    
    // First check if the message exists
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
      console.log('⚠️ Soft delete failed, trying hard delete...');
      
      // Try hard delete
      const { error: deleteError } = await supabase
        .from('chatter')
        .delete()
        .eq('id', id);
      
      if (deleteError) throw deleteError;
    }
    
    console.log('✅ Message deleted (legacy):', id);
    
    // Broadcast deletion via Socket.io
    io.emit('message-deleted', id);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Delete error (legacy):', error);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// FIXED: Function to save ANY bot response to Supabase
async function saveBotResponseToSupabase(content, originalCommand, commandType = 'AI') {
  try {
    console.log(`🔄 Attempting to save ${commandType} response to Supabase...`);
    console.log('Content:', content);
    console.log('Original Command:', originalCommand);
    
    // FIXED: Use proper values for all fields
    const insertData = {
      content: content || `${commandType} Response`, 
      username: commandType === 'AI' ? 'AI' : 'Bot',
      image_url: '',
      reply_to: originalCommand || '',
      deleted: false
    };
    
    console.log('📝 Insert data:', insertData);
    
    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Supabase insertion error:', error);
      console.error('❌ Error details:', JSON.stringify(error, null, 2));
      
      // If there's an issue, try minimal insert
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        console.log('🔄 Retrying with minimal fields...');
        const minimalData = {
          content: content || `${commandType} Response`,
          username: commandType === 'AI' ? 'AI' : 'Bot'
        };
        
        const { data: retryData, error: retryError } = await supabase
          .from('chatter')
          .insert([minimalData])
          .select();
          
        if (retryError) {
          throw retryError;
        }
        console.log(`✅ ${commandType} response saved to Supabase (minimal fields). ID:`, retryData[0]?.id);
        
        // BROADCAST BOT RESPONSE TO ALL CLIENTS IMMEDIATELY
        io.emit('new-message', retryData[0]);
        return retryData;
      }
      throw error;
    }
    
    console.log(`✅ ${commandType} response saved to Supabase. ID:`, data[0]?.id);
    
    // BROADCAST BOT RESPONSE TO ALL CLIENTS IMMEDIATELY
    io.emit('new-message', data[0]);
    return data;
  } catch (error) {
    console.error(`❌ Error saving ${commandType} response to Supabase:`, error);
    throw error;
  }
}

// TEST ENDPOINTS: Check if we can save to Supabase
app.get('/test-supabase', async (req, res) => {
  try {
    console.log('🧪 Testing Supabase connection (GET)...');
    
    // Test 1: Check if we can read from Supabase
    const { data: readData, error: readError } = await supabase
      .from('chatter')
      .select('*')
      .eq('deleted', false) // Exclude deleted messages
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

    // Test 2: Try to insert a regular message
    const testData = {
      content: 'Test regular message from server',
      username: 'TestBot',
      image_url: '',
      reply_to: '',
      deleted: false
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

// DEBUG: Check what's happening with ALL commands
app.get('/debug-all-commands', async (req, res) => {
  try {
    console.log('🔍 Debugging ALL command responses...');
    
    // Test different commands
    const testCommands = [
      { message: '!help', source: 'main-chat' },
      { message: '!ping', source: 'main-chat' },
      { message: '!ai hello world', source: 'main-chat' }
    ];

    const results = [];

    for (const testCmd of testCommands) {
      try {
        console.log(`🧪 Testing command: ${testCmd.message}`);
        
        const response = await axios.post('http://localhost:3000/api/command', testCmd, {
          headers: { 'Content-Type': 'application/json' }
        });

        results.push({
          command: testCmd.message,
          success: true,
          response: response.data.reply || response.data
        });
      } catch (error) {
        results.push({
          command: testCmd.message,
          success: false,
          error: error.message
        });
      }
    }

    // Check what got saved to database (excluding deleted)
    const { data: savedMessages } = await supabase
      .from('chatter')
      .select('*')
      .eq('deleted', false)
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({
      success: true,
      commandTests: results,
      savedMessages: savedMessages,
      message: 'All command debug test completed'
    });

  } catch (error) {
    console.error('❌ All commands debug error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// NEW: Test regular message endpoint
app.post('/test-message', async (req, res) => {
  try {
    const { content, username } = req.body;
    
    console.log('🧪 Testing regular message:', { content, username });

    if (!content || !username) {
      return res.status(400).json({ error: "Content and username required" });
    }

    const testData = {
      content: content,
      username: username,
      image_url: '',
      reply_to: '',
      deleted: false
    };

    const { data, error } = await supabase
      .from('chatter')
      .insert([testData])
      .select();

    if (error) {
      console.error('❌ Test message failed:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }

    console.log('✅ Test message saved:', data[0]);
    
    // Broadcast via Socket.io
    io.emit('new-message', data[0]);
    res.json({ 
      success: true, 
      message: 'Test message saved successfully',
      data: data[0]
    });

  } catch (error) {
    console.error('❌ Test message error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===== MODIFIED: Command API handler with prefix-free support for private AI =====
app.post("/api/command", async (req, res) => {
  try {
    let { message, source = 'main-chat' } = req.body;
    console.log('📨 Received command:', { message, source });
    
    if (!message) return res.status(400).json({ reply: "❌ Message is required" });

    // ===== NEW: AUTO-PREFIX FOR PRIVATE AI =====
    if (source === 'private-ai' && !message.startsWith(PREFIX)) {
      console.log('🤫 Private AI detected - checking for prefix-free commands...');
      
      const trimmedMessage = message.trim().toLowerCase();
      const firstWord = trimmedMessage.split(' ')[0];
      
      // Check if it's a direct command word without prefix
      const commandWords = ['ai', 'help', 'ping', 'prefix', 'ask', 'chat'];
      
      if (commandWords.includes(firstWord)) {
        // It's a command - add the prefix
        message = PREFIX + message;
        console.log('🔍 Auto-added prefix to command:', message);
      } else {
        // It's regular text - treat as AI command
        message = PREFIX + 'ai ' + message;
        console.log('🤖 Auto-treated as AI command:', message);
      }
    }
    // ===== END AUTO-PREFIX =====

    // Handle prefix command separately
    if (message.trim().toLowerCase() === "prefix") {
      const reply = `🔹 My command prefix is: \`${PREFIX}\``;
      
      // Save to main chat only
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

    // ✅ COMPLETELY FIXED: EXCLUSIVE SINGLE RESPONSE SYSTEM
    let finalReply = null;
    let responder = null;

    // AI COMMANDS - ONLY AI RESPONDS
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
    } 
    // BOT COMMANDS - ONLY BOT RESPONDS
    else {
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

    // ✅ SINGLE RESPONSE SAVING - Only save ONE response
    if (finalReply && source === 'main-chat') {
      console.log(`💾 Saving ${responder} response to Supabase...`);
      try {
        await saveBotResponseToSupabase(finalReply, cmd.commandName, responder);
      } catch (saveError) {
        console.error(`❌ Failed to save ${responder} response:`, saveError);
      }
    }

    // ✅ SINGLE RESPONSE RETURN - Only return ONE response
    if (finalReply) {
      return res.json({ reply: finalReply });
    } else {
      return res.json({ reply: "❌ No response generated" });
    }

  } catch (error) {
    console.error("❌ Server Error:", error);
    const errorReply = `❌ Server Error: ${error.message}`;
    
    // Save error response
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

// Add endpoint to get online users
app.get('/online-users', (req, res) => {
  const onlineUsersArray = Array.from(onlineUsers.keys());
  console.log('Current online users:', onlineUsersArray);
  res.json(onlineUsersArray);
});

// ===== ENHANCED SOCKET.IO REAL-TIME MESSAGING =====

// Socket.io connection handling - 3 MINUTE ONLINE STATUS
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
  console.log(`🔍 NEW: GET /api/debug/private-messages-structure - Debug table structure`);
  
  console.log(`🔍 NEW: GET /debug-private-messages - Debug private messages table`);
  console.log(`🧪 NEW: GET /test-private-messages - Test private message creation (GET)`);
  console.log(`🧪 NEW: POST /test-private-messages - Test private message creation (POST)`);
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
  console.log(`🔍 Debug Table Structure: http://localhost:${port}/api/debug/private-messages-structure`);
  console.log(`📝 Test Posts Table: http://localhost:${port}/api/create-posts-table`);
  console.log(`🎯 PREFIX-FREE USAGE IN PRIVATE AI:`);
  console.log(`   "hello" → automatically becomes "!ai hello"`);
  console.log(`   "help" → automatically becomes "!help"`);
  console.log(`   "ai tell me a joke" → automatically becomes "!ai tell me a joke"`);
  console.log(`   "!ping" → works normally (prefix already present)`);

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
