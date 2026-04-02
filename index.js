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

// ========== DEDUPLICATION CACHE ==========
const processedCommands = new Map(); // key -> timestamp
const DEDUP_WINDOW_MS = 2000; // 2 seconds

function isDuplicate(key) {
  if (processedCommands.has(key)) {
    const lastTime = processedCommands.get(key);
    if (Date.now() - lastTime < DEDUP_WINDOW_MS) {
      return true;
    }
  }
  processedCommands.set(key, Date.now());
  // Clean old entries every minute
  setTimeout(() => {
    for (let [k, t] of processedCommands.entries()) {
      if (Date.now() - t > DEDUP_WINDOW_MS) processedCommands.delete(k);
    }
  }, 60000);
  return false;
}
// ========================================

// Initialize apps
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// ===== ULTRA-COMPATIBLE SOCKET.IO CONFIGURATION FOR OPERA & MOBILE DATA =====
const io = new Server(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false
  },
  transports: ['polling'],
  allowUpgrades: false,
  pingTimeout: 30000,
  pingInterval: 15000,
  cookie: false,
  maxHttpBufferSize: 1e5,
  connectTimeout: 45000,
  httpCompression: false,
  perMessageDeflate: false,
  allowEIO3: true,
  allowRequest: (req, callback) => callback(null, true)
});

// Track online users - 5 MINUTE TIMEOUT for mobile users
const onlineUsers = new Map();
const onlineStatusTimeout = 300000; // 5 minutes

// ===== PERMANENT BOT USERS (ALWAYS ONLINE, GREEN DOT) =====
const PERMANENT_ONLINE_USERS = ['AI', 'Bot'];

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
  const onlineUsersArray = Array.from(onlineUsers.keys());
  io.emit('user-status-change', { 
    username: 'SYSTEM', 
    status: 'online', 
    onlineUsers: onlineUsersArray,
    permanent: PERMANENT_ONLINE_USERS
  });
  console.log('🤖 Permanent bot users added to online list:', PERMANENT_ONLINE_USERS);
}

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
app.use(express.json({ limit: '1mb' }));
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

// ===== ROOT ROUTE – SERVE INDEX.HTML WITH DYNAMIC META TAGS =====
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
        const { data: post, error: postError } = await supabase
          .from('posts')
          .select('*')
          .eq('id', postId)
          .single();

        if (!postError && post) {
          const { data: profile, error: profileError } = await supabase
            .from('user_profiles')
            .select('avatar_url')
            .eq('username', post.author_username)
            .single();

          const authorAvatar = (!profileError && profile) ? profile.avatar_url : null;

          meta.title = `Post by ${post.author_username}`;
          meta.description = post.content.substring(0, 200);
          meta.url += `/?post=${postId}`;

          if (post.media_url && post.media_type === 'image') {
            meta.image = post.media_url;
          } else if (authorAvatar) {
            meta.image = authorAvatar;
          }
        }
      } catch (err) {
        console.error('Error fetching post for meta tags:', err);
      }
    }

    const htmlPath = path.join(__dirname, 'public', 'index.html');
    let html = await fs.readFile(htmlPath, 'utf8');

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

    html = html.replace(
      /<!-- POST_META_START -->[\s\S]*?<!-- POST_META_END -->/,
      `<!-- POST_META_START -->\n${metaTags}\n<!-- POST_META_END -->`
    );

    res.send(html);
  } catch (err) {
    console.error('Error serving index.html:', err);
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ===== ENHANCED USER AUTHENTICATION SYSTEM WITH OAUTH =====

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + JWT_SECRET).digest('hex');
}

function generateToken(user) {
  const tokenData = `${user.id}:${user.username}:${Date.now()}`;
  return Buffer.from(tokenData).toString('base64');
}

function verifyTokenSimple(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    const [userId, username, timestamp] = decoded.split(':');
    
    if (!userId || !username || !timestamp) return null;
    
    const tokenAge = Date.now() - parseInt(timestamp);
    const maxTokenAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    
    if (isNaN(tokenAge) || tokenAge > maxTokenAge) return null;
    
    return { id: userId, username: username, timestamp: parseInt(timestamp) };
  } catch (error) {
    return null;
  }
}

function generateRandomUsername(provider, providerId) {
  const randomSuffix = Math.floor(Math.random() * 10000);
  const baseName = provider === 'google' ? 'googler' : 'facebooker';
  return `${baseName}_${randomSuffix}`;
}

function generateDisplayName(provider, userData) {
  if (provider === 'google') return userData.name || userData.given_name || `Google User`;
  else if (provider === 'facebook') return userData.name || `Facebook User`;
  return `Social User`;
}

// ===== OAUTH AUTHENTICATION ENDPOINTS =====
app.get('/api/auth/google', (req, res) => {
  if (!oauthConfig.google.clientId) {
    return res.status(400).json({ success: false, error: "Google OAuth not configured." });
  }
  const googleAuthUrl = new URL(oauthConfig.google.authUrl);
  googleAuthUrl.searchParams.append('client_id', oauthConfig.google.clientId);
  googleAuthUrl.searchParams.append('redirect_uri', oauthConfig.google.redirectUri);
  googleAuthUrl.searchParams.append('response_type', 'code');
  googleAuthUrl.searchParams.append('scope', 'profile email');
  googleAuthUrl.searchParams.append('access_type', 'offline');
  googleAuthUrl.searchParams.append('prompt', 'consent');
  res.json({ success: true, auth_url: googleAuthUrl.toString() });
});

app.get('/api/auth/facebook', (req, res) => {
  if (!oauthConfig.facebook.clientId) {
    return res.status(400).json({ success: false, error: "Facebook OAuth not configured." });
  }
  const facebookAuthUrl = new URL(oauthConfig.facebook.authUrl);
  facebookAuthUrl.searchParams.append('client_id', oauthConfig.facebook.clientId);
  facebookAuthUrl.searchParams.append('redirect_uri', oauthConfig.facebook.redirectUri);
  facebookAuthUrl.searchParams.append('response_type', 'code');
  facebookAuthUrl.searchParams.append('scope', 'email,public_profile');
  facebookAuthUrl.searchParams.append('state', crypto.randomBytes(16).toString('hex'));
  res.json({ success: true, auth_url: facebookAuthUrl.toString() });
});

async function handlePromptCommand(imageUrl, userPrompt) {
  try {
    const params = {};
    if (imageUrl) params.imageUrl = imageUrl;
    else if (userPrompt) {
      const cleanPrompt = userPrompt.replace(/\s+/g, " ").trim();
      if (!cleanPrompt || cleanPrompt.length < 5) throw new Error("Text prompt too short.");
      params.userPrompt = cleanPrompt;
    } else throw new Error("Provide an image or text.");
    let response;
    try {
      response = await axios.get("https://theone-fast-image-gen.vercel.app/prompt", { params, timeout: 20000 });
    } catch (err) {
      response = await axios.post("https://theone-fast-image-gen.vercel.app/prompt", params, { timeout: 20000 });
    }
    const prompt = response?.data?.prompt;
    if (!prompt || typeof prompt !== "string") throw new Error("Invalid response from API.");
    return prompt;
  } catch (error) {
    console.error("❌ Prompt generation error:", error);
    if (error.response?.status === 422) throw new Error("❌ Failed to process request.\n\nMake your text more descriptive.");
    if (error.code === "ECONNABORTED") throw new Error("⏱️ Server is slow. Try again.");
    throw new Error("⚠️ Something went wrong. Try again.");
  }
}

async function handleOAuthCallback(provider, code, res) {
  try {
    let tokenResponse, userInfo;
    if (provider === 'google') {
      tokenResponse = await axios.post(oauthConfig.google.tokenUrl, {
        client_id: oauthConfig.google.clientId,
        client_secret: oauthConfig.google.clientSecret,
        code: code,
        redirect_uri: oauthConfig.google.redirectUri,
        grant_type: 'authorization_code'
      });
      userInfo = await axios.get(oauthConfig.google.userInfoUrl, {
        headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
      });
    } else if (provider === 'facebook') {
      tokenResponse = await axios.get(oauthConfig.facebook.tokenUrl, {
        params: {
          client_id: oauthConfig.facebook.clientId,
          client_secret: oauthConfig.facebook.clientSecret,
          code: code,
          redirect_uri: oauthConfig.facebook.redirectUri
        }
      });
      userInfo = await axios.get(oauthConfig.facebook.userInfoUrl, {
        params: {
          fields: 'id,name,email,picture.type(large),first_name,last_name',
          access_token: tokenResponse.data.access_token
        }
      });
    }
    const providerUser = userInfo.data;
    const providerId = provider === 'google' ? providerUser.id : providerUser.id;
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_provider', provider)
      .eq('provider_id', providerId)
      .limit(1);
    if (findError) throw findError;
    let user;
    if (existingUser && existingUser.length > 0) {
      user = existingUser[0];
      await supabase.from('users').update({ last_login: new Date().toISOString(), avatar_url: provider === 'google' ? providerUser.picture : (providerUser.picture?.data?.url || user.avatar_url) }).eq('id', user.id);
    } else {
      if (providerUser.email) {
        const { data: existingEmailUser } = await supabase.from('users').select('*').eq('email', providerUser.email).limit(1);
        if (existingEmailUser && existingEmailUser.length > 0) return { success: false, error: `Email ${providerUser.email} is already registered.` };
      }
      let username = providerUser.email ? providerUser.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() : generateRandomUsername(provider, providerId);
      let originalUsername = username;
      let counter = 1;
      while (true) {
        const { data: checkUsers } = await supabase.from('users').select('username').eq('username', username).limit(1);
        if (!checkUsers || checkUsers.length === 0) break;
        username = `${originalUsername}_${counter++}`;
      }
      const userData = {
        username, email: providerUser.email || null, email_verified: provider === 'google' ? (providerUser.verified_email || false) : true,
        auth_provider: provider, provider_id: providerId, provider_data: providerUser,
        avatar_url: provider === 'google' ? providerUser.picture : (providerUser.picture?.data?.url || null),
        created_at: new Date().toISOString(), last_login: new Date().toISOString(), is_active: true, banned: false
      };
      const { data: newUser, error: createError } = await supabase.from('users').insert([userData]).select();
      if (createError) throw createError;
      user = newUser[0];
      try {
        await supabase.from('user_profiles').insert([{
          user_id: user.id, username: user.username, display_name: generateDisplayName(provider, providerUser),
          avatar_url: user.avatar_url, firstname: provider === 'google' ? providerUser.given_name : providerUser.first_name,
          lastname: provider === 'google' ? providerUser.family_name : providerUser.last_name, bio: '', status: 'online'
        }]);
      } catch (profileError) { console.error(`❌ Error creating profile:`, profileError); }
    }
    const token = generateToken(user);
    return { success: true, user: user, token: token };
  } catch (error) {
    console.error(`❌ ${provider} OAuth error:`, error);
    throw error;
  }
}

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, error: oauthError } = req.query;
    if (oauthError) throw new Error(`Google OAuth error: ${oauthError}`);
    if (!code) return res.status(400).json({ success: false, error: "Authorization code required" });
    const result = await handleOAuthCallback('google', code, res);
    if (!result.success) {
      const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
      return res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(result.error)}`);
    }
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    res.redirect(`${frontendUrl}/auth/callback?token=${result.token}&username=${result.user.username}&provider=google`);
  } catch (error) {
    console.error('❌ Google OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent('Google authentication failed')}`);
  }
});

app.get('/api/auth/facebook/callback', async (req, res) => {
  try {
    const { code, error: oauthError } = req.query;
    if (oauthError) throw new Error(`Facebook OAuth error: ${oauthError}`);
    if (!code) return res.status(400).json({ success: false, error: "Authorization code required" });
    const result = await handleOAuthCallback('facebook', code, res);
    if (!result.success) {
      const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
      return res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(result.error)}`);
    }
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    res.redirect(`${frontendUrl}/auth/callback?token=${result.token}&username=${result.user.username}&provider=facebook`);
  } catch (error) {
    console.error('❌ Facebook OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent('Facebook authentication failed')}`);
  }
});

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ success: false, error: "Authentication token required" });
  const token = authHeader.replace('Bearer ', '');
  if (!token) return res.status(401).json({ success: false, error: "Authentication token required" });
  try {
    const decoded = verifyTokenSimple(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
    // fallback old token format
    const oldDecoded = Buffer.from(token, 'base64').toString('ascii');
    const [username, timestamp] = oldDecoded.split(':');
    if (!username) return res.status(401).json({ success: false, error: "Invalid token format" });
    const tokenAge = Date.now() - parseInt(timestamp);
    if (isNaN(tokenAge) || tokenAge > 30*24*60*60*1000) return res.status(401).json({ success: false, error: "Token expired" });
    supabase.from('users').select('*').ilike('username', username).limit(1).then(({ data: users, error: userError }) => {
      if (userError || !users || users.length === 0) return res.status(401).json({ success: false, error: "User not found" });
      req.user = { id: users[0].id, username: users[0].username, email: users[0].email, auth_provider: users[0].auth_provider };
      next();
    }).catch(error => res.status(401).json({ success: false, error: "Invalid token" }));
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
}

// User registration endpoint
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username and password are required" });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ success: false, error: "Username must be between 3-20 characters" });
    if (password.length < 4 || password.length > 20) return res.status(400).json({ success: false, error: "Password must be between 4-20 characters" });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ success: false, error: "Username can only contain letters, numbers, and underscores" });
    const { data: existingUsers, error: checkError } = await supabase.from('users').select('username').ilike('username', username);
    if (checkError) return res.status(500).json({ success: false, error: "Database error" });
    if (existingUsers && existingUsers.length > 0) return res.status(409).json({ success: false, error: "Username already exists" });
    if (email) {
      const { data: existingEmail } = await supabase.from('users').select('email').eq('email', email).eq('auth_provider', 'local').limit(1);
      if (existingEmail && existingEmail.length > 0) return res.status(409).json({ success: false, error: "Email already registered with a local account" });
    }
    const hashedPassword = hashPassword(password);
    const { data: newUser, error: createError } = await supabase.from('users').insert([{ username: username.trim(), password_hash: hashedPassword, email: email || null, auth_provider: 'local', created_at: new Date().toISOString(), last_login: new Date().toISOString(), is_active: true, avatar_url: `https://i.pravatar.cc/150?u=${username}`, banned: false }]).select();
    if (createError) return res.status(500).json({ success: false, error: "Failed to create user" });
    const userToken = generateToken(newUser[0]);
    try {
      await supabase.from('user_profiles').insert([{ user_id: newUser[0].id, username: username, display_name: username, avatar_url: `https://i.pravatar.cc/150?u=${username}`, status: 'online' }]);
    } catch (profileError) { console.log('⚠️ Could not create profile:', profileError); }
    res.status(201).json({ success: true, message: "User registered successfully", username: username, user_id: newUser[0].id, token: userToken, auth_provider: 'local' });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// User login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username and password are required" });
    const { data: users, error: findError } = await supabase.from('users').select('*').ilike('username', username).limit(1);
    if (findError) return res.status(500).json({ success: false, error: "Database error" });
    if (!users || users.length === 0) return res.status(401).json({ success: false, error: "Invalid username or password" });
    const user = users[0];
    if (user.banned) return res.status(403).json({ success: false, error: "Your account has been banned." });
    if (user.auth_provider !== 'local' && !user.password_hash) return res.status(401).json({ success: false, error: `This account uses ${user.auth_provider} authentication. Please sign in with ${user.auth_provider}.` });
    const isPasswordValid = hashPassword(password) === user.password_hash;
    if (!isPasswordValid) return res.status(401).json({ success: false, error: "Invalid username or password" });
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    const userToken = generateToken(user);
    res.json({ success: true, message: "Login successful", username: user.username, user_id: user.id, token: userToken, auth_provider: user.auth_provider });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ available: true });
    const { data: existingUsers, error } = await supabase.from('users').select('username').ilike('username', username).limit(1);
    if (error) return res.status(500).json({ success: false, error: "Database error" });
    res.json({ available: !existingUsers || existingUsers.length === 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username and password are required" });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ success: false, error: "Username must be between 3-20 characters" });
    if (password.length < 4 || password.length > 20) return res.status(400).json({ success: false, error: "Password must be between 4-20 characters" });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ success: false, error: "Username can only contain letters, numbers, and underscores" });
    const { data: existingUsers, error: checkError } = await supabase.from('users').select('username').ilike('username', username);
    if (checkError) return res.status(500).json({ success: false, error: "Database error" });
    if (existingUsers && existingUsers.length > 0) return res.status(409).json({ success: false, error: "Username already exists" });
    if (email) {
      const { data: existingEmail } = await supabase.from('users').select('email').eq('email', email).eq('auth_provider', 'local').limit(1);
      if (existingEmail && existingEmail.length > 0) return res.status(409).json({ success: false, error: "Email already registered with a local account" });
    }
    const hashedPassword = hashPassword(password);
    const { data: newUser, error: createError } = await supabase.from('users').insert([{ username: username.trim(), password_hash: hashedPassword, email: email || null, auth_provider: 'local', created_at: new Date().toISOString(), last_login: new Date().toISOString(), is_active: true, avatar_url: `https://i.pravatar.cc/150?u=${username}`, banned: false }]).select();
    if (createError) return res.status(500).json({ success: false, error: "Failed to create user" });
    const userToken = generateToken(newUser[0]);
    try {
      await supabase.from('user_profiles').insert([{ user_id: newUser[0].id, username: username, display_name: username, avatar_url: `https://i.pravatar.cc/150?u=${username}`, status: 'online' }]);
    } catch (profileError) { console.log('⚠️ Could not create profile:', profileError); }
    res.status(201).json({ success: true, message: "User registered successfully", username: username, user_id: newUser[0].id, token: userToken, auth_provider: 'local' });
  } catch (error) {
    console.error('❌ Auth registration error:', error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username and password are required" });
    const { data: users, error: findError } = await supabase.from('users').select('*').ilike('username', username).limit(1);
    if (findError) return res.status(500).json({ success: false, error: "Database error" });
    if (!users || users.length === 0) return res.status(401).json({ success: false, error: "Invalid username or password" });
    const user = users[0];
    if (user.banned) return res.status(403).json({ success: false, error: "Your account has been banned." });
    if (user.auth_provider !== 'local' && !user.password_hash) return res.status(401).json({ success: false, error: `This account uses ${user.auth_provider} authentication. Please sign in with ${user.auth_provider}.` });
    const isPasswordValid = hashPassword(password) === user.password_hash;
    if (!isPasswordValid) return res.status(401).json({ success: false, error: "Invalid username or password" });
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    const userToken = generateToken(user);
    res.json({ success: true, message: "Login successful", username: user.username, user_id: user.id, token: userToken, auth_provider: user.auth_provider });
  } catch (error) {
    console.error('❌ Auth login error:', error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/auth/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ available: true });
    const { data: existingUsers, error } = await supabase.from('users').select('username').ilike('username', username).limit(1);
    if (error) return res.status(500).json({ success: false, error: "Database error" });
    res.json({ available: !existingUsers || existingUsers.length === 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/auth/auto-login', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const username = req.user.username;
    const { data: users, error } = await supabase.from('users').select('*').eq('id', userId).limit(1);
    if (error || !users || users.length === 0) return res.status(401).json({ success: false, error: "User not found" });
    const user = users[0];
    if (user.banned) return res.status(403).json({ success: false, error: "Your account has been banned." });
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    res.json({ success: true, message: "Auto-login successful", username: user.username, user_id: user.id, email: user.email, auth_provider: user.auth_provider, avatar_url: user.avatar_url });
  } catch (error) {
    console.error('❌ Auto-login error:', error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.get('/api/auth/oauth-info', (req, res) => {
  res.json({ success: true, google: { enabled: !!oauthConfig.google.clientId, clientId: oauthConfig.google.clientId, redirectUri: oauthConfig.google.redirectUri }, facebook: { enabled: !!oauthConfig.facebook.clientId, redirectUri: oauthConfig.facebook.redirectUri }, endpoints: { google: { auth: `/api/auth/google`, callback: `/api/auth/google/callback` }, facebook: { auth: `/api/auth/facebook`, callback: `/api/auth/facebook/callback` } } });
});

app.get('/api/login', (req, res) => res.status(405).json({ success: false, error: "Method Not Allowed", message: "Use POST method for login" }));
app.get('/api/register', (req, res) => res.status(405).json({ success: false, error: "Method Not Allowed", message: "Use POST method for registration" }));
app.get('/api/check-username', (req, res) => res.status(405).json({ success: false, error: "Method Not Allowed", message: "Use POST method for checking username" }));

app.get('/api/auth-test', (req, res) => {
  res.json({ message: "✅ Authentication endpoints are working!", timestamp: new Date().toISOString(), endpoints: [ { method: "POST", path: "/api/register" }, { method: "POST", path: "/api/login" }, { method: "POST", path: "/api/check-username" }, { method: "GET", path: "/api/user/profile/:username" }, { method: "POST", path: "/api/user/profile" }, { method: "GET", path: "/api/auth/google" }, { method: "GET", path: "/api/auth/facebook" }, { method: "GET", path: "/api/auth/oauth-info" } ] });
});

// ===== PROFILE MANAGEMENT ENDPOINTS =====
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    const { data: users, error: userError } = await supabase.from('users').select('id, username, email, auth_provider, created_at, last_login, avatar_url, provider_data, banned').ilike('username', username).limit(1);
    if (userError || !users || users.length === 0) return res.status(404).json({ success: false, error: "User not found" });
    const user = users[0];
    const { data: profiles, error: profileError } = await supabase.from('user_profiles').select('*').eq('username', username).limit(1);
    let profileData;
    if (profileError || !profiles || profiles.length === 0) {
      profileData = { username: username, firstname: '', lastname: '', bio: '', age: null, gender: '', location: '', interests: '', avatar_url: user.avatar_url || `https://i.pravatar.cc/150?u=${username}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), display_name: username, status: 'online' };
    } else profileData = profiles[0];
    const completeProfile = { username: username, email: user.email, user_id: user.id, auth_provider: user.auth_provider || 'local', created_at: user.created_at, last_login: user.last_login, avatar_url: user.avatar_url, provider_data: user.provider_data, banned: user.banned || false, firstname: profileData.firstname || '', lastname: profileData.lastname || '', bio: profileData.bio || '', age: profileData.age || null, gender: profileData.gender || '', location: profileData.location || '', interests: profileData.interests || '', avatar: profileData.avatar_url || user.avatar_url || `https://i.pravatar.cc/150?u=${username}`, display_name: profileData.display_name || username, status: profileData.status || 'online', profile_created_at: profileData.created_at || new Date().toISOString(), profile_updated_at: profileData.updated_at || new Date().toISOString() };
    res.json({ success: true, profile: completeProfile });
  } catch (error) { res.status(500).json({ success: false, error: "Internal server error" }); }
});

function validateHumanName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 2 || name.length > 50) return false;
  if (!/^[a-zA-Z\s\.\-\']+$/.test(name)) return false;
  if (!/[aeiouAEIOU]/.test(name)) return false;
  if (/(.)\1{3,}/.test(name)) return false;
  return true;
}

async function updateProfileHandler(req, res) {
  try {
    const username = req.user.username;
    const profileData = req.body;
    if (profileData.display_name && !validateHumanName(profileData.display_name)) return res.status(400).json({ success: false, error: "Display name must be a valid human name (2-50 characters, letters, spaces, dots, hyphens, apostrophes, must contain a vowel, no repeating characters)" });
    const { data: users, error: userError } = await supabase.from('users').select('id').ilike('username', username).limit(1);
    if (userError || !users || users.length === 0) return res.status(404).json({ success: false, error: "User not found" });
    const userId = users[0].id;
    const { data: existingProfiles, error: checkError } = await supabase.from('user_profiles').select('id').eq('username', username).limit(1);
    const now = new Date().toISOString();
    const profileUpdateData = { username: username, user_id: userId, display_name: profileData.display_name || username, avatar_url: profileData.avatar || profileData.avatar_url || `https://i.pravatar.cc/150?u=${username}`, bio: profileData.bio || '', location: profileData.location || '', firstname: profileData.firstname || '', lastname: profileData.lastname || '', age: profileData.age || null, gender: profileData.gender || '', interests: profileData.interests || '', status: 'online', updated_at: now };
    let result;
    if (existingProfiles && existingProfiles.length > 0) result = await supabase.from('user_profiles').update(profileUpdateData).eq('username', username).select();
    else result = await supabase.from('user_profiles').insert([{ ...profileUpdateData, created_at: now }]).select();
    if (result.error) return res.status(500).json({ success: false, error: "Failed to save profile: " + result.error.message });
    const savedProfile = result.data[0];
    const responseProfile = { ...savedProfile, avatar: savedProfile.avatar_url || `https://i.pravatar.cc/150?u=${username}` };
    res.json({ success: true, message: "Profile updated successfully", profile: responseProfile });
  } catch (error) { res.status(500).json({ success: false, error: "Internal server error: " + error.message }); }
}
app.put('/api/user/profile', verifyToken, updateProfileHandler);
app.post('/api/user/profile', verifyToken, updateProfileHandler);

app.get('/api/user/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (PERMANENT_ONLINE_USERS.includes(username)) {
      return res.json({ success: true, profile: { username: username, firstname: '', lastname: '', bio: '', age: null, gender: '', location: '', interests: '', avatar: `https://i.pravatar.cc/150?u=${username}`, display_name: username, status: 'online', last_active: null, last_seen: null } });
    }
    const { data: profiles, error } = await supabase.from('user_profiles').select('*').eq('username', username).limit(1);
    if (error || !profiles || profiles.length === 0) return res.json({ success: true, profile: { username: username, firstname: '', lastname: '', bio: '', age: null, gender: '', location: '', interests: '', avatar: `https://i.pravatar.cc/150?u=${username}` } });
    const profile = profiles[0];
    res.json({ success: true, profile: { ...profile, avatar: profile.avatar_url || `https://i.pravatar.cc/150?u=${username}` } });
  } catch (error) { res.status(500).json({ success: false, error: "Internal server error" }); }
});

// ===== AI ENDPOINTS =====
app.post('/api/ai/private', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    const response = await axios.get(`https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(message)}&cb=${Date.now()}`, { headers: { Accept: "application/json", "User-Agent": "GoatBot/1.0" }, timeout: 15000 });
    let responseData, aiResponse;
    if (typeof response.data === 'string') {
      try { responseData = JSON.parse(response.data); } catch(e) { aiResponse = response.data; }
    } else responseData = response.data;
    if (!aiResponse) aiResponse = responseData.response || responseData.message || responseData.data || JSON.stringify(responseData) || "⚠️ No response";
    res.json({ reply: aiResponse });
  } catch (error) { res.status(500).json({ error: `Private AI Error: ${error.message}` }); }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    const response = await axios.get(`https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(message)}&cb=${Date.now()}`, { timeout: 15000 });
    let responseData, aiResponse;
    if (typeof response.data === 'string') {
      try { responseData = JSON.parse(response.data); } catch(e) { aiResponse = response.data; }
    } else responseData = response.data;
    if (!aiResponse) aiResponse = responseData.response || responseData.message || responseData.data || JSON.stringify(responseData) || "⚠️ No response";
    res.json({ reply: aiResponse });
  } catch (error) { res.status(500).json({ error: `Main AI Error: ${error.message}` }); }
});

// ===== MESSAGES ENDPOINTS (with bot status override) =====
app.get('/api/messages', async (req, res) => {
  try {
    const { data: messages, error } = await supabase.from('chatter').select('id, content, username, created_at, image_url, reply_to').order('created_at', { ascending: false });
    if (error) throw error;
    const usernames = [...new Set(messages.map(msg => msg.username))];
    const { data: profiles } = await supabase.from('user_profiles').select('username, status, last_active').in('username', usernames);
    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.username] = { status: p.status || 'offline', last_seen: p.last_active }; });
    const messagesWithStatus = messages.map(msg => {
      if (PERMANENT_ONLINE_USERS.includes(msg.username)) return { ...msg, user_status: 'online', last_seen: null };
      return { ...msg, user_status: profileMap[msg.username]?.status || 'offline', last_seen: profileMap[msg.username]?.last_seen || null };
    });
    res.json(messagesWithStatus);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/messages', async (req, res) => {
  try {
    let { content, username, image_url, reply_to } = req.body;
    if ((!content || content.trim() === '') && !image_url) return res.status(400).json({ error: "Content or image is required" });
    if (!username || username.trim() === '') return res.status(400).json({ error: "Username is required" });
    const { data: user, error: userError } = await supabase.from('users').select('banned').ilike('username', username).limit(1).single();
    if (!userError && user && user.banned) {
      const banMessage = `🚫 User @${username} has been banned and cannot send messages.`;
      const systemMsg = { content: banMessage, username: 'System', image_url: null, reply_to: null, created_at: new Date().toISOString() };
      const { data: savedSystemMsg, error: saveError } = await supabase.from('chatter').insert([systemMsg]).select();
      if (!saveError && savedSystemMsg && savedSystemMsg[0]) io.emit('new-message', savedSystemMsg[0]);
      else io.emit('system-message', banMessage);
      return res.status(403).json({ error: "You are banned and cannot send messages." });
    }
    const insertData = { content: (content && content.trim() !== '') ? content.trim() : '', username: username.trim(), image_url: image_url || '', reply_to: reply_to || '', created_at: new Date().toISOString() };
    const { data, error } = await supabase.from('chatter').insert([insertData]).select();
    if (error) {
      const minimalData = { content: (content && content.trim() !== '') ? content.trim() : 'Message', username: username.trim(), created_at: new Date().toISOString() };
      const { data: retryData, error: retryError } = await supabase.from('chatter').insert([minimalData]).select();
      if (retryError) throw retryError;
      io.emit('new-message', retryData[0]);
      return res.status(201).json(retryData[0]);
    }
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) { res.status(500).json({ error: "Failed to save message: " + error.message }); }
});

app.delete('/api/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    const { data: message, error: fetchError } = await supabase.from('chatter').select('username').eq('id', id).single();
    if (fetchError || !message) return res.status(404).json({ success: false, error: 'Message not found' });
    if (username !== 'Admin0' && message.username !== username) return res.status(403).json({ success: false, error: 'You can only delete your own messages' });
    const { error } = await supabase.from('chatter').delete().eq('id', id);
    if (error) throw error;
    io.emit('message-deleted', id);
    res.status(200).json({ success: true, message: "Message deleted successfully" });
  } catch (error) { res.status(500).json({ success: false, error: "Failed to delete message: " + error.message }); }
});

app.get('/api/users/all', async (req, res) => {
  try {
    const { data: users, error: usersError } = await supabase.from('users').select('id, username, email, auth_provider, created_at, last_login, avatar_url, provider_data, banned').order('created_at', { ascending: false });
    if (usersError) return res.status(500).json({ success: false, error: "Failed to fetch users" });
    const usernames = users.map(u => u.username);
    const { data: profiles } = await supabase.from('user_profiles').select('*').in('username', usernames);
    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.username] = p; });
    const allUsersData = users.map(user => {
      const profile = profileMap[user.username] || {};
      const isBot = PERMANENT_ONLINE_USERS.includes(user.username);
      return { username: user.username, email: user.email || '', user_id: user.id, auth_provider: user.auth_provider || 'local', created_at: user.created_at, last_login: user.last_login, avatar_url: user.avatar_url, provider_data: user.provider_data, banned: user.banned || false, firstname: profile.firstname || '', lastname: profile.lastname || '', bio: profile.bio || '', age: profile.age || null, gender: profile.gender || '', location: profile.location || '', interests: profile.interests || '', avatar: profile.avatar_url || user.avatar_url || `https://i.pravatar.cc/150?u=${user.username}`, display_name: profile.display_name || user.username, status: isBot ? 'online' : (profile.status || 'offline'), last_seen: isBot ? null : (profile.last_active || user.last_login), message_count: 0, post_count: 0, join_date: user.created_at, is_new_user: isNewUser(user.created_at) };
    });
    try {
      const { data: messageCounts } = await supabase.from('chatter').select('username').in('username', usernames);
      if (messageCounts) {
        const msgCountMap = {};
        messageCounts.forEach(msg => { msgCountMap[msg.username] = (msgCountMap[msg.username] || 0) + 1; });
        allUsersData.forEach(user => { user.message_count = msgCountMap[user.username] || 0; });
      }
    } catch(e) {}
    try {
      const { data: postCounts } = await supabase.from('posts').select('author_username').in('author_username', usernames);
      if (postCounts) {
        const postCountMap = {};
        postCounts.forEach(post => { postCountMap[post.author_username] = (postCountMap[post.author_username] || 0) + 1; });
        allUsersData.forEach(user => { user.post_count = postCountMap[user.username] || 0; });
      }
    } catch(e) {}
    res.json({ success: true, users: allUsersData, total_count: allUsersData.length, new_users: allUsersData.filter(u => u.is_new_user).length });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

function isNewUser(createdAt) {
  if (!createdAt) return false;
  const diffDays = (new Date() - new Date(createdAt)) / (1000 * 60 * 60 * 24);
  return diffDays <= 7;
}

app.get('/api/users/stats', async (req, res) => {
  try {
    const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const today = new Date(); today.setHours(0,0,0,0);
    const { count: newUsersToday } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString());
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    const { count: activeUsers } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('last_login', yesterday.toISOString());
    const { data: providerStats } = await supabase.from('users').select('auth_provider');
    let providerCounts = {};
    if (providerStats) providerStats.forEach(user => { const p = user.auth_provider || 'local'; providerCounts[p] = (providerCounts[p] || 0) + 1; });
    res.json({ success: true, stats: { total_users: totalUsers || 0, new_users_today: newUsersToday || 0, active_users_last_24h: activeUsers || 0, auth_providers: providerCounts, timestamp: new Date().toISOString() } });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ===== PRIVATE MESSAGES ENDPOINTS =====
app.post('/api/private/messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, image_url } = req.body;
    if (!sender_username || !receiver_username) return res.status(400).json({ success: false, error: "Sender and receiver usernames are required" });
    if ((!content || content.trim() === '') && !image_url) return res.status(400).json({ success: false, error: "Content or image is required" });
    const { data: sender, error: senderError } = await supabase.from('users').select('banned').ilike('username', sender_username).limit(1).single();
    if (!senderError && sender && sender.banned) return res.status(403).json({ success: false, error: "You are banned and cannot send messages." });
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
    const insertData = { sender_username: sender_username.trim(), receiver_username: receiver_username.trim(), content: content ? content.trim() : '', image_url: image_url || null, read: false, created_at: new Date().toISOString(), message_id: messageId };
    const { data, error } = await supabase.from('private_messages').insert([insertData]).select();
    if (error) return res.status(500).json({ success: false, error: "Database error: " + error.message });
    const responseData = { ...data[0], custom_message_id: messageId };
    io.to(receiver_username).emit('new-private-message', responseData);
    io.to(sender_username).emit('private-message-sent', responseData);
    res.status(201).json({ success: true, data: responseData, custom_message_id: messageId });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/private/conversations', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: "Username query parameter is required" });
    const { data: messages, error } = await supabase.from('private_messages').select('*').or(`sender_username.eq.${username},receiver_username.eq.${username}`).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Database error: ' + error.message });
    const conversationMap = new Map();
    (messages || []).forEach(msg => {
      const otherUser = msg.sender_username === username ? msg.receiver_username : msg.sender_username;
      if (!conversationMap.has(otherUser)) conversationMap.set(otherUser, { username: otherUser, lastMessage: msg.content, lastMessageTime: msg.created_at, unread: msg.receiver_username === username && !msg.read, isSender: msg.sender_username === username });
      else {
        const existing = conversationMap.get(otherUser);
        if (new Date(msg.created_at) > new Date(existing.lastMessageTime)) { existing.lastMessage = msg.content; existing.lastMessageTime = msg.created_at; existing.unread = msg.receiver_username === username && !msg.read; existing.isSender = msg.sender_username === username; }
      }
    });
    res.json(Array.from(conversationMap.values()).sort((a,b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime)));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/private/messages/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { otherUser } = req.query;
    if (!username || !otherUser) return res.status(400).json({ error: "Username and otherUser parameters are required" });
    const { data: messages, error } = await supabase.from('private_messages').select('*').or(`sender_username.eq.${username},receiver_username.eq.${username}`).or(`sender_username.eq.${otherUser},receiver_username.eq.${otherUser}`).order('created_at', { ascending: true });
    if (error) return res.status(500).json({ error: 'Database error: ' + error.message });
    const filteredMessages = (messages || []).filter(msg => (msg.sender_username === username && msg.receiver_username === otherUser) || (msg.sender_username === otherUser && msg.receiver_username === username));
    const unreadMessages = filteredMessages.filter(msg => msg.receiver_username === username && !msg.read);
    if (unreadMessages.length > 0) await supabase.from('private_messages').update({ read: true }).in('id', unreadMessages.map(msg => msg.id));
    res.json(filteredMessages);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/private/unread', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: "Username query parameter is required" });
    const { count, error } = await supabase.from('private_messages').select('*', { count: 'exact', head: true }).eq('receiver_username', username).eq('read', false);
    if (error) return res.status(500).json({ error: 'Database error: ' + error.message });
    res.json({ unreadCount: count || 0 });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/private/messages/read', async (req, res) => {
  try {
    const { sender_username, receiver_username } = req.body;
    if (!sender_username || !receiver_username) return res.status(400).json({ error: "Sender and receiver usernames are required" });
    const { error } = await supabase.from('private_messages').update({ read: true }).eq('sender_username', sender_username).eq('receiver_username', receiver_username).eq('read', false);
    if (error) return res.status(500).json({ error: 'Database error: ' + error.message });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ===== POSTS SYSTEM =====
app.get('/api/posts', async (req, res) => {
  try {
    const { username } = req.query;
    let query = supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (!username) query = query.eq('visibility', 'public');
    const { data: posts, error: postsError } = await query;
    if (postsError) return res.status(500).json({ error: 'Failed to fetch posts' });
    let filteredPosts = posts;
    if (username) filteredPosts = posts.filter(post => post.visibility === 'public' || post.author_username === username);
    const postsWithDetails = await Promise.all((filteredPosts || []).map(async (post) => {
      const { data: comments } = await supabase.from('post_comments').select('*').eq('post_id', post.id).order('created_at', { ascending: true });
      let userLiked = false;
      if (username) {
        const { data: like } = await supabase.from('post_likes').select('id').eq('post_id', post.id).eq('username', username).single();
        userLiked = !!like;
      }
      return { ...post, comments: comments || [], userLiked, author: post.author_username, timestamp: post.created_at, likes: post.likes_count || 0, media: post.media_url ? { url: post.media_url, type: post.media_type || 'image' } : null };
    }));
    res.json(postsWithDetails);
  } catch (error) { res.status(500).json({ error: 'Failed to fetch posts' }); }
});

app.post('/api/posts', async (req, res) => {
  try {
    const { author_username, content, media_url, media_type } = req.body;
    if (!author_username || !content) return res.status(400).json({ error: "Author and content are required" });
    const { data: author, error: authorError } = await supabase.from('users').select('banned').ilike('username', author_username).limit(1).single();
    if (!authorError && author && author.banned) return res.status(403).json({ error: "You are banned and cannot create posts." });
    const postData = { author_username: author_username.trim(), content: content.trim(), media_url: media_url || null, media_type: media_type || null, likes_count: 0, comments_count: 0, visibility: 'public' };
    const { data: post, error } = await supabase.from('posts').insert([postData]).select();
    if (error) return res.status(500).json({ error: "Failed to create post: " + error.message });
    res.status(201).json({ ...post[0], author: post[0].author_username, timestamp: post[0].created_at, likes: 0, comments: [], userLiked: false, media: post[0].media_url ? { url: post[0].media_url, type: post[0].media_type || 'image' } : null });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { author_username, content } = req.body;
    if (!author_username || !content) return res.status(400).json({ error: "Author and content are required" });
    const { data: post, error: postError } = await supabase.from('posts').select('id').eq('id', postId).single();
    if (postError || !post) return res.status(404).json({ error: "Post not found" });
    const commentData = { post_id: postId, author_username: author_username.trim(), content: content.trim() };
    const { data: comment, error } = await supabase.from('post_comments').insert([commentData]).select();
    if (error) return res.status(500).json({ error: "Failed to add comment: " + error.message });
    await supabase.from('posts').update({ comments_count: await getCommentsCount(postId), updated_at: new Date().toISOString() }).eq('id', postId);
    res.status(201).json(comment[0]);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username is required" });
    const { data: post, error: postError } = await supabase.from('posts').select('id').eq('id', postId).single();
    if (postError || !post) return res.status(404).json({ error: "Post not found" });
    const { data: existingLike } = await supabase.from('post_likes').select('id').eq('post_id', postId).eq('username', username).single();
    if (existingLike) await supabase.from('post_likes').delete().eq('id', existingLike.id);
    else await supabase.from('post_likes').insert([{ post_id: postId, username: username }]);
    const newLikesCount = await getLikesCount(postId);
    await supabase.from('posts').update({ likes_count: newLikesCount, updated_at: new Date().toISOString() }).eq('id', postId);
    res.json({ success: true, likesCount: newLikesCount, userLiked: !existingLike });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/posts/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { currentUser } = req.query;
    const { data: posts, error } = await supabase.from('posts').select('*').eq('author_username', username).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: 'Failed to fetch user posts' });
    const postsWithDetails = await Promise.all((posts || []).map(async (post) => {
      const { data: comments } = await supabase.from('post_comments').select('*').eq('post_id', post.id).order('created_at', { ascending: true });
      let userLiked = false;
      if (currentUser) {
        const { data: like } = await supabase.from('post_likes').select('id').eq('post_id', post.id).eq('username', currentUser).single();
        userLiked = !!like;
      }
      return { ...post, comments: comments || [], userLiked, author: post.author_username, timestamp: post.created_at, likes: post.likes_count || 0, media: post.media_url ? { url: post.media_url, type: post.media_type || 'image' } : null };
    }));
    res.json(postsWithDetails);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/posts/:postId', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const requesterUsername = req.user.username;
    const { data: post, error: postError } = await supabase.from('posts').select('author_username').eq('id', postId).single();
    if (postError || !post) return res.status(404).json({ error: "Post not found" });
    if (post.author_username !== requesterUsername && requesterUsername !== 'Admin0') return res.status(403).json({ error: "You can only delete your own posts" });
    const { error: deleteError } = await supabase.from('posts').delete().eq('id', postId);
    if (deleteError) return res.status(500).json({ error: "Failed to delete post: " + deleteError.message });
    io.emit('post-deleted', postId);
    res.json({ success: true, message: "Post deleted successfully" });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

async function getCommentsCount(postId) {
  const { count } = await supabase.from('post_comments').select('*', { count: 'exact', head: true }).eq('post_id', postId);
  return count || 0;
}
async function getLikesCount(postId) {
  const { count } = await supabase.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
  return count || 0;
}

// ===== CHECKERS GAME =====
const BOARD_SIZE = 8;
function initBoard() {
  const board = Array(BOARD_SIZE).fill().map(() => Array(BOARD_SIZE).fill(0));
  for (let row = 0; row < 3; row++) for (let col = 0; col < BOARD_SIZE; col++) if ((row + col) % 2 === 1) board[row][col] = 2;
  for (let row = 5; row < 8; row++) for (let col = 0; col < BOARD_SIZE; col++) if ((row + col) % 2 === 1) board[row][col] = 1;
  return board;
}
function getPieceColor(piece) { if (piece === 1 || piece === 3) return 'white'; if (piece === 2 || piece === 4) return 'black'; return null; }
function isKing(piece) { return piece === 3 || piece === 4; }
function getMoveDirs(piece) { if (piece === 1) return [[-1,-1],[-1,1]]; if (piece === 2) return [[1,-1],[1,1]]; if (piece === 3 || piece === 4) return [[-1,-1],[-1,1],[1,-1],[1,1]]; return []; }
function isValidCoord(row, col) { return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE; }
function getAllMoves(board, turn) { const moves = []; for (let r=0;r<BOARD_SIZE;r++) for (let c=0;c<BOARD_SIZE;c++) { const piece = board[r][c]; if (piece !== 0 && getPieceColor(piece) === turn) { const dirs = getMoveDirs(piece); for (const [dr,dc] of dirs) { const nr = r+dr, nc = c+dc; if (isValidCoord(nr,nc) && board[nr][nc] === 0) moves.push({ from: [r,c], to: [nr,nc], capture: false }); const jr = r+dr*2, jc = c+dc*2, mr = r+dr, mc = c+dc; if (isValidCoord(jr,jc) && board[jr][jc] === 0 && board[mr][mc] !== 0 && getPieceColor(board[mr][mc]) !== turn) moves.push({ from: [r,c], to: [jr,jc], capture: true, captured: [mr,mc] }); } } } return moves; }
function isValidMove(board, fromRow, fromCol, toRow, toCol, turn) { const piece = board[fromRow][fromCol]; if (piece === 0 || getPieceColor(piece) !== turn) return false; const dirs = getMoveDirs(piece); for (const [dr,dc] of dirs) if (fromRow+dr === toRow && fromCol+dc === toCol && board[toRow][toCol] === 0) return true; for (const [dr,dc] of dirs) { const mr = fromRow+dr, mc = fromCol+dc, jr = fromRow+dr*2, jc = fromCol+dc*2; if (jr === toRow && jc === toCol && isValidCoord(jr,jc) && board[jr][jc] === 0 && board[mr][mc] !== 0 && getPieceColor(board[mr][mc]) !== turn) return true; } return false; }
function applyMove(board, fromRow, fromCol, toRow, toCol) { const newBoard = board.map(row => [...row]); const piece = newBoard[fromRow][fromCol]; newBoard[toRow][toCol] = piece; newBoard[fromRow][fromCol] = 0; let captured = null; if (Math.abs(toRow - fromRow) === 2) { const midRow = (fromRow + toRow)/2, midCol = (fromCol + toCol)/2; captured = newBoard[midRow][midCol]; newBoard[midRow][midCol] = 0; } let promoted = false; if ((piece === 1 && toRow === 0) || (piece === 2 && toRow === BOARD_SIZE-1)) { newBoard[toRow][toCol] = piece === 1 ? 3 : 4; promoted = true; } return { newBoard, captured, promoted }; }
function hasCapture(board, turn) { return getAllMoves(board, turn).some(m => m.capture); }
function checkWinner(board) { let whiteExists=false, blackExists=false; for(let r=0;r<BOARD_SIZE;r++) for(let c=0;c<BOARD_SIZE;c++) { const p = board[r][c]; if(p===1||p===3) whiteExists=true; if(p===2||p===4) blackExists=true; } if(!whiteExists) return 'black'; if(!blackExists) return 'white'; if(getAllMoves(board,'white').length===0) return 'black'; if(getAllMoves(board,'black').length===0) return 'white'; return null; }

app.post('/create-room', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    const code = Math.random().toString(36).substring(2,8).toUpperCase();
    const { data: room, error: roomError } = await supabase.from('rooms').insert([{ code, status: 'waiting' }]).select();
    if (roomError) throw roomError;
    await supabase.from('players').insert([{ room_id: room[0].id, username, role: 'white' }]);
    const initialBoard = initBoard();
    await supabase.from('games').insert([{ room_id: room[0].id, board_state: initialBoard, current_turn: 'white' }]);
    res.json({ success: true, roomCode: code });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/join-room', verifyToken, async (req, res) => {
  try {
    const { roomCode } = req.body;
    const username = req.user.username;
    const { data: room, error: roomError } = await supabase.from('rooms').select('id, status').eq('code', roomCode).single();
    if (roomError || !room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.status !== 'waiting') return res.status(400).json({ success: false, error: 'Room is not available' });
    const { data: existingPlayer } = await supabase.from('players').select('id').eq('room_id', room.id).eq('username', username).single();
    if (existingPlayer) return res.status(400).json({ success: false, error: 'Already in this room' });
    await supabase.from('players').insert([{ room_id: room.id, username, role: 'black' }]);
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', room.id);
    res.json({ success: true, roomCode });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/move', verifyToken, async (req, res) => {
  try {
    const { roomCode, from, to } = req.body;
    const username = req.user.username;
    const [fromRow, fromCol] = from, [toRow, toCol] = to;
    const { data: room, error: roomError } = await supabase.from('rooms').select('id, status').eq('code', roomCode).single();
    if (roomError || !room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.status !== 'playing') return res.status(400).json({ success: false, error: 'Game not started' });
    const { data: players } = await supabase.from('players').select('username, role').eq('room_id', room.id);
    const player = players.find(p => p.username === username);
    if (!player) return res.status(403).json({ success: false, error: 'You are not in this game' });
    const { data: game, error: gameError } = await supabase.from('games').select('board_state, current_turn, winner').eq('room_id', room.id).single();
    if (gameError) throw gameError;
    if (game.winner) return res.status(400).json({ success: false, error: 'Game already finished' });
    if (game.current_turn !== player.role) return res.status(403).json({ success: false, error: 'Not your turn' });
    const board = game.board_state;
    if (!isValidMove(board, fromRow, fromCol, toRow, toCol, player.role)) return res.status(400).json({ success: false, error: 'Invalid move' });
    if (hasCapture(board, player.role) && Math.abs(toRow - fromRow) !== 2) return res.status(400).json({ success: false, error: 'You must capture an opponent piece' });
    const { newBoard, captured } = applyMove(board, fromRow, fromCol, toRow, toCol);
    let nextTurn = player.role === 'white' ? 'black' : 'white';
    if (captured !== null) {
      const movesAfter = getAllMoves(newBoard, player.role);
      const canCaptureAgain = movesAfter.some(m => m.from[0] === toRow && m.from[1] === toCol && m.capture);
      if (canCaptureAgain) nextTurn = player.role;
    }
    const winner = checkWinner(newBoard);
    await supabase.from('games').update({ board_state: newBoard, current_turn: nextTurn, winner, updated_at: new Date().toISOString() }).eq('room_id', room.id);
    io.to(`game_${roomCode}`).emit('game-update', { board: newBoard, currentTurn: nextTurn, winner, lastMove: { from, to, player: player.role } });
    res.json({ success: true, board: newBoard, currentTurn: nextTurn, winner });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/game/:roomCode', verifyToken, async (req, res) => {
  try {
    const { roomCode } = req.params;
    const username = req.user.username;
    const { data: room, error: roomError } = await supabase.from('rooms').select('id, status').eq('code', roomCode).single();
    if (roomError || !room) return res.status(404).json({ success: false, error: 'Room not found' });
    const { data: players } = await supabase.from('players').select('username, role').eq('room_id', room.id);
    const { data: game, error: gameError } = await supabase.from('games').select('board_state, current_turn, winner').eq('room_id', room.id).single();
    if (gameError) throw gameError;
    const player = players.find(p => p.username === username);
    res.json({ success: true, roomCode, status: room.status, board: game.board_state, currentTurn: game.current_turn, winner: game.winner, players, yourRole: player ? player.role : null });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== UPTIME & HEALTH =====
if (config.autoUptime?.enable || isRender) {
  const myUrl = renderExternalUrl || config.autoUptime?.url || `http://localhost:${port}`;
  app.get("/uptime", (req, res) => res.status(200).json({ status: "OK", timestamp: Date.now(), uptime: process.uptime(), platform: "Render", monitor: "UptimeRobot" }));
  app.get("/health", (req, res) => res.json({ status: "healthy", version: require('./package.json').version, node: process.version, memory: process.memoryUsage(), uptime: process.uptime(), environment: process.env.NODE_ENV || "development", platform: process.platform, render: isRender, endpoints: { uptime: `${myUrl}/uptime`, api: `${myUrl}/api/command` } }));
  if (isRender) setInterval(() => axios.get(`${myUrl}/uptime`).catch(()=>{}), 4*60*1000);
}

// ===== COMMAND LOADER =====
const COMMANDS_DIR = path.join(__dirname, "commands");
const PREFIX = config.prefix || "!";
const commands = {};
function loadCommands() {
  Object.keys(require.cache).forEach(key => { if (key.startsWith(COMMANDS_DIR)) delete require.cache[key]; });
  const commandFiles = fs.readdirSync(COMMANDS_DIR).filter(file => file.endsWith(".js"));
  commandFiles.forEach(file => {
    try {
      const cmd = require(path.join(COMMANDS_DIR, file));
      if (cmd.config?.name) { commands[cmd.config.name] = cmd; if (Array.isArray(cmd.config.aliases)) cmd.config.aliases.forEach(alias => commands[alias] = cmd); console.log(`✅ Loaded command: ${PREFIX}${cmd.config.name}`); }
    } catch (err) { console.error(`❌ Failed to load ${file}:`, err); }
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

// ===== SAVE BOT RESPONSE (with green dot) =====
async function saveBotResponseToSupabase(content, originalCommand, commandType = 'AI') {
  try {
    const insertData = { content: content || `${commandType} Response`, username: commandType === 'AI' ? 'AI' : 'Bot', image_url: '', reply_to: originalCommand || '', created_at: new Date().toISOString() };
    const { data, error } = await supabase.from('chatter').insert([insertData]).select();
    if (error) throw error;
    const savedMsg = data[0];
    // ✅ add green dot status
    io.emit('new-message', { ...savedMsg, user_status: 'online' });
    return data;
  } catch (error) { console.error(`❌ Error saving ${commandType} response:`, error); throw error; }
}

function extractImageUrlFromMessage(message) {
  if (!message) return null;
  if (message.image_url && typeof message.image_url === 'string' && message.image_url.trim() !== '') return message.image_url;
  if (message.attachments) {
    try { const atts = typeof message.attachments === 'string' ? JSON.parse(message.attachments) : message.attachments; if (Array.isArray(atts)) { const img = atts.find(a => a.type === 'photo' || a.type === 'image' || (a.url && /\.(jpg|jpeg|png|gif|webp)/i.test(a.url))); if (img && img.url) return img.url; } } catch(e) {}
  }
  if (message.content) { const urlMatch = message.content.match(/https?:\/\/[^\s]+/i); if (urlMatch) return urlMatch[0]; }
  return null;
}

// ===== MODIFIED /api/command WITH DUPLICATE PREVENTION =====
app.post("/api/command", async (req, res) => {
  try {
    let { message, source = 'main-chat', reply_to, reply_image_url } = req.body;
    const dedupKey = `${message}|${source}|${Math.floor(Date.now() / 1000)}`;
    if (isDuplicate(dedupKey)) { console.log('⚠️ Duplicate command ignored'); return res.end(); }
    if (!message) return res.status(400).json({ reply: "❌ Message is required" });
    if (source === 'private-ai' && message.trim().startsWith('-prompt')) {
      let imageUrl = null; const parts = message.trim().split(/\s+/); if (parts.length > 1) imageUrl = parts[1]; if (!imageUrl && reply_image_url) imageUrl = reply_image_url; if (!imageUrl) return res.json({ reply: "❌ Please provide an image URL after -prompt or attach an image." }); try { const prompt = await handlePromptCommand(imageUrl, null); return res.json({ reply: prompt }); } catch (error) { return res.json({ reply: `❌ ${error.message}` }); }
    }
    if (source === 'private-ai' && !message.startsWith(PREFIX) && message.trim().startsWith('-')) { const trimmed = message.trim(); const parts = trimmed.split(/\s+/); const dashCmd = parts[0].substring(1); if (commands[dashCmd]) { const rest = parts.slice(1).join(' '); message = `${PREFIX}${dashCmd}${rest ? ' ' + rest : ''}`; } else message = `${PREFIX}ai ${trimmed}`; }
    else if (source === 'private-ai' && !message.startsWith(PREFIX)) { const trimmed = message.trim().toLowerCase(); const firstWord = trimmed.split(' ')[0]; const commandWords = ['ai', 'help', 'ping', 'prefix', 'ask', 'chat']; if (commandWords.includes(firstWord)) message = PREFIX + message; else message = PREFIX + 'ai ' + message; }
    if (message.trim().toLowerCase() === "prefix") return res.json({ reply: `🔹 My prefix is: ${PREFIX}` });
    const cmd = handleCommand(message);
    if (!cmd) return res.end();
    let finalReply = null, responder = null;
    if (cmd.commandName === "ai") {
      responder = 'AI';
      try { const response = await axios.get(`https://yau-cener-gpt4-api.vercel.app/ai?prompt=${encodeURIComponent(cmd.text)}&cb=${Date.now()}`, { timeout: 15000 }); const data = response.data; finalReply = data.response || data.message || data.data || (typeof data === "string" ? data : "⚠️ Unknown AI response"); } catch (err) { finalReply = `❌ AI Error: ${err.message}`; }
    } else {
      responder = 'Bot';
      const command = commands[cmd.commandName];
      if (!command) finalReply = "❌ Command not found";
      else {
        const replies = []; const event = { body: cmd.text }; let imageUrl = null;
        if (reply_image_url) imageUrl = reply_image_url;
        else if (reply_to) { const { data, error } = await supabase.from("chatter").select("*").eq("id", reply_to).single(); if (!error && data) imageUrl = extractImageUrlFromMessage(data); }
        if (imageUrl) event.messageReply = { messageID: reply_to || null, body: '', attachments: [{ type: "photo", url: imageUrl }], image_url: imageUrl };
        await command.onStart({ api: { sendMessage: (msg) => replies.push(typeof msg === "string" ? msg : JSON.stringify(msg)), supabase, io }, event, args: cmd.args, message: { reply: (content) => replies.push(content) } });
        finalReply = replies.join("\n") || "❌ No response";
      }
    }
    if (finalReply && source === 'main-chat') { try { await saveBotResponseToSupabase(finalReply, cmd.commandName, responder); } catch (e) { console.log("❌ Save error"); } }
    return res.json({ reply: finalReply });
  } catch (error) { console.error("❌ Server Error:", error); return res.status(500).json({ reply: "❌ Server error: " + error.message }); }
});

// ===== SOCKET.IO HANDLERS =====
io.on('connection', (socket) => {
  console.log('🔌 User connected via polling:', socket.id);
  socket.on('join-user-room', (username) => { if (username) socket.join(username); });
  socket.on('leave-user-room', (username) => { if (username) socket.leave(username); });
  socket.on('request-messages', async () => { const { data, error } = await supabase.from('chatter').select('*').order('created_at', { ascending: false }).limit(50); if (!error && data) socket.emit('chat-messages', data.reverse()); });
  socket.on('user-online', (username) => {
    if (username && !PERMANENT_ONLINE_USERS.includes(username)) {
      onlineUsers.set(username, { socketId: socket.id, username, lastSeen: Date.now(), isOnline: true });
      updateUserStatusOnline(username);
      io.emit('user-status-change', { username, status: 'online', lastSeen: null, onlineUsers: Array.from(onlineUsers.keys()) });
    }
  });
  socket.on('user-away', (username) => { if (username && onlineUsers.has(username) && !PERMANENT_ONLINE_USERS.includes(username)) { const userData = onlineUsers.get(username); userData.lastSeen = Date.now(); userData.isOnline = false; io.emit('user-status-change', { username, status: 'away', lastSeen: new Date(userData.lastSeen).toISOString(), onlineUsers: Array.from(onlineUsers.keys()) }); } });
  socket.on('user-offline', (username) => { if (username && !PERMANENT_ONLINE_USERS.includes(username)) removeUserFromOnlineList(username); });
  socket.on('typing-start', (data) => socket.broadcast.emit('user-typing', { username: data.username, isTyping: true }));
  socket.on('typing-stop', (data) => socket.broadcast.emit('user-typing', { username: data.username, isTyping: false }));
  socket.on('send-private-message', async (data) => { try { const response = await axios.post('http://localhost:3000/api/ai/private', { message: data.content }); if (response.data.reply) socket.emit('new-private-message', { content: response.data.reply, username: 'Private AI', sender_username: 'Private AI', receiver_username: data.username, created_at: new Date().toISOString() }); } catch (error) { socket.emit('new-private-message', { content: "Error: Could not process your private message", username: 'Private AI', sender_username: 'Private AI', receiver_username: data.username, created_at: new Date().toISOString() }); } });
  socket.on('join-private-chat', (data) => { const roomName = getPrivateChatRoomName(data.username, data.otherUser); socket.join(roomName); });
  socket.on('leave-private-chat', (data) => { const roomName = getPrivateChatRoomName(data.username, data.otherUser); socket.leave(roomName); });
  socket.on('send-private-message-socket', async (data) => {
    try { const { sender_username, receiver_username, content, image_url } = data; const messageId = `socket_msg_${Date.now()}_${Math.random().toString(36).substr(2,9)}`; const insertData = { sender_username: sender_username.trim(), receiver_username: receiver_username.trim(), content: content ? content.trim() : '', image_url: image_url || '', read: false, created_at: new Date().toISOString(), message_id: messageId }; const { data: messageData, error } = await supabase.from('private_messages').insert([insertData]).select(); if (error) throw error; const responseData = { ...messageData[0], custom_message_id: messageId }; io.to(receiver_username).emit('new-private-message', responseData); socket.emit('private-message-confirmation', { ...responseData, status: 'sent', message_id: messageId }); } catch (error) { socket.emit('private-message-error', { error: 'Failed to send private message' }); }
  });
  socket.on('private-message-typing-start', (data) => { const roomName = getPrivateChatRoomName(data.sender, data.receiver); socket.to(roomName).emit('private-typing-indicator', { username: data.sender, isTyping: true }); });
  socket.on('private-message-typing-stop', (data) => { const roomName = getPrivateChatRoomName(data.sender, data.receiver); socket.to(roomName).emit('private-typing-indicator', { username: data.sender, isTyping: false }); });
  socket.on('join-game-room', (roomCode) => { if (roomCode) socket.join(`game_${roomCode}`); });
  socket.on('leave-game-room', (roomCode) => { if (roomCode) socket.leave(`game_${roomCode}`); });
  socket.on('disconnect', (reason) => {
    let foundUsername = null;
    for (let [username, data] of onlineUsers.entries()) {
      if (data.socketId === socket.id && !PERMANENT_ONLINE_USERS.includes(username)) { foundUsername = username; data.lastSeen = Date.now(); data.isOnline = false; updateUserLastActive(username); break; }
    }
    if (foundUsername) { io.emit('user-status-change', { username: foundUsername, status: 'offline', lastSeen: new Date().toISOString(), onlineUsers: Array.from(onlineUsers.keys()) }); }
  });
});

function getPrivateChatRoomName(user1, user2) { const users = [user1, user2].sort(); return `private_chat_${users[0]}_${users[1]}`; }
async function updateUserLastActive(username) { await supabase.from('user_profiles').update({ last_active: new Date().toISOString(), status: 'offline' }).eq('username', username); }
async function updateUserStatusOnline(username) { await supabase.from('user_profiles').update({ status: 'online', last_active: new Date().toISOString() }).eq('username', username); }
function removeUserFromOnlineList(username) { if (onlineUsers.has(username) && !PERMANENT_ONLINE_USERS.includes(username)) { onlineUsers.delete(username); io.emit('user-status-change', { username, status: 'offline', onlineUsers: Array.from(onlineUsers.keys()) }); } }

// Periodic cleanup (skip bots)
setInterval(() => {
  const now = Date.now(); const removedUsers = [];
  for (let [username, data] of onlineUsers.entries()) {
    if (PERMANENT_ONLINE_USERS.includes(username)) { data.lastSeen = now; data.isOnline = true; continue; }
    if (now - data.lastSeen > onlineStatusTimeout) { updateUserLastActive(username); onlineUsers.delete(username); removedUsers.push({ username, lastSeen: data.lastSeen }); }
  }
  if (removedUsers.length) { const onlineUsersArray = Array.from(onlineUsers.keys()); removedUsers.forEach(user => io.emit('user-status-change', { username: user.username, status: 'offline', lastSeen: new Date(user.lastSeen).toISOString(), onlineUsers: onlineUsersArray })); }
}, 60000);

// ===== ADMIN ENDPOINTS =====
app.post('/api/admin/block/:username', verifyToken, async (req, res) => {
  try { const adminUsername = req.user.username; const targetUsername = req.params.username; if (adminUsername !== 'Admin0') return res.status(403).json({ success: false, error: 'Only Admin0 can block users.' }); const { data: user, error: findError } = await supabase.from('users').select('id').ilike('username', targetUsername).limit(1).single(); if (findError || !user) return res.status(404).json({ success: false, error: 'User not found.' }); await supabase.from('users').update({ banned: true }).eq('id', user.id); onlineUsers.delete(targetUsername); io.emit('user-status-change', { username: targetUsername, status: 'offline', lastSeen: new Date().toISOString() }); res.json({ success: true, message: `User @${targetUsername} has been blocked.` }); } catch (error) { res.status(500).json({ success: false, error: 'Internal server error.' }); }
});
app.post('/api/admin/clear-all-messages', verifyToken, async (req, res) => {
  try { if (req.user.username !== 'Admin0') return res.status(403).json({ success: false, error: 'Only Admin0 can clear all messages.' }); await supabase.from('chatter').delete().neq('id', 0); io.emit('clear-all-messages', { message: 'All public messages have been cleared by Admin0.' }); res.json({ success: true, message: 'All public messages cleared successfully.' }); } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// ===== ENSURE BOT USERS EXIST IN DATABASE (with online status) =====
async function ensureBotUsersExist() {
  for (const username of PERMANENT_ONLINE_USERS) {
    const { data: existingUser } = await supabase.from('users').select('id').eq('username', username).limit(1);
    if (!existingUser || existingUser.length === 0) {
      await supabase.from('users').insert([{ username, password_hash: hashPassword('bot-placeholder'), auth_provider: 'local', created_at: new Date().toISOString(), last_login: new Date().toISOString(), is_active: true, avatar_url: `https://i.pravatar.cc/150?u=${username}`, banned: false }]);
      console.log(`✅ Created user entry for bot: ${username}`);
    }
    const { data: existingProfile } = await supabase.from('user_profiles').select('id').eq('username', username).limit(1);
    if (!existingProfile || existingProfile.length === 0) {
      const { data: user } = await supabase.from('users').select('id').eq('username', username).single();
      if (user) await supabase.from('user_profiles').insert([{ user_id: user.id, username, display_name: username, avatar_url: `https://i.pravatar.cc/150?u=${username}`, status: 'online', last_active: null }]);
      console.log(`✅ Created profile for bot: ${username} with status online`);
    } else {
      await supabase.from('user_profiles').update({ status: 'online', last_active: null }).eq('username', username);
      console.log(`✅ Updated profile for bot: ${username} to online and cleared last_active`);
    }
  }
}
addPermanentOnlineUsers();
ensureBotUsersExist();
setInterval(() => { addPermanentOnlineUsers(); ensureBotUsersExist(); }, 5 * 60 * 1000);

// ===== START SERVER =====
server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🤖 PERMANENT ONLINE USERS: ${PERMANENT_ONLINE_USERS.join(', ')}`);
  console.log(`✅ Duplicate response prevention ACTIVE`);
  console.log(`✅ Green dot for AI/Bot replies ACTIVE`);
  console.log(`🔐 All other endpoints (auth, private messages, posts, checkers) are intact.`);
});

// Error handlers
app.use((err, req, res, next) => { console.error('❌ Global Error:', err); res.status(err.status || 500).json({ success: false, error: err.message }); });
app.use((req, res) => { if (req.method === 'GET' && req.accepts('html')) return res.sendFile(path.join(__dirname, 'public', 'index.html')); res.status(404).json({ success: false, error: 'Endpoint not found' }); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('unhandledRejection', (err) => console.error(err));
process.on('uncaughtException', (err) => { console.error(err); process.exit(1); });

module.exports = { app, server, io, supabase };
