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
const crypto = require('crypto');

// Remove jsonwebtoken import since it's not installed
// const jwt = require('jsonwebtoken');

// Initialize apps
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// ===== ULTRA-COMPATIBLE SOCKET.IO CONFIGURATION FOR OPERA & MOBILE DATA =====
// Force polling only for maximum compatibility with Opera Free/Mini
const io = new Server(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false
  },
  transports: ['polling'], // FORCE POLLING ONLY for Opera compatibility
  allowUpgrades: false, // Don't upgrade to websocket
  pingTimeout: 30000, // 30 seconds for mobile data
  pingInterval: 15000, // 15 seconds for keep-alive
  cookie: false,
  maxHttpBufferSize: 1e5, // 100KB max message size
  connectTimeout: 45000, // 45 seconds for slow connections
  // Low-bandwidth optimization
  httpCompression: false, // Disable compression for Opera Mini
  wsEngine: require('ws').Server,
  // Opera Mini specific optimizations
  perMessageDeflate: false,
  // Mobile data optimization
  allowEIO3: true, // Enable Engine.IO v3 for older clients
  // Force JSON for all messages (no binary)
  parser: require('socket.io-parser'),
  // Add these for Opera compatibility
  allowRequest: (req, callback) => {
    callback(null, true); // Allow all origins
  }
});

// Track online users - 5 MINUTE TIMEOUT for mobile users
const onlineUsers = new Map();
const onlineStatusTimeout = 300000; // 5 minutes = 300000 milliseconds

// ===== PERMANENT BOT USERS (ALWAYS ONLINE, GREEN DOT) =====
const PERMANENT_ONLINE_USERS = ['AI', 'Bot']; // Add any other bot usernames here

// Function to add/keep permanent bot users online
function addPermanentOnlineUsers() {
  const now = Date.now();
  PERMANENT_ONLINE_USERS.forEach(username => {
    onlineUsers.set(username, {
      socketId: 'permanent-bot-socket',
      username: username,
      lastSeen: now,
      isOnline: true
    });
  });
  // Broadcast updated online list (without lastSeen for bots)
  const onlineUsersArray = Array.from(onlineUsers.keys());
  io.emit('user-status-change', { 
    username: 'SYSTEM', 
    status: 'online', 
    onlineUsers: onlineUsersArray,
    permanent: PERMANENT_ONLINE_USERS // optional extra info
  });
  console.log('🤖 Permanent bot users added to online list:', PERMANENT_ONLINE_USERS);
}
// ===== END PERMANENT BOT USERS =====

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

// ===== GOOGLE AND FACEBOOK AUTH CONFIGURATION =====
// Configuration for OAuth providers
const oauthConfig = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '393147848939-mmhpn1k0djeckfsk40r7ofhqj8fnh1d6.apps.googleusercontent.com',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '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',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || (isRender ? `${renderExternalUrl}/api/auth/google/callback` : `http://localhost:${port}/api/auth/google/callback`),
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo'
  },
  facebook: {
    clientId: process.env.FACEBOOK_APP_ID || '',
    clientSecret: process.env.FACEBOOK_APP_SECRET || '',
    redirectUri: process.env.FACEBOOK_REDIRECT_URI || (isRender ? `${renderExternalUrl}/api/auth/facebook/callback` : `http://localhost:${port}/api/auth/facebook/callback`),
    authUrl: 'https://www.facebook.com/v12.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v12.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/v12.0/me'
  }
};

// JWT Secret for token generation (using crypto for simple token generation)
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false,
  maxAge: 86400
}));
app.use(express.json({ limit: '1mb' })); // Small payload for mobile
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static('public'));

// ===== HELPER: Escape HTML for meta tags =====
function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ===== ROOT ROUTE – SERVE INDEX.HTML WITH DYNAMIC META TAGS FOR SHARED POSTS =====
app.get('/', async (req, res) => {
  try {
    const postId = req.query.post;
    let meta = {
      title: 'MessageMate',
      description: 'Chat smarter with MessageMate – Hassan powered messaging companion.',
      image: 'https://i.ibb.co/p6LrrNRK/1746227326721.jpg',
      url: req.protocol + '://' + req.get('host')
    };

    if (postId) {
      try {
        // Fetch post from Supabase
        const { data: post, error: postError } = await supabase
          .from('posts')
          .select('*')
          .eq('id', postId)
          .single();

        if (!postError && post) {
          // Fetch author's profile to get avatar
          const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('avatar_url')
            .eq('username', post.author_username)
            .single();

          const authorAvatar = (!profileError && profile) ? profile.avatar_url : null;

          // Build meta tags
          meta.title = `Post by ${post.author_username}`;
          meta.description = post.content.substring(0, 200);
          meta.url += `/?post=${postId}`;

          // If post has an image, use it; otherwise fallback to author's avatar or default
          if (post.media_url && post.media_type === 'image') {
            meta.image = post.media_url;
          } else if (authorAvatar) {
            meta.image = authorAvatar;
          }
          // else keep default image
        }
      } catch (err) {
        console.error('Error fetching post for meta tags:', err);
      }
    }

    // Read the HTML file
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    let html = await fs.readFile(htmlPath, 'utf8');

    // Generate the meta tags to inject
    const metaTags = `
      <meta property="og:title" content="${escapeHtml(meta.title)}" />
      <meta property="og:description" content="${escapeHtml(meta.description)}" />
      <meta property="og:image" content="${escapeHtml(meta.image)}" />
      <meta property="og:url" content="${escapeHtml(meta.url)}" />
      <meta property="og:type" content="article" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
      <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
    `;

    // Replace the placeholder block
    html = html.replace(
      /<!-- POST_META_START -->[\s\S]*?<!-- POST_META_END -->/,
      `<!-- POST_META_START -->\n${metaTags}\n<!-- POST_META_END -->`
    );

    res.send(html);
  } catch (err) {
    console.error('Error serving index.html:', err);
    // Fallback: send the original file
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ===== ENHANCED USER AUTHENTICATION SYSTEM WITH OAUTH =====

// Better password hashing function using crypto
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

// Generate simple token (replacing JWT)
function generateToken(user) {
  const tokenData = `${user.id}:${user.username}:${Date.now()}`;
  return Buffer.from(tokenData).toString('base64');
}

// Verify token (replacing JWT)
function verifyTokenSimple(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    const [userId, username, timestamp] = decoded.split(':');
    
    if (!userId || !username || !timestamp) {
      return null;
    }
    
    // Check if token is not too old (30 days)
    const tokenAge = Date.now() - parseInt(timestamp);
    const maxTokenAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    if (isNaN(tokenAge) || tokenAge > maxTokenAge) {
      return null;
    }
    
    return {
      id: userId,
      username: username,
      timestamp: parseInt(timestamp)
    };
  } catch (error) {
    return null;
  }
}

// Generate random username for OAuth users
function generateRandomUsername(provider, providerId) {
  const randomSuffix = Math.floor(Math.random() * 10000);
  const baseName = provider === 'google' ? 'googler' : 'facebooker';
  return `${baseName}_${randomSuffix}`;
}

// Generate display name from OAuth data
function generateDisplayName(provider, userData) {
  if (provider === 'google') {
    return userData.name || userData.given_name || `Google User`;
  } else if (provider === 'facebook') {
    return userData.name || `Facebook User`;
  }
  return `Social User`;
}

// ===== OAUTH AUTHENTICATION ENDPOINTS =====

// Google OAuth login URL
app.get('/api/auth/google', (req, res) => {
  if (!oauthConfig.google.clientId) {
    return res.status(400).json({ 
      success: false, 
      error: "Google OAuth not configured. Please set GOOGLE_CLIENT_ID environment variable." 
    });
  }
  
  const googleAuthUrl = new URL(oauthConfig.google.authUrl);
  googleAuthUrl.searchParams.append('client_id', oauthConfig.google.clientId);
  googleAuthUrl.searchParams.append('redirect_uri', oauthConfig.google.redirectUri);
  googleAuthUrl.searchParams.append('response_type', 'code');
  googleAuthUrl.searchParams.append('scope', 'profile email');
  googleAuthUrl.searchParams.append('access_type', 'offline');
  googleAuthUrl.searchParams.append('prompt', 'consent');
  
  res.json({
    success: true,
    auth_url: googleAuthUrl.toString()
  });
});

// Facebook OAuth login URL
app.get('/api/auth/facebook', (req, res) => {
  if (!oauthConfig.facebook.clientId) {
    return res.status(400).json({ 
      success: false, 
      error: "Facebook OAuth not configured. Please set FACEBOOK_APP_ID environment variable." 
    });
  }
  
  const facebookAuthUrl = new URL(oauthConfig.facebook.authUrl);
  facebookAuthUrl.searchParams.append('client_id', oauthConfig.facebook.clientId);
  facebookAuthUrl.searchParams.append('redirect_uri', oauthConfig.facebook.redirectUri);
  facebookAuthUrl.searchParams.append('response_type', 'code');
  facebookAuthUrl.searchParams.append('scope', 'email,public_profile');
  facebookAuthUrl.searchParams.append('state', crypto.randomBytes(16).toString('hex'));
  
  res.json({
    success: true,
    auth_url: facebookAuthUrl.toString()
  });
});
// ===== HELPER: Generate prompt from image or text =====
async function handlePromptCommand(imageUrl, userPrompt) {
  try {
    const params = {};
    if (imageUrl) {
      params.imageUrl = imageUrl;
    } else if (userPrompt) {
      params.userPrompt = userPrompt;
    } else {
      throw new Error("No image or text provided");
    }

    const response = await axios.get("https://theone-fast-image-gen.vercel.app/prompt", {
      params,
      timeout: 15000,
    });

    const prompt = response.data?.prompt;
    if (!prompt) throw new Error("No prompt returned from API");
    return prompt;
  } catch (error) {
    console.error("Prompt generation error:", error);
    throw new Error(`Prompt API failed: ${error.message}`);
  }
}

// OAuth callback handler
async function handleOAuthCallback(provider, code, res) {
  try {
    let tokenResponse, userInfo;
    
    if (provider === 'google') {
      // Exchange code for access token
      tokenResponse = await axios.post(oauthConfig.google.tokenUrl, {
        client_id: oauthConfig.google.clientId,
        client_secret: oauthConfig.google.clientSecret,
        code: code,
        redirect_uri: oauthConfig.google.redirectUri,
        grant_type: 'authorization_code'
      });
      
      // Get user info from Google
      userInfo = await axios.get(oauthConfig.google.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
      });
    } else if (provider === 'facebook') {
      // Exchange code for access token
      tokenResponse = await axios.get(oauthConfig.facebook.tokenUrl, {
        params: {
          client_id: oauthConfig.facebook.clientId,
          client_secret: oauthConfig.facebook.clientSecret,
          code: code,
          redirect_uri: oauthConfig.facebook.redirectUri
        }
      });
      
      // Get user info from Facebook
      userInfo = await axios.get(oauthConfig.facebook.userInfoUrl, {
        params: {
          fields: 'id,name,email,picture.type(large),first_name,last_name',
          access_token: tokenResponse.data.access_token
        }
      });
    }
    
    const providerUser = userInfo.data;
    const providerId = provider === 'google' ? providerUser.id : providerUser.id;
    
    // Check if user already exists by provider ID
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_provider', provider)
      .eq('provider_id', providerId)
      .limit(1);
    
    let user;
    
    if (findError) {
      console.error(`❌ Error finding ${provider} user:`, findError);
      throw findError;
    }
    
    if (existingUser && existingUser.length > 0) {
      // User exists - update last login
      user = existingUser[0];
      
      await supabase
        .from('users')
        .update({ 
          last_login: new Date().toISOString(),
          avatar_url: provider === 'google' ? providerUser.picture : (providerUser.picture?.data?.url || user.avatar_url)
        })
        .eq('id', user.id);
      
      console.log(`✅ ${provider} user logged in:`, user.username);
    } else {
      // Create new user from OAuth provider
      // Check if email already exists in the system
      if (providerUser.email) {
        const { data: existingEmailUser } = await supabase
          .from('users')
          .select('*')
          .eq('email', providerUser.email)
          .limit(1);
        
        if (existingEmailUser && existingEmailUser.length > 0) {
          return {
            success: false,
            error: `Email ${providerUser.email} is already registered. Please login with your existing account.`
          };
        }
      }
      
      // Generate username
      let username;
      if (providerUser.email) {
        username = providerUser.email.split('@')[0];
        // Clean username
        username = username.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      } else {
        username = generateRandomUsername(provider, providerId);
      }
      
      // Ensure username is unique
      let counter = 1;
      let originalUsername = username;
      
      while (true) {
        const { data: checkUsers } = await supabase
          .from('users')
          .select('username')
          .eq('username', username)
          .limit(1);
        
        if (!checkUsers || checkUsers.length === 0) {
          break;
        }
        username = `${originalUsername}_${counter}`;
        counter++;
      }
      
      // Create user
      const userData = {
        username: username,
        email: providerUser.email || null,
        email_verified: provider === 'google' ? (providerUser.verified_email || false) : true,
        auth_provider: provider,
        provider_id: providerId,
        provider_data: providerUser,
        avatar_url: provider === 'google' ? providerUser.picture : (providerUser.picture?.data?.url || null),
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
        is_active: true,
        banned: false
      };
      
      const { data: newUser, error: createError } = await supabase
        .from('users')
        .insert([userData])
        .select();
      
      if (createError) {
        console.error(`❌ Error creating ${provider} user:`, createError);
        throw createError;
      }
      
      user = newUser[0];
      
      // Create user profile
      try {
        const profileData = {
          user_id: user.id,
          username: user.username,
          display_name: generateDisplayName(provider, providerUser),
          avatar_url: user.avatar_url,
          firstname: provider === 'google' ? providerUser.given_name : providerUser.first_name,
          lastname: provider === 'google' ? providerUser.family_name : providerUser.last_name,
          bio: '',
          status: 'online'
        };
        
        await supabase
          .from('user_profiles')
          .insert([profileData]);
      } catch (profileError) {
        console.error(`❌ Error creating profile for ${provider} user:`, profileError);
        // Continue even if profile creation fails
      }
      
      console.log(`✅ New ${provider} user created:`, user.username);
    }
    
    // Generate token
    const token = generateToken(user);
    
    return {
      success: true,
      user: user,
      token: token
    };
    
  } catch (error) {
    console.error(`❌ ${provider} OAuth error:`, error);
    throw error;
  }
}

// Google OAuth callback
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, error: oauthError } = req.query;
    
    if (oauthError) {
      throw new Error(`Google OAuth error: ${oauthError}`);
    }
    
    if (!code) {
      return res.status(400).json({ success: false, error: "Authorization code required" });
    }
    
    const result = await handleOAuthCallback('google', code, res);
    
    if (!result.success) {
      const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
      const errorRedirectUrl = `${frontendUrl}/auth/callback?error=${encodeURIComponent(result.error)}`;
      return res.redirect(errorRedirectUrl);
    }
    
    // Redirect to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    const redirectUrl = `${frontendUrl}/auth/callback?token=${result.token}&username=${result.user.username}&provider=google`;
    
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('❌ Google OAuth callback error:', error);
    
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    const errorRedirectUrl = `${frontendUrl}/auth/callback?error=${encodeURIComponent('Google authentication failed')}`;
    
    res.redirect(errorRedirectUrl);
  }
});

// Facebook OAuth callback
app.get('/api/auth/facebook/callback', async (req, res) => {
  try {
    const { code, error: oauthError } = req.query;
    
    if (oauthError) {
      throw new Error(`Facebook OAuth error: ${oauthError}`);
    }
    
    if (!code) {
      return res.status(400).json({ success: false, error: "Authorization code required" });
    }
    
    const result = await handleOAuthCallback('facebook', code, res);
    
    if (!result.success) {
      const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
      const errorRedirectUrl = `${frontendUrl}/auth/callback?error=${encodeURIComponent(result.error)}`;
      return res.redirect(errorRedirectUrl);
    }
    
    // Redirect to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    const redirectUrl = `${frontendUrl}/auth/callback?token=${result.token}&username=${result.user.username}&provider=facebook`;
    
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('❌ Facebook OAuth callback error:', error);
    
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    const errorRedirectUrl = `${frontendUrl}/auth/callback?error=${encodeURIComponent('Facebook authentication failed')}`;
    
    res.redirect(errorRedirectUrl);
  }
});

// ===== ENHANCED TOKEN VERIFICATION MIDDLEWARE =====

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
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
    // Try simple token verification first
    const decoded = verifyTokenSimple(token);
    
    if (decoded) {
      console.log('✅ Token verified for user:', decoded.username);
      req.user = decoded;
      return next();
    }
    
    // Fallback to old token verification for backward compatibility
    try {
      const oldDecoded = Buffer.from(token, 'base64').toString('ascii');
      console.log('🔐 Old token format detected:', oldDecoded);
      
      const [username, timestamp] = oldDecoded.split(':');
      
      if (!username) {
        console.log('❌ No username found in old token');
        return res.status(401).json({ 
          success: false, 
          error: "Invalid token format" 
        });
      }
      
      // Check if token is not too old (30 days)
      const tokenAge = Date.now() - parseInt(timestamp);
      const maxTokenAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      
      if (isNaN(tokenAge) || tokenAge > maxTokenAge) {
        console.log('❌ Old token expired or invalid timestamp');
        return res.status(401).json({ 
          success: false, 
          error: "Token expired" 
        });
      }
      
      // Fetch user from database to get full info
      supabase
        .from('users')
        .select('*')
        .ilike('username', username)
        .limit(1)
        .then(({ data: users, error: userError }) => {
          if (userError || !users || users.length === 0) {
            return res.status(401).json({ 
              success: false, 
              error: "User not found" 
            });
          }
          
          req.user = {
            id: users[0].id,
            username: users[0].username,
            email: users[0].email,
            auth_provider: users[0].auth_provider
          };
          
          console.log('✅ Old token verified for user:', username);
          next();
        })
        .catch(error => {
          console.error('❌ Error fetching user for old token:', error);
          return res.status(401).json({ 
            success: false, 
            error: "Invalid token" 
          });
        });
        
    } catch (oldTokenError) {
      console.error('❌ Old token verification error:', oldTokenError);
      return res.status(401).json({ 
        success: false, 
        error: "Invalid token" 
      });
    }
  } catch (error) {
    console.error('❌ Token verification error:', error);
    return res.status(401).json({ 
      success: false, 
      error: "Invalid token" 
    });
  }
}

// ===== UPDATED USER REGISTRATION WITH PASSWORD HASHING =====

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

    // Check if email already exists for local users
    if (email) {
      const { data: existingEmail, error: emailError } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .eq('auth_provider', 'local')
        .limit(1);

      if (emailError) {
        console.error('❌ Database error checking email:', emailError);
      } else if (existingEmail && existingEmail.length > 0) {
        return res.status(409).json({ 
          success: false, 
          error: "Email already registered with a local account" 
        });
      }
    }

    // Use enhanced password hashing
    const hashedPassword = hashPassword(password);

    // Create user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([
        { 
          username: username.trim(),
          password_hash: hashedPassword,
          email: email || null,
          auth_provider: 'local',
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
          is_active: true,
          avatar_url: `https://i.pravatar.cc/150?u=${username}`,
          banned: false
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
    
    // Generate token for persistent login
    const userToken = generateToken(newUser[0]);
    
    // Create user profile
    try {
      await supabase
        .from('user_profiles')
        .insert([
          {
            user_id: newUser[0].id,
            username: username,
            display_name: username,
            avatar_url: `https://i.pravatar.cc/150?u=${username}`,
            status: 'online'
          }
        ]);
    } catch (profileError) {
      console.log('⚠️ Could not create profile:', profileError);
    }
    
    res.status(201).json({ 
      success: true, 
      message: "User registered successfully",
      username: username,
      user_id: newUser[0].id,
      token: userToken,
      auth_provider: 'local'
    });

  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// User login endpoint - POST (updated with token)
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

    // Check if user is banned
    if (user.banned) {
      return res.status(403).json({ 
        success: false, 
        error: "Your account has been banned." 
      });
    }

    // Check if user is using OAuth (no password)
    if (user.auth_provider !== 'local' && !user.password_hash) {
      return res.status(401).json({ 
        success: false, 
        error: `This account uses ${user.auth_provider} authentication. Please sign in with ${user.auth_provider}.` 
      });
    }

    // Verify password with enhanced hash
    const isPasswordValid = hashPassword(password) === user.password_hash;
    
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

    // Generate token
    const userToken = generateToken(user);

    res.json({ 
      success: true, 
      message: "Login successful",
      username: user.username,
      user_id: user.id,
      token: userToken,
      auth_provider: user.auth_provider
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

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

    // Check if email already exists for local users
    if (email) {
      const { data: existingEmail } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .eq('auth_provider', 'local')
        .limit(1);

      if (existingEmail && existingEmail.length > 0) {
        return res.status(409).json({ 
          success: false, 
          error: "Email already registered with a local account" 
        });
      }
    }

    // Use enhanced password hashing
    const hashedPassword = hashPassword(password);

    // Create user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([
        { 
          username: username.trim(),
          password_hash: hashedPassword,
          email: email || null,
          auth_provider: 'local',
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
          is_active: true,
          avatar_url: `https://i.pravatar.cc/150?u=${username}`,
          banned: false
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
    
    // Generate token
    const userToken = generateToken(newUser[0]);
    
    // Create user profile
    try {
      await supabase
        .from('user_profiles')
        .insert([
          {
            user_id: newUser[0].id,
            username: username,
            display_name: username,
            avatar_url: `https://i.pravatar.cc/150?u=${username}`,
            status: 'online'
          }
        ]);
    } catch (profileError) {
      console.log('⚠️ Could not create profile:', profileError);
    }
    
    res.status(201).json({ 
      success: true, 
      message: "User registered successfully",
      username: username,
      user_id: newUser[0].id,
      token: userToken,
      auth_provider: 'local'
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

    // Check if user is banned
    if (user.banned) {
      return res.status(403).json({ 
        success: false, 
        error: "Your account has been banned." 
      });
    }

    // Check if user is using OAuth (no password)
    if (user.auth_provider !== 'local' && !user.password_hash) {
      return res.status(401).json({ 
        success: false, 
        error: `This account uses ${user.auth_provider} authentication. Please sign in with ${user.auth_provider}.` 
      });
    }

    // Verify password with enhanced hash
    const isPasswordValid = hashPassword(password) === user.password_hash;
    
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

    // Generate token
    const userToken = generateToken(user);

    res.json({ 
      success: true, 
      message: "Login successful",
      username: user.username,
      user_id: user.id,
      token: userToken,
      auth_provider: user.auth_provider
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
    const userId = req.user.id;
    const username = req.user.username;

    console.log('🔄 Auto-login attempt for:', username);

    // Find user
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .limit(1);

    if (error || !users || users.length === 0) {
      return res.status(401).json({ 
        success: false, 
        error: "User not found" 
      });
    }

    const user = users[0];

    // Check if user is banned
    if (user.banned) {
      return res.status(403).json({ 
        success: false, 
        error: "Your account has been banned." 
      });
    }

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
      user_id: user.id,
      email: user.email,
      auth_provider: user.auth_provider,
      avatar_url: user.avatar_url
    });

  } catch (error) {
    console.error('❌ Auto-login error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Internal server error" 
    });
  }
});

// ===== ADD OAUTH INFO ENDPOINT =====

// Get OAuth configuration info (safe to expose to frontend)
app.get('/api/auth/oauth-info', (req, res) => {
  res.json({
    success: true,
    google: {
      enabled: !!oauthConfig.google.clientId,
      clientId: oauthConfig.google.clientId,
      redirectUri: oauthConfig.google.redirectUri
    },
    facebook: {
      enabled: !!oauthConfig.facebook.clientId,
      redirectUri: oauthConfig.facebook.redirectUri
    },
    endpoints: {
      google: {
        auth: `/api/auth/google`,
        callback: `/api/auth/google/callback`
      },
      facebook: {
        auth: `/api/auth/facebook`,
        callback: `/api/auth/facebook/callback`
      }
    }
  });
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
      },
      {
        method: "GET",
        path: "/api/auth/google",
        description: "Get Google OAuth URL"
      },
      {
        method: "GET",
        path: "/api/auth/facebook",
        description: "Get Facebook OAuth URL"
      },
      {
        method: "GET",
        path: "/api/auth/oauth-info",
        description: "Get OAuth configuration info"
      }
    ],
    testInstructions: [
      "1. Use POST /api/check-username to check availability",
      "2. Use POST /api/register to create account",
      "3. Use POST /api/login to authenticate",
      "4. Use GET/POST /api/user/profile to manage profile",
      "5. Use GET /api/auth/google or /api/auth/facebook for OAuth"
    ]
  });
});

// ===== FIXED PROFILE MANAGEMENT ENDPOINTS =====

// Get current user's profile - FIXED WITH BETTER ERROR HANDLING
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    console.log('🔐 Profile request received');
    console.log('📋 User from token:', req.user);
    
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
      .select('id, username, email, auth_provider, created_at, last_login, avatar_url, provider_data, banned')
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
        avatar_url: user.avatar_url || `https://i.pravatar.cc/150?u=${username}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        display_name: username,
        status: 'online'
      };
      
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
        avatar_url: user.avatar_url || `https://i.pravatar.cc/150?u=${username}`,
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
        avatar_url: user.avatar_url || `https://i.pravatar.cc/150?u=${username}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        display_name: username,
        status: 'online'
      };
      
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
      auth_provider: user.auth_provider || 'local',
      created_at: user.created_at,
      last_login: user.last_login,
      avatar_url: user.avatar_url,
      provider_data: user.provider_data,
      banned: user.banned || false,
      
      // Profile fields with defaults
      firstname: profileData.firstname || '',
      lastname: profileData.lastname || '',
      bio: profileData.bio || '',
      age: profileData.age || null,
      gender: profileData.gender || '',
      location: profileData.location || '',
      interests: profileData.interests || '',
      avatar: profileData.avatar_url || user.avatar_url || `https://i.pravatar.cc/150?u=${username}`,
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

// ===== ADD MISSING VALIDATE HUMAN NAME FUNCTION =====
function validateHumanName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.length < 2 || name.length > 50) return false;
    // Allow letters, spaces, dots, hyphens, apostrophes
    if (!/^[a-zA-Z\s\.\-\']+$/.test(name)) return false;
    // Must contain at least one vowel
    if (!/[aeiouAEIOU]/.test(name)) return false;
    // Check for repeating characters (no more than 3 same in a row)
    if (/(.)\1{3,}/.test(name)) return false;
    return true;
}

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

    // MODIFICATION START: Validate display_name if provided
    if (profileData.display_name && !validateHumanName(profileData.display_name)) {
      return res.status(400).json({
        success: false,
        error: "Display name must be a valid human name (2-50 characters, letters, spaces, dots, hyphens, apostrophes, must contain a vowel, no repeating characters, no bad words)"
      });
    }
    // MODIFICATION END

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
      avatar_url: profileData.avatar || profileData.avatar_url || `https://i.pravatar.cc/150?u=${username}`,
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

// Get user profile by username (for profile popups) - FIXED with bot override
app.get('/api/user/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
    console.log('📋 Loading profile for user:', username);

    // ===== OVERRIDE FOR PERMANENT BOTS =====
    if (PERMANENT_ONLINE_USERS.includes(username)) {
      return res.json({
        success: true,
        profile: {
          username: username,
          firstname: '',
          lastname: '',
          bio: '',
          age: null,
          gender: '',
          location: '',
          interests: '',
          avatar: `https://i.pravatar.cc/150?u=${username}`,
          display_name: username,
          status: 'online',
          last_active: null,
          last_seen: null
        }
      });
    }

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

// GET messages endpoint - UPDATED TO INCLUDE USER STATUS (with bot override)
app.get('/api/messages', async (req, res) => {
  try {
    const { data: messages, error: messagesError } = await supabase
      .from('chatter')
      .select('id, content, username, created_at, image_url, reply_to')
      .order('created_at', { ascending: false });

    if (messagesError) throw messagesError;

    // Get unique usernames from messages
    const usernames = [...new Set(messages.map(msg => msg.username))];
    
    // Fetch user profiles for these usernames
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('username, status, last_active')
      .in('username', usernames);

    // Create a map of username to profile data
    const profileMap = {};
    if (profiles && !profilesError) {
      profiles.forEach(profile => {
        profileMap[profile.username] = {
          status: profile.status || 'offline',
          last_seen: profile.last_active
        };
      });
    }

    // Combine messages with user status
    const messagesWithStatus = messages.map(msg => {
      // ===== OVERRIDE FOR PERMANENT BOTS =====
      if (PERMANENT_ONLINE_USERS.includes(msg.username)) {
        return {
          ...msg,
          user_status: 'online',
          last_seen: null
        };
      }
      return {
        ...msg,
        user_status: profileMap[msg.username]?.status || 'offline',
        last_seen: profileMap[msg.username]?.last_seen || null
      };
    });

    res.json(messagesWithStatus || []);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST messages endpoint - FIXED: Return message with ID immediately
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

    // === CHECK IF USER IS BANNED ===
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('banned')
      .ilike('username', username)
      .limit(1)
      .single();

    if (!userError && user && user.banned) {
      // Broadcast a system message that this user is banned
      const banMessage = `🚫 User @${username} has been banned and cannot send messages.`;
      const systemMsg = {
        content: banMessage,
        username: 'System',
        image_url: null,
        reply_to: null,
        created_at: new Date().toISOString()
      };
      
      // Save the system message to the database
      const { data: savedSystemMsg, error: saveError } = await supabase
        .from('chatter')
        .insert([systemMsg])
        .select();
      
      if (!saveError && savedSystemMsg && savedSystemMsg[0]) {
        // Emit to all clients via Socket.io
        io.emit('new-message', savedSystemMsg[0]);
      } else {
        // If saving fails, at least broadcast a simple event (optional)
        io.emit('system-message', banMessage);
      }
      
      return res.status(403).json({ error: "You are banned and cannot send messages." });
    }

    // FIXED: Proper data preparation for regular messages
    const insertData = {
      content: (content && content.trim() !== '') ? content.trim() : '',
      username: username.trim(),
      image_url: image_url || '',
      reply_to: reply_to || '',
      created_at: new Date().toISOString()  // ADD THIS LINE
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
          username: username.trim(),
          created_at: new Date().toISOString()  // ADD THIS LINE TOO
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

// DELETE messages endpoint that client expects - MODIFIED: Added auth and Admin0 permission
app.delete('/api/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;

    console.log('🗑️ Deleting message with ID:', id, 'by user:', username);

    // Fetch the message to check ownership
    const { data: message, error: fetchError } = await supabase
      .from('chatter')
      .select('username')
      .eq('id', id)
      .single();

    if (fetchError || !message) {
      console.error('❌ Message not found or fetch error:', fetchError);
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    // Allow if user is Admin0 or the message owner
    if (username !== 'Admin0' && message.username !== username) {
      return res.status(403).json({ success: false, error: 'You can only delete your own messages' });
    }

    const { error } = await supabase
      .from('chatter')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('❌ Database error deleting message:', error);
      throw error;
    }
    
    // Broadcast deletion via Socket.io
    console.log('📢 Broadcasting message deletion to all clients');
    io.emit('message-deleted', id);
    
    res.status(200).json({ 
      success: true,
      message: "Message deleted successfully"
    });
  } catch (error) {
    console.error('❌ Failed to delete message:', error);
    res.status(500).json({ 
      success: false,
      error: "Failed to delete message: " + error.message 
    });
  }
});

// ===== GET ALL SIGNED-UP USERS =====

// Get all users with their profiles (for user directory) with bot override
app.get('/api/users/all', async (req, res) => {
    try {
        console.log('👥 Fetching all users for directory...');
        
        // Get all users from users table
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('id, username, email, auth_provider, created_at, last_login, avatar_url, provider_data, banned')
            .order('created_at', { ascending: false });
        
        if (usersError) {
            console.error('❌ Error fetching users:', usersError);
            return res.status(500).json({ 
                success: false, 
                error: "Failed to fetch users" 
            });
        }
        
        if (!users || users.length === 0) {
            return res.json({
                success: true,
                users: [],
                message: "No users found"
            });
        }
        
        // Get profiles for all users
        const usernames = users.map(u => u.username);
        const { data: profiles, error: profilesError } = await supabase
            .from('user_profiles')
            .select('*')
            .in('username', usernames);
        
        if (profilesError && profilesError.code !== '42P01') {
            console.error('❌ Error fetching profiles:', profilesError);
            // Continue with users even if profiles fail
        }
        
        // Create a map of profiles by username for quick lookup
        const profileMap = {};
        if (profiles && profiles.length > 0) {
            profiles.forEach(profile => {
                profileMap[profile.username] = profile;
            });
        }
        
        // Combine user data with profile data
        const allUsersData = users.map(user => {
            const profile = profileMap[user.username] || {};
            
            // ===== OVERRIDE FOR PERMANENT BOTS =====
            const isBot = PERMANENT_ONLINE_USERS.includes(user.username);
            
            return {
                // User table fields
                username: user.username,
                email: user.email || '',
                user_id: user.id,
                auth_provider: user.auth_provider || 'local',
                created_at: user.created_at,
                last_login: user.last_login,
                avatar_url: user.avatar_url,
                provider_data: user.provider_data,
                banned: user.banned || false,
                
                // Profile fields with defaults
                firstname: profile.firstname || '',
                lastname: profile.lastname || '',
                bio: profile.bio || '',
                age: profile.age || null,
                gender: profile.gender || '',
                location: profile.location || '',
                interests: profile.interests || '',
                avatar: profile.avatar_url || user.avatar_url || `https://i.pravatar.cc/150?u=${user.username}`,
                display_name: profile.display_name || user.username,
                // ===== BOT OVERRIDE =====
                status: isBot ? 'online' : (profile.status || 'offline'),
                last_seen: isBot ? null : (profile.last_active || user.last_login),
                
                // Activity counts (to be populated)
                message_count: 0, // Placeholder
                post_count: 0, // Placeholder
                
                // Additional info
                join_date: user.created_at,
                is_new_user: isNewUser(user.created_at)
            };
        });
        
        console.log(`✅ Found ${allUsersData.length} users for directory`);
        
        // Now get message counts for each user
        try {
            const { data: messageCounts, error: msgError } = await supabase
                .from('chatter')
                .select('username')
                .in('username', usernames);
            
            if (!msgError && messageCounts) {
                // Count messages per user
                const msgCountMap = {};
                messageCounts.forEach(msg => {
                    msgCountMap[msg.username] = (msgCountMap[msg.username] || 0) + 1;
                });
                
                // Update user data with message counts
                allUsersData.forEach(user => {
                    user.message_count = msgCountMap[user.username] || 0;
                });
            }
        } catch (msgCountError) {
            console.log('⚠️ Could not fetch message counts:', msgCountError.message);
        }
        
        // Get post counts for each user
        try {
            const { data: postCounts, error: postError } = await supabase
                .from('posts')
                .select('author_username')
                .in('author_username', usernames);
            
            if (!postError && postCounts) {
                // Count posts per user
                const postCountMap = {};
                postCounts.forEach(post => {
                    postCountMap[post.author_username] = (postCountMap[post.author_username] || 0) + 1;
                });
                
                // Update user data with post counts
                allUsersData.forEach(user => {
                    user.post_count = postCountMap[user.username] || 0;
                });
            }
        } catch (postCountError) {
            console.log('⚠️ Could not fetch post counts:', postCountError.message);
        }
        
        // Count new users (joined in last 7 days)
        const newUsersCount = allUsersData.filter(u => u.is_new_user).length;
        
        // Count by auth provider
        const providerCounts = {};
        allUsersData.forEach(user => {
            const provider = user.auth_provider || 'local';
            providerCounts[provider] = (providerCounts[provider] || 0) + 1;
        });
        
        res.json({
            success: true,
            users: allUsersData,
            total_count: allUsersData.length,
            new_users: newUsersCount,
            provider_counts: providerCounts
        });
        
    } catch (error) {
        console.error('❌ Error in /api/users/all:', error);
        res.status(500).json({ 
            success: false, 
            error: "Failed to fetch users: " + error.message 
        });
    }
});

// Helper function to check if user is new (joined in last 7 days)
function isNewUser(createdAt) {
    if (!createdAt) return false;
    
    const joinDate = new Date(createdAt);
    const now = new Date();
    const diffTime = now - joinDate;
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    
    return diffDays <= 7;
}

// Also add this endpoint for quick stats
app.get('/api/users/stats', async (req, res) => {
    try {
        console.log('📊 Getting user statistics...');
        
        // Get total user count
        const { count: totalUsers, error: countError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            console.error('❌ Error counting users:', countError);
            return res.status(500).json({ error: "Failed to get user stats" });
        }
        
        // Get today's new users
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const { count: newUsersToday, error: newError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', today.toISOString());

        if (newError) {
            console.error('❌ Error counting new users:', newError);
            return res.status(500).json({ error: "Failed to get new user stats" });
        }
        
        // Get active users (logged in last 24 hours)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        const { count: activeUsers, error: activeError } = await supabase
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('last_login', yesterday.toISOString());

        if (activeError) {
            console.error('❌ Error counting active users:', activeError);
            return res.status(500).json({ error: "Failed to get active user stats" });
        }
        
        // Get auth provider statistics
        const { data: providerStats, error: providerError } = await supabase
            .from('users')
            .select('auth_provider');
        
        let providerCounts = {};
        if (!providerError && providerStats) {
            providerStats.forEach(user => {
                const provider = user.auth_provider || 'local';
                providerCounts[provider] = (providerCounts[provider] || 0) + 1;
            });
        }
        
        res.json({
            success: true,
            stats: {
                total_users: totalUsers || 0,
                new_users_today: newUsersToday || 0,
                active_users_last_24h: activeUsers || 0,
                auth_providers: providerCounts,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ Error in /api/users/stats:', error);
        res.status(500).json({ 
            success: false, 
            error: "Failed to get user stats: " + error.message 
        });
    }
});

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

// ===== FIXED PRIVATE MESSAGES ENDPOINTS - DUPLICATE PREVENTION ADDED =====

// Send private message - FIXED TO PREVENT DUPLICATES
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

    // === CHECK IF SENDER IS BANNED ===
    const { data: sender, error: senderError } = await supabase
      .from('users')
      .select('banned')
      .ilike('username', sender_username)
      .limit(1)
      .single();

    if (!senderError && sender && sender.banned) {
      return res.status(403).json({ 
        success: false,
        error: "You are banned and cannot send messages." 
      });
    }

    // ✅ FIXED: Generate unique ID to track message
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const insertData = {
      sender_username: sender_username.trim(),
      receiver_username: receiver_username.trim(),
      content: content ? content.trim() : '',
      image_url: image_url || null,
      read: false,
      created_at: new Date().toISOString(),
      message_id: messageId // Add custom message ID for tracking
    };

    console.log('📝 Inserting private message with ID:', messageId);

    const { data, error } = await supabase
      .from('private_messages')
      .insert([insertData])
      .select();

    if (error) {
      console.error('❌ Private message insert failed:', error);
      return res.status(500).json({ 
        success: false,
        error: "Database error: " + error.message
      });
    }

    console.log('✅ Private message saved successfully. ID:', data[0]?.id);
    
    // ✅ FIXED: Add message ID to response for tracking
    const responseData = {
      ...data[0],
      custom_message_id: messageId
    };
    
    // ✅ FIXED: Broadcast via Socket.io to ONLY the receiver
    // Don't broadcast to sender - sender already has the message from HTTP response
    io.to(receiver_username).emit('new-private-message', responseData);
    io.to(sender_username).emit('private-message-sent', responseData); // Separate event for sender
    
    res.status(201).json({
      success: true,
      data: responseData,
      custom_message_id: messageId
    });

  } catch (error) {
    console.error('❌ Failed to save private message:', error);
    res.status(500).json({ 
      success: false,
      error: "Failed to send private message: " + error.message 
    });
  }
});

// Get conversations for the current user - FIXED
app.get('/api/private/conversations', async (req, res) => {
  try {
    const { username } = req.query;
    
    if (!username) {
      return res.status(400).json({ error: "Username query parameter is required" });
    }

    console.log('📨 Fetching conversations for:', username);

    // Get all messages involving this user
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
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

    // Get all messages involving these users
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .or(`sender_username.eq.${otherUser},receiver_username.eq.${otherUser}`)
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
      .eq('read', false);

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

// Mark messages as read - FIXED (corrected the string syntax error here)
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
      .eq('read', false);

    if (error) {
      console.error('❌ Database error marking messages as read:', error);
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }

    res.json({ success: true });

  } catch (error) {
    console.error('❌ Error marking messages as read:', error);
    res.status(500).json({ error: "Failed to mark messages as read: " + error.message });
  }
});

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

// ===== MODIFIED: Get all posts with comments and like status, filtering by visibility =====
app.get('/api/posts', async (req, res) => {
  try {
    const { username } = req.query; // Current user for like status and visibility filtering

    console.log('📝 Fetching posts from Supabase...');

    // Get posts with author info
    let query = supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });

    // If a username is provided, we'll filter in code (because SQL filtering with OR is tricky)
    // If no username (unauthenticated), only public posts
    if (!username) {
      query = query.eq('visibility', 'public');
    }

    const { data: posts, error: postsError } = await query;

    if (postsError) {
      console.error('❌ Error fetching posts:', postsError);
      return res.status(500).json({ error: 'Failed to fetch posts' });
    }

    // Filter posts: if username is provided, show public posts + private posts authored by that user
    let filteredPosts = posts;
    if (username) {
      filteredPosts = posts.filter(post => 
        post.visibility === 'public' || post.author_username === username
      );
    }

    // For each post, get comments and check if current user liked it
    const postsWithDetails = await Promise.all(
      (filteredPosts || []).map(async (post) => {
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

    // === CHECK IF AUTHOR IS BANNED ===
    const { data: author, error: authorError } = await supabase
      .from('users')
      .select('banned')
      .ilike('username', author_username)
      .limit(1)
      .single();

    if (!authorError && author && author.banned) {
      return res.status(403).json({ error: "You are banned and cannot create posts." });
    }

    const postData = {
      author_username: author_username.trim(),
      content: content.trim(),
      media_url: media_url || null,
      media_type: media_type || null,
      likes_count: 0,
      comments_count: 0,
      visibility: 'public' // default public
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

// ===== MODIFIED: Delete a post (only by author or Admin0) =====
app.delete('/api/posts/:postId', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { username } = req.body; // Current user trying to delete
    const requesterUsername = req.user.username; // from token

    console.log('🗑️ Deleting post:', { postId, username, requesterUsername });

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    // First, verify the post exists and get its author
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('author_username')
      .eq('id', postId)
      .single();

    if (postError || !post) {
      return res.status(404).json({ error: "Post not found" });
    }

    // Allow deletion if:
    // 1. The user is the author, OR
    // 2. The user is Admin0
    const isAdmin = requesterUsername === 'Admin0';
    if (post.author_username !== username && !isAdmin) {
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

    // Broadcast deletion to all clients
    io.emit('post-deleted', postId);

    res.json({ success: true, message: "Post deleted successfully" });

  } catch (error) {
    console.error('❌ Error deleting post:', error);
    res.status(500).json({ error: "Failed to delete post: " + error.message });
  }
});

// ===== NEW: Change post visibility (only author) =====
app.patch('/api/posts/:postId/visibility', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { visibility } = req.body;
    const username = req.user.username;

    if (!['public', 'private'].includes(visibility)) {
      return res.status(400).json({ error: "Visibility must be 'public' or 'private'" });
    }

    // Verify post exists and user is the author
    const { data: post, error: fetchError } = await supabase
      .from('posts')
      .select('author_username')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (post.author_username !== username) {
      return res.status(403).json({ error: "Only the author can change visibility" });
    }

    // Update visibility
    const { data: updatedPost, error: updateError } = await supabase
      .from('posts')
      .update({ visibility, updated_at: new Date().toISOString() })
      .eq('id', postId)
      .select();

    if (updateError) {
      console.error('❌ Error updating post visibility:', updateError);
      return res.status(500).json({ error: "Failed to update visibility" });
    }

    // Broadcast the change
    io.emit('post-visibility-changed', updatedPost[0]);

    res.json({ success: true, visibility: updatedPost[0].visibility });
  } catch (error) {
    console.error('❌ Visibility change error:', error);
    res.status(500).json({ error: "Internal server error" });
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

// ===== ADD DEBUG ENDPOINT FOR TABLE STRUCTURE =====

// Debug endpoint to check table structure
app.get('/api/debug/private-messages-structure', async (req, res) => {
  try {
    // Get table structure by inserting and reading a test message
    const testData = {
      sender_username: 'test_sender',
      receiver_username: 'test_receiver', 
      content: 'Test message to check structure',
      read: false,
      created_at: new Date().toISOString()
    };

    const { data: insertData, error: insertError } = await supabase
      .from('private_messages')
      .insert([testData])
      .select();

    if (insertError) {
      return res.json({
        success: false,
        error: insertError.message,
        details: "Table structure issue detected",
        solution: "Run the SQL script to recreate the table with correct structure"
      });
    }

    // Get the inserted data to see actual structure
    const { data: readData, error: readError } = await supabase
      .from('private_messages')
      .select('*')
      .eq('id', insertData[0].id)
      .single();

    // Clean up test data
    await supabase
      .from('private_messages')
      .delete()
      .eq('id', insertData[0].id);

    res.json({
      success: true,
      tableStructure: readData,
      message: "Table structure is correct",
      fields: Object.keys(readData)
    });

  } catch (error) {
    console.error('❌ Debug error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
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
      created_at: new Date().toISOString()
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

    // Get messages where user is sender or receiver
    const { data: messages, error } = await supabase
      .from('chatter')
      .select('*')
      .eq('message_type', 'private')
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
      created_at: new Date().toISOString()
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
      created_at: new Date().toISOString()
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

    // Count total messages
    const { count: totalCount, error: countError } = await supabase
      .from('private_messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_username', 'test_user1')
      .eq('read', false);

    if (countError) {
      console.error('❌ Count error:', countError);
      return res.status(500).json({ 
        success: false,
        error: 'Count error: ' + countError.message 
      });
    }

    // Get all messages (limit 10 for preview)
    const { data: allMessages, error: messagesError } = await supabase
      .from('private_messages')
      .select('*')
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
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Mark messages as read when fetched
    await supabase
      .from('private_messages')
      .update({ read: true })
      .eq('receiver_username', user1)
      .eq('sender_username', user2)
      .eq('read', false);

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
      created_at: new Date().toISOString()
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
      .eq('read', false);

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
      .eq('read', false);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

// ===== PUBLIC CHAT ENDPOINTS =====

// GET messages (legacy endpoint)
app.get('/messages', async (req, res) => {
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

    // === CHECK IF USER IS BANNED ===
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('banned')
      .ilike('username', username)
      .limit(1)
      .single();

    if (!userError && user && user.banned) {
      // Broadcast a system message that this user is banned
      const banMessage = `🚫 User @${username} has been banned and cannot send messages.`;
      const systemMsg = {
        content: banMessage,
        username: 'System',
        image_url: null,
        reply_to: null,
        created_at: new Date().toISOString()
      };
      
      // Save the system message to the database
      const { data: savedSystemMsg, error: saveError } = await supabase
        .from('chatter')
        .insert([systemMsg])
        .select();
      
      if (!saveError && savedSystemMsg && savedSystemMsg[0]) {
        // Emit to all clients via Socket.io
        io.emit('new-message', savedSystemMsg[0]);
      } else {
        // If saving fails, at least broadcast a simple event (optional)
        io.emit('system-message', banMessage);
      }
      
      return res.status(403).json({ error: "You are banned and cannot send messages." });
    }

    // FIXED: Proper data preparation for regular messages
    const insertData = {
      content: (content && content.trim() !== '') ? content.trim() : '',
      username: username.trim(),
      image_url: image_url || '',
      reply_to: reply_to || '',
      created_at: new Date().toISOString()
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
          username: username.trim(),
          created_at: new Date().toISOString()
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

// ===== FIXED IMAGE UPLOAD ENDPOINT – uses correct bucket name 'chat_images' =====
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const fileBuffer = req.file.buffer;
    const fileName = `${Date.now()}-${req.file.originalname}`;
    const filePath = `images/${fileName}`;

    // Upload to Supabase Storage – bucket name fixed to match your actual bucket 'chat_images'
    const { data, error } = await supabase.storage
      .from('chat_images')               // ✅ changed from 'chat-images'
      .upload(filePath, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) {
      console.error('❌ Supabase storage error:', error);
      return res.status(500).json({ 
        error: 'Storage upload failed', 
        details: error.message 
      });
    }

    // Get public URL – use same bucket name
    const { data: urlData } = supabase.storage
      .from('chat_images')               // ✅ changed from 'chat-images'
      .getPublicUrl(filePath);

    res.json({ 
      imageUrl: urlData.publicUrl,
      message: 'Image uploaded successfully'
    });
  } catch (error) {
    console.error('❌ Upload endpoint error:', error);
    res.status(500).json({ 
      error: 'Upload failed', 
      details: error.message 
    });
  }
});

// DELETE messages (legacy endpoint) - MODIFIED: Added auth and Admin0 permission
app.delete('/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;

    console.log('🗑️ Deleting message (legacy) with ID:', id, 'by user:', username);

    // Fetch the message to check ownership
    const { data: message, error: fetchError } = await supabase
      .from('chatter')
      .select('username')
      .eq('id', id)
      .single();

    if (fetchError || !message) {
      console.error('❌ Message not found or fetch error:', fetchError);
      return res.status(404).json({ success: false, error: 'Message not found' });
    }

    // Allow if user is Admin0 or the message owner
    if (username !== 'Admin0' && message.username !== username) {
      return res.status(403).json({ success: false, error: 'You can only delete your own messages' });
    }

    const { error } = await supabase
      .from('chatter')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('❌ Database error deleting message:', error);
      throw error;
    }
    
    // Broadcast deletion via Socket.io - Use polling for Opera Mini compatibility
    console.log('📢 Broadcasting message deletion to all clients (legacy)');
    io.emit('message-deleted', id);
    
    res.status(200).json({ 
      success: true,
      message: "Message deleted successfully"
    });
  } catch (error) {
    console.error('❌ Failed to delete message:', error);
    res.status(500).json({ 
      success: false,
      error: "Failed to delete message: " + error.message 
    });
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
      created_at: new Date().toISOString()
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
          username: commandType === 'AI' ? 'AI' : 'Bot',
          created_at: new Date().toISOString()
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
      created_at: new Date().toISOString()
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

    // Check what got saved to database
    const { data: savedMessages } = await supabase
      .from('chatter')
      .select('*')
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
      created_at: new Date().toISOString()
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

// ===== HELPER: Extract image URL from any message content =====
function extractImageUrlFromMessage(message) {
  if (!message) return null;
  
  // Check direct image_url field
  if (message.image_url && typeof message.image_url === 'string' && message.image_url.trim() !== '') {
    return message.image_url;
  }
  
  // Check attachments (if any)
  if (message.attachments) {
    try {
      const atts = typeof message.attachments === 'string' ? JSON.parse(message.attachments) : message.attachments;
      if (Array.isArray(atts)) {
        const img = atts.find(a => a.type === 'photo' || a.type === 'image' || (a.url && /\.(jpg|jpeg|png|gif|webp)/i.test(a.url)));
        if (img && img.url) return img.url;
      }
    } catch (e) {}
  }
  
  // Look for URL in content (any http/https URL)
  if (message.content) {
    const urlMatch = message.content.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) return urlMatch[0];
  }
  
  return null;
}

// ===== MODIFIED: COMMAND API HANDLER WITH IMPROVED REPLY IMAGE EXTRACTION =====
 app.post("/api/command", async (req, res) => {
  try {
    let { message, source = 'main-chat', reply_to, reply_image_url } = req.body;
    console.log('📨 Received command:', { message, source, reply_to, reply_image_url });

    if (!message) {
      return res.status(400).json({ reply: "❌ Message is required" });
    }

    // ===== SPECIAL HANDLING FOR -prompt IN PRIVATE AI =====
    if (source === 'private-ai' && message.trim().startsWith('-prompt')) {
      let imageUrl = null;
      const parts = message.trim().split(/\s+/);
      if (parts.length > 1) {
        imageUrl = parts[1];
      }
      if (!imageUrl && reply_image_url) {
        imageUrl = reply_image_url;
      }
      if (!imageUrl) {
        return res.json({ reply: "❌ Please provide an image URL after -prompt or attach an image." });
      }

      try {
        const prompt = await handlePromptCommand(imageUrl, null);
        return res.json({ reply: prompt });
      } catch (error) {
        return res.json({ reply: `❌ Error generating prompt: ${error.message}` });
      }
    }

    // ===== AUTO-PREFIX FOR PRIVATE AI =====
    if (source === 'private-ai' && !message.startsWith(PREFIX)) {
      const trimmed = message.trim().toLowerCase();
      const firstWord = trimmed.split(' ')[0];
      const commandWords = ['ai', 'help', 'ping', 'prefix', 'ask', 'chat'];
      if (commandWords.includes(firstWord)) {
        message = PREFIX + message;
      } else {
        message = PREFIX + 'ai ' + message;
      }
    }

    // PREFIX COMMAND
    if (message.trim().toLowerCase() === "prefix") {
      return res.json({ reply: `🔹 My prefix is: ${PREFIX}` });
    }

    const cmd = handleCommand(message);
    if (!cmd) return res.end();

    let finalReply = null;
    let responder = null;

    // =========================
    // 🤖 AI COMMAND
    // =========================
    if (cmd.commandName === "ai") {
      responder = 'AI';
      try {
        const response = await axios.get(
          `https://yau-cener-gpt4-api.vercel.app/ai?prompt=${encodeURIComponent(cmd.text)}&cb=${Date.now()}`,
          { timeout: 15000 }
        );
        const data = response.data;
        finalReply = data.response || data.message || data.data || (typeof data === "string" ? data : "⚠️ Unknown AI response");
      } catch (err) {
        finalReply = `❌ AI Error: ${err.message}`;
      }
    }
    // =========================
    // 🤖 BOT COMMANDS
    // =========================
    else {
      responder = 'Bot';
      const command = commands[cmd.commandName];
      if (!command) {
        finalReply = "❌ Command not found";
      } else {
        const replies = [];
        const event = { body: cmd.text };

        // =========================
        // 🔥 IMPROVED: HANDLE REPLY IMAGE
        // =========================
        let imageUrl = null;

        // 1. If frontend provided direct image URL, use it
        if (reply_image_url) {
          console.log("📸 Using direct reply image URL from frontend:", reply_image_url);
          imageUrl = reply_image_url;
        }
        // 2. Otherwise, try to fetch the replied message from the database
        else if (reply_to) {
          console.log("🔍 Fetching replied message ID:", reply_to);
          try {
            const { data, error } = await supabase
              .from("chatter")
              .select("*")
              .eq("id", reply_to)
              .single();

            if (error) {
              console.error("❌ DB error fetching replied message:", error);
            }

            if (data) {
              console.log("✅ Found replied message:", data);
              imageUrl = extractImageUrlFromMessage(data);
              if (imageUrl) {
                console.log("📸 Extracted image from replied message:", imageUrl);
              } else {
                console.log("⚠️ No image found in replied message.");
              }
            } else {
              console.log("⚠️ No replied message found with ID:", reply_to);
            }
          } catch (err) {
            console.error("❌ Fetch error:", err);
          }
        }

        // If we found an image URL, attach it to the event for the command
        if (imageUrl) {
          console.log("📸 Attaching image to event:", imageUrl);
          event.messageReply = {
            messageID: reply_to || null,
            body: '',
            attachments: [{ type: "photo", url: imageUrl }],
            image_url: imageUrl
          };
        } else if (reply_to) {
          console.log("⚠️ No image found for replied message.");
        }

        // =========================
        // RUN COMMAND
        // =========================
        await command.onStart({
          api: {
            sendMessage: (msg) => replies.push(typeof msg === "string" ? msg : JSON.stringify(msg)),
            supabase,
            io
          },
          event,
          args: cmd.args,
          message: {
            reply: (content) => replies.push(content)
          }
        });

        finalReply = replies.join("\n") || "❌ No response";
      }
    }

    // =========================
    // 💾 SAVE RESPONSE
    // =========================
    if (finalReply && source === 'main-chat') {
      try {
        await saveBotResponseToSupabase(finalReply, cmd.commandName, responder);
      } catch (e) {
        console.log("❌ Save error");
      }
    }

    return res.json({ reply: finalReply });

  } catch (error) {
    console.error("❌ Server Error:", error);
    return res.status(500).json({ reply: "❌ Server error: " + error.message });
  }
});

// Add endpoint to get online users
app.get('/online-users', (req, res) => {
  const onlineUsersArray = Array.from(onlineUsers.keys());
  console.log('Current online users:', onlineUsersArray);
  res.json(onlineUsersArray);
});

// ===== NEW: BLOCK USER ENDPOINT (Admin only) =====
app.post('/api/admin/block/:username', verifyToken, async (req, res) => {
  try {
    const adminUsername = req.user.username;
    const targetUsername = req.params.username;

    // Only Admin0 can block
    if (adminUsername !== 'Admin0') {
      return res.status(403).json({ success: false, error: 'Only Admin0 can block users.' });
    }

    // Check if target exists
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id')
      .ilike('username', targetUsername)
      .limit(1)
      .single();

    if (findError || !user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Block the user (set banned = true)
    const { error: updateError } = await supabase
      .from('users')
      .update({ banned: true })
      .eq('id', user.id);

    if (updateError) {
      console.error('❌ Error blocking user:', updateError);
      return res.status(500).json({ success: false, error: 'Database error.' });
    }

    // Optionally kick the user from online list
    onlineUsers.delete(targetUsername);
    io.emit('user-status-change', { username: targetUsername, status: 'offline', lastSeen: new Date().toISOString() });

    console.log(`🚫 User ${targetUsername} blocked by Admin0.`);
    res.json({ success: true, message: `User @${targetUsername} has been blocked.` });
  } catch (error) {
    console.error('❌ Block endpoint error:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

// ===== NEW: Clear all messages (Admin only) =====
app.post('/api/admin/clear-all-messages', verifyToken, async (req, res) => {
  try {
    const adminUsername = req.user.username;

    // Only Admin0 can perform this action
    if (adminUsername !== 'Admin0') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only Admin0 can clear all messages.' 
      });
    }

    console.log('🧹 Admin0 is clearing all public messages...');

    // Delete all messages from the chatter table
    const { error } = await supabase
      .from('chatter')
      .delete()
      .neq('id', 0); // deletes everything

    if (error) {
      console.error('❌ Error deleting all messages:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Database error: ' + error.message 
      });
    }

    console.log('✅ All public messages have been deleted.');

    // Broadcast to all clients that they should clear their chat containers
    io.emit('clear-all-messages', { 
      message: 'All public messages have been cleared by Admin0.' 
    });

    res.json({ 
      success: true, 
      message: 'All public messages cleared successfully.' 
    });

  } catch (error) {
    console.error('❌ Clear all messages error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error: ' + error.message 
    });
  }
});

// ===== ENHANCED SOCKET.IO REAL-TIME MESSAGING - OPERA FIXED =====

// Socket.io connection handling - 5 MINUTE ONLINE STATUS for mobile
io.on('connection', (socket) => {
  console.log('🔌 User connected via polling:', socket.id);

  // User joins their own room for private messages
  socket.on('join-user-room', (username) => {
    if (username) {
      socket.join(username);
      console.log(`👤 User ${username} joined their private room`);
    }
  });

  // User leaves their room
  socket.on('leave-user-room', (username) => {
    if (username) {
      socket.leave(username);
      console.log(`👋 User ${username} left their private room`);
    }
  });

  // Send existing messages to newly connected client
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
      
      // Check if user was already tracked (returning after being away)
      const existingUser = onlineUsers.get(username);
      const lastSeenTime = existingUser ? existingUser.lastSeen : Date.now();
      
      // Update or add user to online users
      onlineUsers.set(username, {
        socketId: socket.id,
        username: username,
        lastSeen: lastSeenTime, // Preserve last seen time if returning
        isOnline: true
      });
      
      // Update database status to online
      updateUserStatusOnline(username);
      
      // Get current online users list
      const onlineUsersArray = Array.from(onlineUsers.keys());
      console.log('📊 Updated online users:', onlineUsersArray);
      
      // Broadcast to all users that this user is online
      io.emit('user-status-change', { 
        username, 
        status: 'online',
        lastSeen: null, // No last seen when online
        onlineUsers: onlineUsersArray
      });
    }
  });

  socket.on('user-away', (username) => {
    if (username && onlineUsers.has(username) && !PERMANENT_ONLINE_USERS.includes(username)) {
      console.log('⏸️ User away:', username);
      
      // Update last seen but keep user in list
      const userData = onlineUsers.get(username);
      userData.lastSeen = Date.now();
      userData.isOnline = false;
      
      // Broadcast away status
      io.emit('user-status-change', { 
        username, 
        status: 'away',
        lastSeen: new Date(userData.lastSeen).toISOString(),
        onlineUsers: Array.from(onlineUsers.keys())
      });
    }
  });

  socket.on('user-offline', (username) => {
    if (username && !PERMANENT_ONLINE_USERS.includes(username)) {
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
          created_at: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('❌ Private AI message error:', error);
      socket.emit('new-private-message', {
        content: "Error: Could not process your private message",
        username: 'Private AI',
        sender_username: 'Private AI', 
        receiver_username: data.username,
        created_at: new Date().toISOString()
      });
    }
  });

  // ===== FIXED PRIVATE MESSAGING SOCKET EVENTS =====

  // Join private chat room
  socket.on('join-private-chat', (data) => {
    const { username, otherUser } = data;
    const roomName = getPrivateChatRoomName(username, otherUser);
    socket.join(roomName);
    console.log(`👥 ${username} joined private chat room: ${roomName}`);
  });

  // Leave private chat room
  socket.on('leave-private-chat', (data) => {
    const { username, otherUser } = data;
    const roomName = getPrivateChatRoomName(username, otherUser);
    socket.leave(roomName);
    console.log(`👋 ${username} left private chat room: ${roomName}`);
  });

  // ✅ FIXED: Handle private messaging via Socket.io - IMPROVED DUPLICATE PREVENTION
  socket.on('send-private-message-socket', async (data) => {
    try {
      console.log('🤫 Private message via socket:', data);
      
      const { sender_username, receiver_username, content, image_url } = data;

      // Generate unique message ID
      const messageId = `socket_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const insertData = {
        sender_username: sender_username.trim(),
        receiver_username: receiver_username.trim(),
        content: content ? content.trim() : '',
        image_url: image_url || '',
        read: false,
        created_at: new Date().toISOString(),
        message_id: messageId
      };

      const { data: messageData, error } = await supabase
        .from('private_messages')
        .insert([insertData])
        .select();

      if (error) throw error;

      // ✅ FIXED: Create response with message ID for tracking
      const responseData = {
        ...messageData[0],
        custom_message_id: messageId
      };
      
      // ✅ FIXED: Emit to receiver's room ONLY
      io.to(receiver_username).emit('new-private-message', responseData);
      
      // ✅ FIXED: Emit confirmation to sender with the same message ID
      socket.emit('private-message-confirmation', {
        ...responseData,
        status: 'sent',
        message_id: messageId
      });
      
      console.log(`✅ Private message sent from ${sender_username} to ${receiver_username} with ID: ${messageId}`);
      
    } catch (error) {
      console.error('❌ Private message error:', error);
      socket.emit('private-message-error', { error: 'Failed to send private message' });
    }
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

  // ✅ ADDED: Listen for private message confirmation
  socket.on('private-message-confirmation', (data) => {
    console.log('✅ Private message confirmed on server:', data.message_id);
  });

  // ===== CHECKERS GAME SOCKET EVENTS =====
  socket.on('join-game-room', (roomCode) => {
    if (roomCode) {
      socket.join(`game_${roomCode}`);
      console.log(`User joined game room: ${roomCode}`);
    }
  });

  socket.on('leave-game-room', (roomCode) => {
    if (roomCode) {
      socket.leave(`game_${roomCode}`);
      console.log(`User left game room: ${roomCode}`);
    }
  });

  // Handle disconnect properly - UPDATED WITH LAST SEEN
  socket.on('disconnect', (reason) => {
    console.log('🔌 User disconnected:', socket.id, 'Reason:', reason);
    
    // Find user by socket ID
    let foundUsername = null;
    let userLastSeen = null;
    
    for (let [username, data] of onlineUsers.entries()) {
      if (data.socketId === socket.id) {
        foundUsername = username;
        userLastSeen = data.lastSeen; // Get the actual lastSeen timestamp
        
        // Update last seen but keep in list for 5 minutes
        data.lastSeen = Date.now();
        data.isOnline = false;
        
        // Update last_active in database
        if (!PERMANENT_ONLINE_USERS.includes(username)) {
          updateUserLastActive(username);
        }
        
        console.log('⏸️ User marked as inactive:', username, 'Last seen:', new Date(userLastSeen).toLocaleString());
        break;
      }
    }
    
    // If user was found, broadcast their offline status with last seen
    if (foundUsername && !PERMANENT_ONLINE_USERS.includes(foundUsername)) {
      // Update the online users map
      const userData = onlineUsers.get(foundUsername);
      
      // Broadcast to all users that this user is offline with last seen
      const onlineUsersArray = Array.from(onlineUsers.keys());
      
      // FIX: Use the actual lastSeen time instead of current time
      io.emit('user-status-change', { 
        username: foundUsername, 
        status: 'offline',
        lastSeen: new Date(userLastSeen).toISOString(), // Use the actual lastSeen timestamp
        onlineUsers: onlineUsersArray
      });
      
      console.log(`📢 Broadcasted offline status for ${foundUsername} with last seen:`, new Date(userLastSeen).toLocaleString());
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

// Function to update user's last_active in database - ADD THIS FUNCTION
async function updateUserLastActive(username) {
  try {
    console.log(`💾 Updating last_active for ${username} in database...`);
    
    await supabase
      .from('user_profiles')
      .update({ 
        last_active: new Date().toISOString(),
        status: 'offline'
      })
      .eq('username', username);
    
    console.log(`✅ Updated last_active for ${username}`);
  } catch (error) {
    console.error(`❌ Error updating last_active for ${username}:`, error.message);
  }
}

// Add this function to update status to online
async function updateUserStatusOnline(username) {
  try {
    await supabase
      .from('user_profiles')
      .update({ 
        status: 'online',
        last_active: new Date().toISOString()
      })
      .eq('username', username);
    console.log(`✅ Updated status to online for ${username}`);
  } catch (error) {
    console.error(`❌ Error updating online status for ${username}:`, error.message);
  }
}

// 5 MINUTE CLEANUP - Remove users after 5 minutes of inactivity for mobile users
setInterval(() => {
  const now = Date.now();
  const removedUsers = [];
  
  for (let [username, data] of onlineUsers.entries()) {
    // ===== MODIFICATION START: Skip permanent bot users =====
    if (PERMANENT_ONLINE_USERS.includes(username)) {
      // Update their lastSeen to keep them fresh
      data.lastSeen = now;
      data.isOnline = true;
      continue;
    }
    // ===== MODIFICATION END =====
    // 5 minute timeout (300000 milliseconds) for mobile
    if (now - data.lastSeen > onlineStatusTimeout) {
      console.log('⏰ Removing inactive user (5 minutes):', username);
      
      // Update database before removing
      updateUserLastActive(username);
      
      onlineUsers.delete(username);
      removedUsers.push({
        username: username,
        lastSeen: data.lastSeen
      });
    }
  }
  
  // Notify clients about removed users
  if (removedUsers.length > 0) {
    const onlineUsersArray = Array.from(onlineUsers.keys());
    removedUsers.forEach(user => {
      io.emit('user-status-change', { 
        username: user.username, 
        status: 'offline',
        lastSeen: new Date(user.lastSeen).toISOString(),
        onlineUsers: onlineUsersArray
      });
    });
    console.log('🧹 Cleaned up inactive users (5min timeout):', removedUsers.map(u => u.username));
    console.log('📊 Current online users after cleanup:', onlineUsersArray);
  }
}, 60000); // Check every 60 seconds

// ===== NEW ENDPOINT: Get message by ID =====
app.get('/api/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('chatter')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('❌ Error fetching message:', error);
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json(data);
  } catch (error) {
    console.error('❌ Error in get message by ID:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== NEW ENDPOINT: Update message =====
app.put('/api/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const { data, error } = await supabase
      .from('chatter')
      .update({ 
        content: content,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select();

    if (error) {
      console.error('❌ Error updating message:', error);
      return res.status(500).json({ error: 'Failed to update message' });
    }

    // Broadcast update to all clients
    io.emit('message-updated', data[0]);
    
    res.json(data[0]);
  } catch (error) {
    console.error('❌ Error in update message:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// NEW: Get user's last seen time (with bot override)
app.get('/api/user/last-seen/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    // ===== OVERRIDE FOR PERMANENT BOTS =====
    if (PERMANENT_ONLINE_USERS.includes(username)) {
      return res.json({ 
        username: username,
        status: 'online',
        last_seen: null
      });
    }

    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('last_active, status')
      .eq('username', username)
      .limit(1);
    
    if (error) {
      console.error('❌ Error fetching last seen:', error);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!profiles || profiles.length === 0) {
      return res.json({ 
        username: username,
        status: 'offline',
        last_seen: null,
        message: 'User not found'
      });
    }
    
    res.json({
      username: username,
      status: profiles[0].status || 'offline',
      last_seen: profiles[0].last_active
    });
  } catch (error) {
    console.error('❌ Error in last-seen endpoint:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== NEW: LINK LOCAL ACCOUNT WITH OAUTH =====

// Link OAuth account to existing local account
app.post('/api/auth/link-account', verifyToken, async (req, res) => {
  try {
    const { provider, code } = req.body;
    const userId = req.user.id;
    const username = req.user.username;

    console.log(`🔗 Linking ${provider} account to user:`, username);

    if (!provider || !code) {
      return res.status(400).json({ 
        success: false, 
        error: "Provider and authorization code are required" 
      });
    }

    // Handle OAuth callback to get provider data
    const result = await handleOAuthCallback(provider, code, res);
    
    if (!result.success) {
      return res.status(400).json({ 
        success: false, 
        error: result.error 
      });
    }

    // Check if this provider account is already linked to another user
    const { data: existingLinkedAccount } = await supabase
      .from('users')
      .select('id, username')
      .eq('auth_provider', provider)
      .eq('provider_id', result.user.provider_id)
      .neq('id', userId)
      .limit(1);

    if (existingLinkedAccount && existingLinkedAccount.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: `This ${provider} account is already linked to user: ${existingLinkedAccount[0].username}` 
      });
    }

    // Update user with provider information
    const { error: updateError } = await supabase
      .from('users')
      .update({
        auth_provider: provider,
        provider_id: result.user.provider_id,
        provider_data: result.user.provider_data,
        avatar_url: result.user.avatar_url || req.user.avatar_url,
        email_verified: result.user.email_verified || false,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error(`❌ Error linking ${provider} account:`, updateError);
      throw updateError;
    }

    console.log(`✅ ${provider} account linked successfully to user:`, username);
    
    // Generate new token with updated provider info
    const updatedUser = { ...req.user, auth_provider: provider };
    const newToken = generateToken(updatedUser);

    res.json({ 
      success: true, 
      message: `${provider} account linked successfully`,
      auth_provider: provider,
      token: newToken
    });

  } catch (error) {
    console.error('❌ Link account error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to link account: " + error.message 
    });
  }
});

// ===== NEW: UNLINK OAUTH ACCOUNT =====

// Unlink OAuth account and revert to local
app.post('/api/auth/unlink-account', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username;

    console.log('🔗 Unlinking OAuth account for user:', username);

    // Check if user has a password (can revert to local)
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', userId)
      .limit(1);

    if (userError || !user || user.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: "User not found" 
      });
    }

    // If no password hash exists, user can't unlink without setting a password
    if (!user[0].password_hash) {
      return res.status(400).json({ 
        success: false, 
        error: "Cannot unlink OAuth account. Please set a password first." 
      });
    }

    // Revert to local authentication
    const { error: updateError } = await supabase
      .from('users')
      .update({
        auth_provider: 'local',
        provider_id: null,
        provider_data: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('❌ Error unlinking account:', updateError);
      throw updateError;
    }

    console.log('✅ OAuth account unlinked successfully for user:', username);
    
    // Generate new token with local provider info
    const updatedUser = { ...req.user, auth_provider: 'local' };
    const newToken = generateToken(updatedUser);

    res.json({ 
      success: true, 
      message: "Account unlinked successfully",
      auth_provider: 'local',
      token: newToken
    });

  } catch (error) {
    console.error('❌ Unlink account error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to unlink account: " + error.message 
    });
  }
});

// ===== NEW: SET PASSWORD FOR OAUTH USERS =====

// Set password for OAuth users (allows them to also login locally)
app.post('/api/auth/set-password', verifyToken, async (req, res) => {
  try {
    const { password } = req.body;
    const userId = req.user.id;
    const username = req.user.username;

    console.log('🔐 Setting password for OAuth user:', username);

    if (!password) {
      return res.status(400).json({ 
        success: false, 
        error: "Password is required" 
      });
    }

    if (password.length < 4 || password.length > 20) {
      return res.status(400).json({ 
        success: false, 
        error: "Password must be between 4-20 characters" 
      });
    }

    // Hash the password
    const hashedPassword = hashPassword(password);

    // Update user with password
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('❌ Error setting password:', updateError);
      throw updateError;
    }

    console.log('✅ Password set successfully for user:', username);

    res.json({ 
      success: true, 
      message: "Password set successfully",
      note: "You can now login with your username and password"
    });

  } catch (error) {
    console.error('❌ Set password error:', error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to set password: " + error.message 
    });
  }
});

// ===== ENSURE BOT USERS EXIST IN DATABASE =====
async function ensureBotUsersExist() {
  try {
    for (const username of PERMANENT_ONLINE_USERS) {
      // Check if user exists
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .limit(1);

      if (!existingUser || existingUser.length === 0) {
        // Insert user with a dummy password (never used)
        const { data: newUser, error: userError } = await supabase
          .from('users')
          .insert([{
            username,
            password_hash: hashPassword('bot-placeholder'),
            auth_provider: 'local',
            created_at: new Date().toISOString(),
            last_login: new Date().toISOString(),
            is_active: true,
            avatar_url: `https://i.pravatar.cc/150?u=${username}`,
            banned: false
          }])
          .select();
        if (userError) {
          console.error(`❌ Failed to create user ${username}:`, userError);
          continue;
        }
        console.log(`✅ Created user entry for bot: ${username}`);
      }

      // Now ensure profile exists with status 'online' and last_active = null
      const { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', username)
        .limit(1);

      if (!existingProfile || existingProfile.length === 0) {
        // Get user_id
        const { data: user } = await supabase
          .from('users')
          .select('id')
          .eq('username', username)
          .single();

        if (user) {
          await supabase
            .from('user_profiles')
            .insert([{
              user_id: user.id,
              username,
              display_name: username,
              avatar_url: `https://i.pravatar.cc/150?u=${username}`,
              status: 'online',
              last_active: null  // no last seen
            }]);
          console.log(`✅ Created profile for bot: ${username} with status online`);
        }
      } else {
        // Update existing profile to online and clear last_active
        await supabase
          .from('user_profiles')
          .update({ status: 'online', last_active: null })
          .eq('username', username);
        console.log(`✅ Updated profile for bot: ${username} to online and cleared last_active`);
      }
    }
  } catch (error) {
    console.error('❌ Error ensuring bot users exist:', error);
  }
}

// ===== MODIFICATION START: Add permanent bot users at server start =====
addPermanentOnlineUsers();
ensureBotUsersExist();
// Refresh bot online status every 5 minutes
setInterval(() => {
  addPermanentOnlineUsers();
  ensureBotUsersExist();
}, 5 * 60 * 1000);
// ===== MODIFICATION END =====

// ===== CHECKERS GAME ROUTES =====

// Board representation constants
const BOARD_SIZE = 8;

// Initialize a fresh board
function initBoard() {
  const board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
  // Place black pieces (rows 0-2)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if ((row + col) % 2 === 1) {
        board[row][col] = 2; // black pawn
      }
    }
  }
  // Place white pieces (rows 5-7)
  for (let row = 5; row < 8; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if ((row + col) % 2 === 1) {
        board[row][col] = 1; // white pawn
      }
    }
  }
  return board;
}

function getPieceColor(piece) {
  if (piece === 1 || piece === 3) return 'white';
  if (piece === 2 || piece === 4) return 'black';
  return null;
}

function isKing(piece) {
  return piece === 3 || piece === 4;
}

function getMoveDirs(piece) {
  if (piece === 1) return [[-1, -1], [-1, 1]]; // white pawn moves up
  if (piece === 2) return [[1, -1], [1, 1]];   // black pawn moves down
  if (piece === 3) return [[-1, -1], [-1, 1], [1, -1], [1, 1]]; // white king moves any diagonal
  if (piece === 4) return [[-1, -1], [-1, 1], [1, -1], [1, 1]]; // black king moves any diagonal
  return [];
}

function isValidCoord(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function getAllMoves(board, turn) {
  const moves = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (piece !== 0 && getPieceColor(piece) === turn) {
        // Check normal moves
        const dirs = getMoveDirs(piece);
        for (const [dr, dc] of dirs) {
          const newRow = row + dr;
          const newCol = col + dc;
          if (isValidCoord(newRow, newCol) && board[newRow][newCol] === 0) {
            moves.push({ from: [row, col], to: [newRow, newCol], capture: false });
          }
        }
        // Check capture moves
        for (const [dr, dc] of dirs) {
          const jumpRow = row + dr * 2;
          const jumpCol = col + dc * 2;
          const midRow = row + dr;
          const midCol = col + dc;
          if (isValidCoord(jumpRow, jumpCol) && board[jumpRow][jumpCol] === 0 &&
              board[midRow][midCol] !== 0 && getPieceColor(board[midRow][midCol]) !== turn) {
            moves.push({ from: [row, col], to: [jumpRow, jumpCol], capture: true, captured: [midRow, midCol] });
          }
        }
      }
    }
  }
  return moves;
}

function isValidMove(board, fromRow, fromCol, toRow, toCol, turn) {
  const piece = board[fromRow][fromCol];
  if (piece === 0 || getPieceColor(piece) !== turn) return false;

  const dirs = getMoveDirs(piece);
  for (const [dr, dc] of dirs) {
    if (fromRow + dr === toRow && fromCol + dc === toCol && board[toRow][toCol] === 0) {
      return true; // normal move
    }
  }
  // Capture moves
  for (const [dr, dc] of dirs) {
    const midRow = fromRow + dr;
    const midCol = fromCol + dc;
    const jumpRow = fromRow + dr * 2;
    const jumpCol = fromCol + dc * 2;
    if (jumpRow === toRow && jumpCol === toCol && isValidCoord(jumpRow, jumpCol) && board[jumpRow][jumpCol] === 0 &&
        board[midRow][midCol] !== 0 && getPieceColor(board[midRow][midCol]) !== turn) {
      return true; // capture move
    }
  }
  return false;
}

function applyMove(board, fromRow, fromCol, toRow, toCol) {
  const newBoard = board.map(row => [...row]);
  const piece = newBoard[fromRow][fromCol];
  newBoard[toRow][toCol] = piece;
  newBoard[fromRow][fromCol] = 0;

  let captured = null;
  // Check if it was a capture
  if (Math.abs(toRow - fromRow) === 2) {
    const midRow = (fromRow + toRow) / 2;
    const midCol = (fromCol + toCol) / 2;
    captured = newBoard[midRow][midCol];
    newBoard[midRow][midCol] = 0;
  }

  // King promotion
  let promoted = false;
  if ((piece === 1 && toRow === 0) || (piece === 2 && toRow === BOARD_SIZE - 1)) {
    newBoard[toRow][toCol] = piece === 1 ? 3 : 4; // become king
    promoted = true;
  }
  return { newBoard, captured, promoted };
}

function hasCapture(board, turn) {
  const moves = getAllMoves(board, turn);
  return moves.some(m => m.capture);
}

function checkWinner(board) {
  let whiteExists = false, blackExists = false;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (piece === 1 || piece === 3) whiteExists = true;
      if (piece === 2 || piece === 4) blackExists = true;
    }
  }
  if (!whiteExists) return 'black';
  if (!blackExists) return 'white';
  // Also check if any player has moves
  if (getAllMoves(board, 'white').length === 0) return 'black';
  if (getAllMoves(board, 'black').length === 0) return 'white';
  return null;
}

// Create a new game room
app.post('/create-room', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    // Generate a 6-character invite code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Insert room
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .insert([{ code, status: 'waiting' }])
      .select();
    if (roomError) throw roomError;

    // Insert player as white
    const { error: playerError } = await supabase
      .from('players')
      .insert([{ room_id: room[0].id, username, role: 'white' }]);
    if (playerError) throw playerError;

    // Insert initial game state
    const initialBoard = initBoard();
    const { error: gameError } = await supabase
      .from('games')
      .insert([{ room_id: room[0].id, board_state: initialBoard, current_turn: 'white' }]);
    if (gameError) throw gameError;

    res.json({ success: true, roomCode: code });
  } catch (err) {
    console.error('Create room error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Join an existing room
app.post('/join-room', verifyToken, async (req, res) => {
  try {
    const { roomCode } = req.body;
    const username = req.user.username;

    // Find room
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, status')
      .eq('code', roomCode)
      .single();
    if (roomError || !room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.status !== 'waiting') return res.status(400).json({ success: false, error: 'Room is not available' });

    // Check if player already in room
    const { data: existingPlayer, error: checkError } = await supabase
      .from('players')
      .select('id')
      .eq('room_id', room.id)
      .eq('username', username)
      .single();
    if (checkError && checkError.code !== 'PGRST116') throw checkError;
    if (existingPlayer) return res.status(400).json({ success: false, error: 'Already in this room' });

    // Add player as black
    const { error: playerError } = await supabase
      .from('players')
      .insert([{ room_id: room.id, username, role: 'black' }]);
    if (playerError) throw playerError;

    // Update room status to playing
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', room.id);

    res.json({ success: true, roomCode });
  } catch (err) {
    console.error('Join room error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Make a move
app.post('/move', verifyToken, async (req, res) => {
  try {
    const { roomCode, from, to } = req.body;
    const username = req.user.username;
    const [fromRow, fromCol] = from;
    const [toRow, toCol] = to;

    // Get room and game
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, status')
      .eq('code', roomCode)
      .single();
    if (roomError || !room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.status !== 'playing') return res.status(400).json({ success: false, error: 'Game not started' });

    // Get players
    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('username, role')
      .eq('room_id', room.id);
    if (playersError) throw playersError;

    const player = players.find(p => p.username === username);
    if (!player) return res.status(403).json({ success: false, error: 'You are not in this game' });

    // Get current game state
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('board_state, current_turn, winner')
      .eq('room_id', room.id)
      .single();
    if (gameError) throw gameError;
    if (game.winner) return res.status(400).json({ success: false, error: 'Game already finished' });
    if (game.current_turn !== player.role) return res.status(403).json({ success: false, error: 'Not your turn' });

    const board = game.board_state;

    // Validate move
    if (!isValidMove(board, fromRow, fromCol, toRow, toCol, player.role)) {
      return res.status(400).json({ success: false, error: 'Invalid move' });
    }

    // Check if player has capture moves and this move captures (forced capture rule)
    if (hasCapture(board, player.role)) {
      // Player must make a capture move
      if (Math.abs(toRow - fromRow) !== 2) {
        return res.status(400).json({ success: false, error: 'You must capture an opponent piece' });
      }
    }

    // Apply move
    const { newBoard, captured, promoted } = applyMove(board, fromRow, fromCol, toRow, toCol);

    // Switch turn
    let nextTurn = player.role === 'white' ? 'black' : 'white';

    // Check if the player has additional captures (multiple jump)
    if (captured !== null) {
      // Check if the same piece can capture again
      const movesAfter = getAllMoves(newBoard, player.role);
      const pieceAtNewPos = newBoard[toRow][toCol];
      const canCaptureAgain = movesAfter.some(m => m.from[0] === toRow && m.from[1] === toCol && m.capture);
      if (canCaptureAgain) {
        nextTurn = player.role; // same player continues
      }
    }

    // Check winner
    const winner = checkWinner(newBoard);

    // Update game in database
    const { error: updateError } = await supabase
      .from('games')
      .update({
        board_state: newBoard,
        current_turn: nextTurn,
        winner: winner,
        updated_at: new Date().toISOString()
      })
      .eq('room_id', room.id);
    if (updateError) throw updateError;

    // Broadcast update to the room via Socket.io
    const roomName = `game_${roomCode}`;
    io.to(roomName).emit('game-update', {
      board: newBoard,
      currentTurn: nextTurn,
      winner: winner,
      lastMove: { from, to, player: player.role }
    });

    res.json({ success: true, board: newBoard, currentTurn: nextTurn, winner });
  } catch (err) {
    console.error('Move error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get game state
app.get('/game/:roomCode', verifyToken, async (req, res) => {
  try {
    const { roomCode } = req.params;
    const username = req.user.username;

    // Get room
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, status')
      .eq('code', roomCode)
      .single();
    if (roomError || !room) return res.status(404).json({ success: false, error: 'Room not found' });

    // Get players
    const { data: players, error: playersError } = await supabase
      .from('players')
      .select('username, role')
      .eq('room_id', room.id);
    if (playersError) throw playersError;

    // Get game
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('board_state, current_turn, winner')
      .eq('room_id', room.id)
      .single();
    if (gameError) throw gameError;

    // Determine player's role
    const player = players.find(p => p.username === username);
    const role = player ? player.role : null;

    res.json({
      success: true,
      roomCode,
      status: room.status,
      board: game.board_state,
      currentTurn: game.current_turn,
      winner: game.winner,
      players: players,
      yourRole: role
    });
  } catch (err) {
    console.error('Get game error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== END CHECKERS GAME ROUTES =====

// Start server
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🤫 PRIVATE MESSAGING: FIXED - No more disappearing messages!`);
  console.log(`✅ Fixed: Private messages will no longer disappear after sending`);
  console.log(`✅ Fixed: Duplicate message prevention improved`);
  console.log(`✅ Fixed: Message tracking now uses server-generated IDs`);
  console.log(`🔒 Private messages now use proper message tracking system`);
  console.log(`🔹 Command prefix: "${PREFIX}"`);
  console.log(`👥 Online users tracking: ACTIVE (5 minute timeout for mobile)`);
  console.log(`💾 SINGLE RESPONSE SYSTEM: ENABLED`);
  console.log(`🤖 EXCLUSIVE ROUTING: -ai → AI only, other commands → Bot only`);
  console.log(`🚫 DUPLICATE FIX: IMPROVED with better message ID tracking`);
  console.log(`🎯 PREFIX-FREE AI: ENABLED for private AI (auto-adds !ai prefix)`);
  console.log(`💬 Real-time messaging: ENABLED via Socket.io`);
  console.log(`🔌 Socket.io configuration: POLLING ONLY for Opera/Mobile compatibility`);
  console.log(`📱 OPERA FIX: Using polling transport only for real-time updates`);
  console.log(`📱 OPERA MINI FIX: Immediate message deletion enabled`);
  console.log(`🔌 Socket.io events: new-message, message-deleted, user-status-change`);
  console.log(`🤫 PRIVATE MESSAGING: FIXED AND STABLE`);
  console.log(`🔒 Private endpoints: /private-messages/*`);
  console.log(`🔐 USER AUTHENTICATION: ENABLED (Server-side, no localStorage)`);
  console.log(`🔐 Password hashing: ENHANCED with SHA-256 and simple tokens`);
  console.log(`🔐 Simple Tokens: ENABLED for secure authentication (No JWT module needed)`);
  console.log(`🔐 Auth Providers: LOCAL, GOOGLE, and FACEBOOK supported`);
  console.log(`🌐 Cross-browser compatibility: ENABLED`);
  
  // Google OAuth information
  if (oauthConfig.google.clientId) {
    console.log(`🔐 GOOGLE OAUTH: ENABLED with provided credentials`);
    console.log(`   GET /api/auth/google - Get Google OAuth URL`);
    console.log(`   GET /api/auth/google/callback - Google OAuth callback`);
  } else {
    console.log(`⚠️ GOOGLE OAUTH: DISABLED (Set GOOGLE_CLIENT_ID environment variable)`);
  }
  
  // Facebook OAuth information
  if (oauthConfig.facebook.clientId) {
    console.log(`🔐 FACEBOOK OAUTH: ENABLED`);
    console.log(`   GET /api/auth/facebook - Get Facebook OAuth URL`);
    console.log(`   GET /api/auth/facebook/callback - Facebook OAuth callback`);
  } else {
    console.log(`⚠️ FACEBOOK OAUTH: DISABLED (Set FACEBOOK_APP_ID environment variable)`);
  }
  
  // Account linking and management
  console.log(`🔗 ACCOUNT MANAGEMENT:`);
  console.log(`   POST /api/auth/link-account - Link OAuth account to existing local account`);
  console.log(`   POST /api/auth/unlink-account - Unlink OAuth account (revert to local)`);
  console.log(`   POST /api/auth/set-password - Set password for OAuth users`);
  
  // NEW: Added missing endpoints
  console.log(`🤖 NEW: POST /api/ai/private - Private AI endpoint`);
  console.log(`🤖 NEW: POST /api/ai/chat - Main AI chat endpoint`);
  console.log(`💬 NEW: GET /api/private/conversations - Get conversations`);
  console.log(`💬 NEW: GET /api/private/messages/:username - Get private messages`);
  console.log(`💬 NEW: POST /api/private/messages - Send private message`);
  console.log(`💬 NEW: PUT /api/private/messages/read - Mark as read`);
  console.log(`💬 NEW: GET /api/private/unread - Get unread count`);
  console.log(`🔍 NEW: GET /api/debug/private-messages-structure - Debug table structure`);
  console.log(`👥 NEW: GET /api/users/all - Get all signed-up users`);
  console.log(`📊 NEW: GET /api/users/stats - Get user statistics`);
  
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
  console.log(`   GET /api/auth/oauth-info - Get OAuth configuration info`);
  console.log(`📨 MESSAGES ENDPOINTS:`);
  console.log(`   GET /api/messages - Get messages (client-compatible)`);
  console.log(`   POST /api/messages - Send message (client-compatible)`);
  console.log(`   DELETE /api/messages/:id - Delete message (client-compatible) - OPERA MINI FIXED`);
  console.log(`   GET /api/messages/:id - Get message by ID (NEW!)`);
  console.log(`   PUT /api/messages/:id - Update message (NEW!)`);
  console.log(`   **MODIFIED: /api/messages/:id - Now requires authentication and allows Admin0 to delete any message**`);
  console.log(`   **MODIFIED: /messages/:id - Now requires authentication and allows Admin0 to delete any message**`);
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
  console.log(`👋 FIRST VISIT FEATURE:`);
  console.log(`   When a user joins for the first time, they will automatically see all signed-up users`);
  console.log(`   This helps new users discover and connect with other members`);

  // ===== MODIFICATION START: Log permanent online users =====
  console.log(`🤖 PERMANENT ONLINE USERS:`, PERMANENT_ONLINE_USERS.join(', '));
  // ===== MODIFICATION END =====

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
    console.log(`👥 Get All Users: ${renderExternalUrl}/api/users/all`);
    console.log(`📊 User Stats: ${renderExternalUrl}/api/users/stats`);
    
    // Show OAuth callback URLs
    console.log(`🔐 Google OAuth Callback: ${oauthConfig.google.redirectUri}`);
    console.log(`🔐 Facebook OAuth Callback: ${oauthConfig.facebook.redirectUri}`);
    
    // Instructions for setting up OAuth
    if (!oauthConfig.google.clientId || !oauthConfig.facebook.clientId) {
      console.log(`\n⚠️ OAUTH SETUP INSTRUCTIONS:`);
      console.log(`1. For Google OAuth:`);
      console.log(`   - Go to https://console.cloud.google.com/apis/credentials`);
      console.log(`   - Create OAuth 2.0 Client ID`);
      console.log(`   - Set Authorized redirect URIs to: ${oauthConfig.google.redirectUri}`);
      console.log(`   - Set environment variables in Render: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET`);
      
      console.log(`\n2. For Facebook OAuth:`);
      console.log(`   - Go to https://developers.facebook.com/apps/`);
      console.log(`   - Create a new app`);
      console.log(`   - Add Facebook Login product`);
      console.log(`   - Set Valid OAuth Redirect URIs to: ${oauthConfig.facebook.redirectUri}`);
      console.log(`   - Set environment variables in Render: FACEBOOK_APP_ID and FACEBOOK_APP_SECRET`);
    }
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

// ===== MODIFIED: 404 route handler - SPA support for OAuth callback =====
app.use((req, res) => {
  // If it's a GET request and the client accepts HTML, serve the SPA entry point
  // This allows client-side routing to handle /auth/callback and other SPA routes
  if (req.method === 'GET' && req.accepts('html')) {
    // Make sure index.html exists in the 'public' folder
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  
  // Otherwise, respond with JSON error
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: {
      authentication: [
        'POST /api/register',
        'POST /api/login', 
        'POST /api/check-username',
        'GET /api/auth-test',
        'GET /api/auth/google',
        'GET /api/auth/facebook',
        'GET /api/auth/oauth-info'
      ],
      chat: [
        'GET /api/messages',
        'POST /api/messages',
        'DELETE /api/messages/:id',
        'POST /api/command'
      ],
      profiles: [
        'GET /api/user/profile',
        'POST /api/user/profile',
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
        'PUT /api/private/messages/read'
      ],
      users: [
        'GET /api/users/all',
        'GET /api/users/stats'
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
