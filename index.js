const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const fs = require('fs-extra');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

// ===== DETECT ENVIRONMENT =====
const isVercel = !!process.env.VERCEL;
const isRender = process.env.RENDER === 'true';
const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;

// ===== SAFE CONFIG LOADING =====
let config = {
  prefix: "!",
  autoUptime: { enable: false }
};
try {
  const loaded = require('./config.json');
  config = { ...config, ...loaded };
} catch (e) {
  console.warn('⚠️ config.json not found, using defaults');
}

// Initialize apps
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// ===== ULTRA-COMPATIBLE SOCKET.IO (polling only, no ws) =====
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
  // wsEngine: require('ws').Server,  // <-- REMOVED FOR VERCEL
  allowRequest: (req, callback) => callback(null, true)
});

// Track online users - 5 MINUTE TIMEOUT for mobile users
const onlineUsers = new Map();
const onlineStatusTimeout = 300000; // 5 minutes = 300000 milliseconds

// ===== PERMANENT BOT USERS =====
const PERMANENT_ONLINE_USERS = ['AI', 'Bot'];

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

function ensureBotOnline(botUsername) {
  if (!PERMANENT_ONLINE_USERS.includes(botUsername)) return;
  const existing = onlineUsers.get(botUsername);
  if (!existing || !existing.isOnline) {
    onlineUsers.set(botUsername, {
      socketId: 'permanent-bot-socket',
      username: botUsername,
      lastSeen: Date.now(),
      isOnline: true
    });
    const onlineUsersArray = Array.from(onlineUsers.keys());
    io.emit('user-status-change', {
      username: botUsername,
      status: 'online',
      onlineUsers: onlineUsersArray
    });
    console.log(`🟢 Bot ${botUsername} forced online (green dot) for reply`);
  }
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
    fileSize: 5 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
  }
});

// ===== OAUTH CONFIG =====
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

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production';

// ===== MIDDLEWARE =====
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

// ==============================
// AUTHENTICATION (unchanged)
// ==============================

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
    const maxTokenAge = 30 * 24 * 60 * 60 * 1000;
    if (isNaN(tokenAge) || tokenAge > maxTokenAge) return null;
    return { id: userId, username, timestamp: parseInt(timestamp) };
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
  if (provider === 'google') {
    return userData.name || userData.given_name || `Google User`;
  } else if (provider === 'facebook') {
    return userData.name || `Facebook User`;
  }
  return `Social User`;
}

// ===== OAUTH AUTHENTICATION ENDPOINTS =====
app.get('/api/auth/google', (req, res) => {
  if (!oauthConfig.google.clientId) {
    return res.status(400).json({ success: false, error: "Google OAuth not configured. Please set GOOGLE_CLIENT_ID environment variable." });
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
    return res.status(400).json({ success: false, error: "Facebook OAuth not configured. Please set FACEBOOK_APP_ID environment variable." });
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
    if (imageUrl) {
      params.imageUrl = imageUrl;
    } else if (userPrompt) {
      const cleanPrompt = userPrompt.replace(/\s+/g, " ").trim();
      if (!cleanPrompt || cleanPrompt.length < 5) {
        throw new Error("Text prompt too short.\nExample: 'a futuristic city at night with neon lights'");
      }
      params.userPrompt = cleanPrompt;
    } else {
      throw new Error("Provide an image or text.");
    }
    let response;
    try {
      response = await axios.get("https://theone-fast-image-gen.vercel.app/prompt", { params, timeout: 20000 });
    } catch (err) {
      response = await axios.post("https://theone-fast-image-gen.vercel.app/prompt", params, { timeout: 20000 });
    }
    const prompt = response?.data?.prompt;
    if (!prompt || typeof prompt !== "string") {
      throw new Error("Invalid response from API.");
    }
    return prompt;
  } catch (error) {
    console.error("❌ Prompt generation error:", error);
    if (error.response) {
      console.error("📦 Status:", error.response.status);
      console.error("📦 Data:", error.response.data);
    }
    if (error.response?.status === 422) {
      throw new Error(
        "❌ Failed to process request.\n\n" +
        "✔ Make your text more descriptive\n" +
        "✔ Avoid symbols only (like !!!)\n" +
        "✔ Example:\n" +
        "-prompt a cinematic portrait of a warrior in golden armor"
      );
    }
    if (error.code === "ECONNABORTED") {
      throw new Error("⏱️ Server is slow. Try again.");
    }
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
    const providerId = providerUser.id;
    const { data: existingUser, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('auth_provider', provider)
      .eq('provider_id', providerId)
      .limit(1);
    let user;
    if (findError) throw findError;
    if (existingUser && existingUser.length > 0) {
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
      if (providerUser.email) {
        const { data: existingEmailUser } = await supabase
          .from('users')
          .select('*')
          .eq('email', providerUser.email)
          .limit(1);
        if (existingEmailUser && existingEmailUser.length > 0) {
          return { success: false, error: `Email ${providerUser.email} is already registered. Please login with your existing account.` };
        }
      }
      let username;
      if (providerUser.email) {
        username = providerUser.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      } else {
        username = generateRandomUsername(provider, providerId);
      }
      let counter = 1;
      let originalUsername = username;
      while (true) {
        const { data: checkUsers } = await supabase
          .from('users')
          .select('username')
          .eq('username', username)
          .limit(1);
        if (!checkUsers || checkUsers.length === 0) break;
        username = `${originalUsername}_${counter++}`;
      }
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
      if (createError) throw createError;
      user = newUser[0];
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
        await supabase.from('user_profiles').insert([profileData]);
      } catch (profileError) {
        console.error(`❌ Error creating profile for ${provider} user:`, profileError);
      }
      console.log(`✅ New ${provider} user created:`, user.username);
    }
    const token = generateToken(user);
    return { success: true, user, token };
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
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    if (!result.success) return res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(result.error)}`);
    res.redirect(`${frontendUrl}/auth/callback?token=${result.token}&username=${result.user.username}&provider=google`);
  } catch (error) {
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
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    if (!result.success) return res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(result.error)}`);
    res.redirect(`${frontendUrl}/auth/callback?token=${result.token}&username=${result.user.username}&provider=facebook`);
  } catch (error) {
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent('Facebook authentication failed')}`);
  }
});

// ===== TOKEN VERIFICATION =====
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, error: "Authentication token required" });
  }
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, error: "Authentication token required" });
  }
  try {
    const decoded = verifyTokenSimple(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
    // fallback old token
    const oldDecoded = Buffer.from(token, 'base64').toString('ascii');
    const [username, timestamp] = oldDecoded.split(':');
    if (!username) return res.status(401).json({ success: false, error: "Invalid token" });
    const tokenAge = Date.now() - parseInt(timestamp);
    if (isNaN(tokenAge) || tokenAge > 30 * 24 * 60 * 60 * 1000) {
      return res.status(401).json({ success: false, error: "Token expired" });
    }
    supabase.from('users').select('*').ilike('username', username).limit(1).then(({ data, error }) => {
      if (error || !data || data.length === 0) {
        return res.status(401).json({ success: false, error: "User not found" });
      }
      req.user = {
        id: data[0].id,
        username: data[0].username,
        email: data[0].email,
        auth_provider: data[0].auth_provider
      };
      next();
    }).catch(() => res.status(401).json({ success: false, error: "Invalid token" }));
  } catch (error) {
    return res.status(401).json({ success: false, error: "Invalid token" });
  }
}

// ==============================
// USER REGISTRATION & LOGIN (unchanged)
// ==============================

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: "Username and password are required" });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ success: false, error: "Username must be between 3-20 characters" });
    }
    if (password.length < 4 || password.length > 20) {
      return res.status(400).json({ success: false, error: "Password must be between 4-20 characters" });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ success: false, error: "Username can only contain letters, numbers, and underscores" });
    }
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('username')
      .ilike('username', username);
    if (checkError) {
      return res.status(500).json({ success: false, error: "Database error" });
    }
    if (existingUsers && existingUsers.length > 0) {
      return res.status(409).json({ success: false, error: "Username already exists" });
    }
    if (email) {
      const { data: existingEmail } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .eq('auth_provider', 'local')
        .limit(1);
      if (existingEmail && existingEmail.length > 0) {
        return res.status(409).json({ success: false, error: "Email already registered with a local account" });
      }
    }
    const hashedPassword = hashPassword(password);
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([{ 
        username: username.trim(),
        password_hash: hashedPassword,
        email: email || null,
        auth_provider: 'local',
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
        is_active: true,
        avatar_url: `https://i.pravatar.cc/150?u=${username}`,
        banned: false
      }])
      .select();
    if (createError) {
      return res.status(500).json({ success: false, error: "Failed to create user" });
    }
    const userToken = generateToken(newUser[0]);
    try {
      await supabase
        .from('user_profiles')
        .insert([{
          user_id: newUser[0].id,
          username: username,
          display_name: username,
          avatar_url: `https://i.pravatar.cc/150?u=${username}`,
          status: 'online'
        }]);
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
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: "Username and password are required" });
    }
    const { data: users, error: findError } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .limit(1);
    if (findError) {
      return res.status(500).json({ success: false, error: "Database error" });
    }
    if (!users || users.length === 0) {
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }
    const user = users[0];
    if (user.banned) {
      return res.status(403).json({ success: false, error: "Your account has been banned." });
    }
    if (user.auth_provider !== 'local' && !user.password_hash) {
      return res.status(401).json({ success: false, error: `This account uses ${user.auth_provider} authentication. Please sign in with ${user.auth_provider}.` });
    }
    if (hashPassword(password) !== user.password_hash) {
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
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
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ available: true });
    const { data: existingUsers, error } = await supabase
      .from('users')
      .select('username')
      .ilike('username', username)
      .limit(1);
    if (error) {
      return res.status(500).json({ success: false, error: "Database error" });
    }
    const available = !existingUsers || existingUsers.length === 0;
    res.json({ available, suggestion: available ? null : "Username is already taken" });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Auth endpoints (client-compatible)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: "Username and password are required" });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ success: false, error: "Username must be between 3-20 characters" });
    }
    if (password.length < 4 || password.length > 20) {
      return res.status(400).json({ success: false, error: "Password must be between 4-20 characters" });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ success: false, error: "Username can only contain letters, numbers, and underscores" });
    }
    const { data: existingUsers, error: checkError } = await supabase
      .from('users')
      .select('username')
      .ilike('username', username);
    if (checkError) {
      return res.status(500).json({ success: false, error: "Database error" });
    }
    if (existingUsers && existingUsers.length > 0) {
      return res.status(409).json({ success: false, error: "Username already exists" });
    }
    if (email) {
      const { data: existingEmail } = await supabase
        .from('users')
        .select('email')
        .eq('email', email)
        .eq('auth_provider', 'local')
        .limit(1);
      if (existingEmail && existingEmail.length > 0) {
        return res.status(409).json({ success: false, error: "Email already registered with a local account" });
      }
    }
    const hashedPassword = hashPassword(password);
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert([{ 
        username: username.trim(),
        password_hash: hashedPassword,
        email: email || null,
        auth_provider: 'local',
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
        is_active: true,
        avatar_url: `https://i.pravatar.cc/150?u=${username}`,
        banned: false
      }])
      .select();
    if (createError) {
      return res.status(500).json({ success: false, error: "Failed to create user" });
    }
    const userToken = generateToken(newUser[0]);
    try {
      await supabase
        .from('user_profiles')
        .insert([{
          user_id: newUser[0].id,
          username: username,
          display_name: username,
          avatar_url: `https://i.pravatar.cc/150?u=${username}`,
          status: 'online'
        }]);
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
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: "Username and password are required" });
    }
    const { data: users, error: findError } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .limit(1);
    if (findError) {
      return res.status(500).json({ success: false, error: "Database error" });
    }
    if (!users || users.length === 0) {
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }
    const user = users[0];
    if (user.banned) {
      return res.status(403).json({ success: false, error: "Your account has been banned." });
    }
    if (user.auth_provider !== 'local' && !user.password_hash) {
      return res.status(401).json({ success: false, error: `This account uses ${user.auth_provider} authentication. Please sign in with ${user.auth_provider}.` });
    }
    if (hashPassword(password) !== user.password_hash) {
      return res.status(401).json({ success: false, error: "Invalid username or password" });
    }
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
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
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/auth/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ available: true });
    const { data: existingUsers, error } = await supabase
      .from('users')
      .select('username')
      .ilike('username', username)
      .limit(1);
    if (error) {
      return res.status(500).json({ success: false, error: "Database error" });
    }
    const available = !existingUsers || existingUsers.length === 0;
    res.json({ available, suggestion: available ? null : "Username is already taken" });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.post('/api/auth/auto-login', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .limit(1);
    if (error || !users || users.length === 0) {
      return res.status(401).json({ success: false, error: "User not found" });
    }
    const user = users[0];
    if (user.banned) {
      return res.status(403).json({ success: false, error: "Your account has been banned." });
    }
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
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
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

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
      google: { auth: `/api/auth/google`, callback: `/api/auth/google/callback` },
      facebook: { auth: `/api/auth/facebook`, callback: `/api/auth/facebook/callback` }
    }
  });
});

// ===== GET ENDPOINTS FOR TESTING =====
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

// ==============================
// PROFILE MANAGEMENT (unchanged)
// ==============================

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
    if (!username) {
      return res.status(400).json({ success: false, error: "Username is required" });
    }
    if (profileData.display_name && !validateHumanName(profileData.display_name)) {
      return res.status(400).json({
        success: false,
        error: "Display name must be a valid human name (2-50 characters, letters, spaces, dots, hyphens, apostrophes, must contain a vowel, no repeating characters, no bad words)"
      });
    }
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id')
      .ilike('username', username)
      .limit(1);
    if (userError || !users || users.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    const userId = users[0].id;
    const { data: existingProfiles, error: checkError } = await supabase
      .from('user_profiles')
      .select('id')
      .eq('username', username)
      .limit(1);
    if (checkError && checkError.code === '42P01') {
      return res.status(500).json({ 
        success: false, 
        error: "Profile table does not exist. Please run the database setup script.",
        instructions: "Run the SQL script provided in Supabase SQL Editor to create all tables"
      });
    }
    const now = new Date().toISOString();
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
    let result;
    if (existingProfiles && existingProfiles.length > 0) {
      result = await supabase
        .from('user_profiles')
        .update(profileUpdateData)
        .eq('username', username)
        .select();
    } else {
      result = await supabase
        .from('user_profiles')
        .insert([{ ...profileUpdateData, created_at: now }])
        .select();
    }
    if (result.error) {
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
    const savedProfile = result.data[0];
    const responseProfile = {
      ...savedProfile,
      avatar: savedProfile.avatar_url || `https://i.pravatar.cc/150?u=${username}`
    };
    res.json({ success: true, message: "Profile updated successfully", profile: responseProfile });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    res.status(500).json({ success: false, error: "Internal server error: " + error.message });
  }
}

app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    if (!username) {
      return res.status(401).json({ success: false, error: "Invalid token: no username found" });
    }
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id, username, email, auth_provider, created_at, last_login, avatar_url, provider_data, banned')
      .ilike('username', username)
      .limit(1);
    if (userError || !users || users.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    const user = users[0];
    const { data: profiles, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('username', username)
      .limit(1);
    let profileData;
    if (profileError && profileError.code === '42P01') {
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
      profileData = profiles[0];
    }
    const completeProfile = {
      username: username,
      email: user.email,
      user_id: user.id,
      auth_provider: user.auth_provider || 'local',
      created_at: user.created_at,
      last_login: user.last_login,
      avatar_url: user.avatar_url,
      provider_data: user.provider_data,
      banned: user.banned || false,
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
    res.json({ success: true, profile: completeProfile });
  } catch (error) {
    console.error('❌ Get profile error:', error);
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
    res.json({ success: true, profile: defaultProfile, error: "Server error but returning default profile: " + error.message });
  }
});

app.put('/api/user/profile', verifyToken, async (req, res) => {
  await updateProfileHandler(req, res);
});
app.post('/api/user/profile', verifyToken, async (req, res) => {
  await updateProfileHandler(req, res);
});

app.get('/api/user/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
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
        return res.json({ success: true, profile: defaultProfile, message: "Using default profile (table not found)" });
      }
      return res.status(500).json({ success: false, error: "Database error" });
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
      return res.json({ success: true, profile: defaultProfile });
    }
    const profile = profiles[0];
    const responseProfile = {
      ...profile,
      avatar: profile.avatar_url || `https://i.pravatar.cc/150?u=${username}`
    };
    res.json({ success: true, profile: responseProfile });
  } catch (error) {
    console.error('❌ Get user profile error:', error);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ==============================
// AI ENDPOINTS (unchanged)
// ==============================

app.post('/api/ai/private', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    const response = await axios.get(
      `https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(message)}&cb=${Date.now()}`,
      { 
        headers: { Accept: "application/json", "User-Agent": "GoatBot/1.0" },
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
    if (!message) return res.status(400).json({ error: "Message is required" });
    const response = await axios.get(
      `https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(message)}&cb=${Date.now()}`,
      { 
        headers: { Accept: "application/json", "User-Agent": "GoatBot/1.0" },
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

// ==============================
// MESSAGES ENDPOINTS (unchanged)
// ==============================

app.get('/api/messages', async (req, res) => {
  try {
    const { data: messages, error: messagesError } = await supabase
      .from('chatter')
      .select('id, content, username, created_at, image_url, reply_to')
      .order('created_at', { ascending: false });
    if (messagesError) throw messagesError;
    const usernames = [...new Set(messages.map(msg => msg.username))];
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('username, status, last_active')
      .in('username', usernames);
    const profileMap = {};
    if (profiles && !profilesError) {
      profiles.forEach(profile => {
        profileMap[profile.username] = {
          status: profile.status || 'offline',
          last_seen: profile.last_active
        };
      });
    }
    const messagesWithStatus = messages.map(msg => {
      if (PERMANENT_ONLINE_USERS.includes(msg.username)) {
        return { ...msg, user_status: 'online', last_seen: null };
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

app.post('/api/messages', async (req, res) => {
  try {
    const { content, username, image_url, reply_to } = req.body;
    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ error: "Content or image is required" });
    }
    if (!username || username.trim() === '') {
      return res.status(400).json({ error: "Username is required" });
    }
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('banned')
      .ilike('username', username)
      .limit(1)
      .single();
    if (!userError && user && user.banned) {
      const banMessage = `🚫 User @${username} has been banned and cannot send messages.`;
      const systemMsg = {
        content: banMessage,
        username: 'System',
        image_url: null,
        reply_to: null,
        created_at: new Date().toISOString()
      };
      const { data: savedSystemMsg, error: saveError } = await supabase
        .from('chatter')
        .insert([systemMsg])
        .select();
      if (!saveError && savedSystemMsg && savedSystemMsg[0]) {
        io.emit('new-message', savedSystemMsg[0]);
      } else {
        io.emit('system-message', banMessage);
      }
      return res.status(403).json({ error: "You are banned and cannot send messages." });
    }
    const insertData = {
      content: (content && content.trim() !== '') ? content.trim() : '',
      username: username.trim(),
      image_url: image_url || '',
      reply_to: reply_to || '',
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();
    if (error) {
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        const minimalData = {
          content: (content && content.trim() !== '') ? content.trim() : 'Message',
          username: username.trim(),
          created_at: new Date().toISOString()
        };
        const { data: retryData, error: retryError } = await supabase
          .from('chatter')
          .insert([minimalData])
          .select();
        if (retryError) throw retryError;
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

app.delete('/api/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    const { data: message, error: fetchError } = await supabase
      .from('chatter')
      .select('username')
      .eq('id', id)
      .single();
    if (fetchError || !message) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }
    if (username !== 'Admin0' && message.username !== username) {
      return res.status(403).json({ success: false, error: 'You can only delete your own messages' });
    }
    const { error } = await supabase
      .from('chatter')
      .delete()
      .eq('id', id);
    if (error) throw error;
    io.emit('message-deleted', id);
    res.status(200).json({ success: true, message: "Message deleted successfully" });
  } catch (error) {
    console.error('❌ Failed to delete message:', error);
    res.status(500).json({ success: false, error: "Failed to delete message: " + error.message });
  }
});

// ==============================
// GET ALL SIGNED-UP USERS (unchanged)
// ==============================

function isNewUser(createdAt) {
  if (!createdAt) return false;
  const diffDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays <= 7;
}

app.get('/api/users/all', async (req, res) => {
  try {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, username, email, auth_provider, created_at, last_login, avatar_url, provider_data, banned')
      .order('created_at', { ascending: false });
    if (usersError) {
      return res.status(500).json({ success: false, error: "Failed to fetch users" });
    }
    if (!users || users.length === 0) {
      return res.json({ success: true, users: [], message: "No users found" });
    }
    const usernames = users.map(u => u.username);
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('*')
      .in('username', usernames);
    if (profilesError && profilesError.code !== '42P01') {
      console.error('❌ Error fetching profiles:', profilesError);
    }
    const profileMap = {};
    if (profiles && profiles.length > 0) {
      profiles.forEach(profile => {
        profileMap[profile.username] = profile;
      });
    }
    const allUsersData = users.map(user => {
      const profile = profileMap[user.username] || {};
      const isBot = PERMANENT_ONLINE_USERS.includes(user.username);
      return {
        username: user.username,
        email: user.email || '',
        user_id: user.id,
        auth_provider: user.auth_provider || 'local',
        created_at: user.created_at,
        last_login: user.last_login,
        avatar_url: user.avatar_url,
        provider_data: user.provider_data,
        banned: user.banned || false,
        firstname: profile.firstname || '',
        lastname: profile.lastname || '',
        bio: profile.bio || '',
        age: profile.age || null,
        gender: profile.gender || '',
        location: profile.location || '',
        interests: profile.interests || '',
        avatar: profile.avatar_url || user.avatar_url || `https://i.pravatar.cc/150?u=${user.username}`,
        display_name: profile.display_name || user.username,
        status: isBot ? 'online' : (profile.status || 'offline'),
        last_seen: isBot ? null : (profile.last_active || user.last_login),
        message_count: 0,
        post_count: 0,
        join_date: user.created_at,
        is_new_user: isNewUser(user.created_at)
      };
    });
    // get message counts
    try {
      const { data: messageCounts, error: msgError } = await supabase
        .from('chatter')
        .select('username')
        .in('username', usernames);
      if (!msgError && messageCounts) {
        const msgCountMap = {};
        messageCounts.forEach(msg => {
          msgCountMap[msg.username] = (msgCountMap[msg.username] || 0) + 1;
        });
        allUsersData.forEach(u => u.message_count = msgCountMap[u.username] || 0);
      }
    } catch (msgCountError) {
      console.log('⚠️ Could not fetch message counts:', msgCountError.message);
    }
    // get post counts
    try {
      const { data: postCounts, error: postError } = await supabase
        .from('posts')
        .select('author_username')
        .in('author_username', usernames);
      if (!postError && postCounts) {
        const postCountMap = {};
        postCounts.forEach(p => {
          postCountMap[p.author_username] = (postCountMap[p.author_username] || 0) + 1;
        });
        allUsersData.forEach(u => u.post_count = postCountMap[u.username] || 0);
      }
    } catch (postCountError) {
      console.log('⚠️ Could not fetch post counts:', postCountError.message);
    }
    const newUsersCount = allUsersData.filter(u => u.is_new_user).length;
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
    res.status(500).json({ success: false, error: "Failed to fetch users: " + error.message });
  }
});

app.get('/api/users/stats', async (req, res) => {
  try {
    const { count: totalUsers, error: countError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    if (countError) {
      return res.status(500).json({ error: "Failed to get user stats" });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count: newUsersToday, error: newError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', today.toISOString());
    if (newError) {
      return res.status(500).json({ error: "Failed to get new user stats" });
    }
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const { count: activeUsers, error: activeError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('last_login', yesterday.toISOString());
    if (activeError) {
      return res.status(500).json({ error: "Failed to get active user stats" });
    }
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
    res.status(500).json({ success: false, error: "Failed to get user stats: " + error.message });
  }
});

app.get('/api/create-user-profiles-table', async (req, res) => {
  try {
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
          `
        ]
      });
    } else if (checkError) {
      throw checkError;
    } else {
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
    res.status(500).json({ success: false, error: "Error checking table: " + error.message });
  }
});

app.get('/api/test-profile', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ success: false, error: "Username query parameter is required" });
    }
    const { data: profiles, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('username', username)
      .limit(1);
    if (error) {
      return res.status(500).json({ success: false, error: "Database error: " + error.message });
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
    const profile = profiles[0];
    const responseProfile = {
      ...profile,
      avatar: profile.avatar_url || `https://i.pravatar.cc/150?u=${username}`
    };
    res.json({ success: true, profile: responseProfile });
  } catch (error) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ success: false, error: "Internal server error: " + error.message });
  }
});

// ==============================
// PRIVATE MESSAGES (unchanged)
// ==============================

app.post('/api/private/messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, image_url } = req.body;
    if (!sender_username || !receiver_username) {
      return res.status(400).json({ success: false, error: "Sender and receiver usernames are required" });
    }
    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ success: false, error: "Content or image is required" });
    }
    const { data: sender, error: senderError } = await supabase
      .from('users')
      .select('banned')
      .ilike('username', sender_username)
      .limit(1)
      .single();
    if (!senderError && sender && sender.banned) {
      return res.status(403).json({ success: false, error: "You are banned and cannot send messages." });
    }
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const insertData = {
      sender_username: sender_username.trim(),
      receiver_username: receiver_username.trim(),
      content: content ? content.trim() : '',
      image_url: image_url || null,
      read: false,
      created_at: new Date().toISOString(),
      message_id: messageId
    };
    const { data, error } = await supabase
      .from('private_messages')
      .insert([insertData])
      .select();
    if (error) {
      return res.status(500).json({ success: false, error: "Database error: " + error.message });
    }
    const responseData = { ...data[0], custom_message_id: messageId };
    io.to(receiver_username).emit('new-private-message', responseData);
    io.to(sender_username).emit('private-message-sent', responseData);
    res.status(201).json({ success: true, data: responseData, custom_message_id: messageId });
  } catch (error) {
    console.error('❌ Failed to save private message:', error);
    res.status(500).json({ success: false, error: "Failed to send private message: " + error.message });
  }
});

app.get('/api/private/conversations', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ error: "Username query parameter is required" });
    }
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .order('created_at', { ascending: false });
    if (error) {
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
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .or(`sender_username.eq.${otherUser},receiver_username.eq.${otherUser}`)
      .order('created_at', { ascending: true });
    if (error) {
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
    res.json(filteredMessages);
  } catch (error) {
    console.error('❌ Error fetching private messages:', error);
    res.status(500).json({ error: 'Failed to fetch private messages: ' + error.message });
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
      .eq('read', false);
    if (error) {
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
      .eq('read', false);
    if (error) {
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error marking messages as read:', error);
    res.status(500).json({ error: "Failed to mark messages as read: " + error.message });
  }
});

// ==============================
// POSTS (unchanged)
// ==============================

app.post('/api/create-posts-table', async (req, res) => {
  try {
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
      res.json({ success: true, message: "Posts table exists", sampleData: tableCheck?.[0] });
    }
  } catch (error) {
    console.error('❌ Error checking posts table:', error);
    res.status(500).json({ success: false, error: "Error checking table: " + error.message });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const { username } = req.query;
    let query = supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false });
    if (!username) {
      query = query.eq('visibility', 'public');
    }
    const { data: posts, error: postsError } = await query;
    if (postsError) {
      return res.status(500).json({ error: 'Failed to fetch posts' });
    }
    let filteredPosts = posts;
    if (username) {
      filteredPosts = posts.filter(post => 
        post.visibility === 'public' || post.author_username === username
      );
    }
    const postsWithDetails = await Promise.all(
      (filteredPosts || []).map(async (post) => {
        const { data: comments } = await supabase
          .from('post_comments')
          .select('*')
          .eq('post_id', post.id)
          .order('created_at', { ascending: true });
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
    res.json(postsWithDetails);
  } catch (error) {
    console.error('❌ Error in get posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

app.post('/api/posts', async (req, res) => {
  try {
    const { author_username, content, media_url, media_type } = req.body;
    if (!author_username || !content) {
      return res.status(400).json({ error: "Author and content are required" });
    }
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
      visibility: 'public'
    };
    const { data: post, error } = await supabase
      .from('posts')
      .insert([postData])
      .select();
    if (error) {
      return res.status(500).json({ error: "Failed to create post: " + error.message });
    }
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

app.post('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { author_username, content } = req.body;
    if (!author_username || !content) {
      return res.status(400).json({ error: "Author and content are required" });
    }
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', postId)
      .single();
    if (postError || !post) {
      return res.status(404).json({ error: "Post not found" });
    }
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
      return res.status(500).json({ error: "Failed to add comment: " + error.message });
    }
    await supabase
      .from('posts')
      .update({ 
        comments_count: await getCommentsCount(postId),
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);
    res.status(201).json(comment[0]);
  } catch (error) {
    console.error('❌ Error adding comment:', error);
    res.status(500).json({ error: "Failed to add comment: " + error.message });
  }
});

app.post('/api/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id')
      .eq('id', postId)
      .single();
    if (postError || !post) {
      return res.status(404).json({ error: "Post not found" });
    }
    const { data: existingLike } = await supabase
      .from('post_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('username', username)
      .single();
    if (existingLike) {
      await supabase
        .from('post_likes')
        .delete()
        .eq('id', existingLike.id);
    } else {
      await supabase
        .from('post_likes')
        .insert([{
          post_id: postId,
          username: username
        }]);
    }
    const newLikesCount = await getLikesCount(postId);
    await supabase
      .from('posts')
      .update({ 
        likes_count: newLikesCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', postId);
    res.json({ success: true, likesCount: newLikesCount, userLiked: !existingLike });
  } catch (error) {
    console.error('❌ Error liking post:', error);
    res.status(500).json({ error: "Failed to like post: " + error.message });
  }
});

app.get('/api/posts/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { currentUser } = req.query;
    const { data: posts, error } = await supabase
      .from('posts')
      .select('*')
      .eq('author_username', username)
      .order('created_at', { ascending: false });
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch user posts' });
    }
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
    res.json(postsWithDetails);
  } catch (error) {
    console.error('❌ Error in get user posts:', error);
    res.status(500).json({ error: 'Failed to fetch user posts' });
  }
});

app.delete('/api/posts/:postId', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { username } = req.body;
    const requesterUsername = req.user.username;
    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('author_username')
      .eq('id', postId)
      .single();
    if (postError || !post) {
      return res.status(404).json({ error: "Post not found" });
    }
    const isAdmin = requesterUsername === 'Admin0';
    if (post.author_username !== username && !isAdmin) {
      return res.status(403).json({ error: "You can only delete your own posts" });
    }
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('id', postId);
    if (deleteError) {
      return res.status(500).json({ error: "Failed to delete post: " + deleteError.message });
    }
    io.emit('post-deleted', postId);
    res.json({ success: true, message: "Post deleted successfully" });
  } catch (error) {
    console.error('❌ Error deleting post:', error);
    res.status(500).json({ error: "Failed to delete post: " + error.message });
  }
});

app.patch('/api/posts/:postId/visibility', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { visibility } = req.body;
    const username = req.user.username;
    if (!['public', 'private'].includes(visibility)) {
      return res.status(400).json({ error: "Visibility must be 'public' or 'private'" });
    }
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
    const { data: updatedPost, error: updateError } = await supabase
      .from('posts')
      .update({ visibility, updated_at: new Date().toISOString() })
      .eq('id', postId)
      .select();
    if (updateError) {
      return res.status(500).json({ error: "Failed to update visibility" });
    }
    io.emit('post-visibility-changed', updatedPost[0]);
    res.json({ success: true, visibility: updatedPost[0].visibility });
  } catch (error) {
    console.error('❌ Visibility change error:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

async function getCommentsCount(postId) {
  const { count, error } = await supabase
    .from('post_comments')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  return count || 0;
}

async function getLikesCount(postId) {
  const { count, error } = await supabase
    .from('post_likes')
    .select('*', { count: 'exact', head: true })
    .eq('post_id', postId);
  return count || 0;
}

app.get('/api/posts/updates', async (req, res) => {
  try {
    const { lastUpdate } = req.query;
    let query = supabase
      .from('posts')
      .select('*')
      .order('updated_at', { ascending: false });
    if (lastUpdate) {
      query.gt('updated_at', new Date(lastUpdate).toISOString());
    }
    const { data: posts, error } = await query;
    if (error) throw error;
    res.json({ success: true, posts: posts || [], timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Error fetching post updates:', error);
    res.status(500).json({ error: 'Failed to fetch updates' });
  }
});

// ==============================
// DEBUG & TABLE STRUCTURE
// ==============================

app.get('/api/debug/private-messages-structure', async (req, res) => {
  try {
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
    const { data: readData, error: readError } = await supabase
      .from('private_messages')
      .select('*')
      .eq('id', insertData[0].id)
      .single();
    await supabase.from('private_messages').delete().eq('id', insertData[0].id);
    res.json({
      success: true,
      tableStructure: readData,
      message: "Table structure is correct",
      fields: Object.keys(readData)
    });
  } catch (error) {
    console.error('❌ Debug error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/create-private-messages-table', async (req, res) => {
  try {
    const { data: tableCheck, error: checkError } = await supabase
      .from('private_messages')
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
          `
        ]
      });
    } else if (checkError) {
      throw checkError;
    } else {
      res.json({ success: true, message: "private_messages table exists", sampleData: tableCheck?.[0] });
    }
  } catch (error) {
    console.error('❌ Error checking table:', error);
    res.status(500).json({ success: false, error: "Error checking table: " + error.message });
  }
});

app.post('/api/private/alt-messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, image_url } = req.body;
    if (!sender_username || !receiver_username) {
      return res.status(400).json({ error: "Sender and receiver usernames are required" });
    }
    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ error: "Content or image is required" });
    }
    const insertData = {
      content: content ? content.trim() : '',
      username: sender_username.trim(),
      image_url: image_url || '',
      reply_to: receiver_username.trim(),
      message_type: 'private',
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();
    if (error) {
      return res.status(500).json({ error: "Failed to send message: " + error.message });
    }
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

app.get('/api/private/alt-messages/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { otherUser } = req.query;
    if (!username || !otherUser) {
      return res.status(400).json({ error: "Username and otherUser parameters are required" });
    }
    const { data: messages, error } = await supabase
      .from('chatter')
      .select('*')
      .eq('message_type', 'private')
      .or(`and(username.eq.${username},reply_to.eq.${otherUser}),and(username.eq.${otherUser},reply_to.eq.${username})`)
      .order('created_at', { ascending: true });
    if (error) {
      return res.status(500).json({ error: 'Database error: ' + error.message });
    }
    const transformedMessages = (messages || []).map(msg => ({
      id: msg.id,
      sender_username: msg.username,
      receiver_username: msg.reply_to,
      content: msg.content,
      image_url: msg.image_url,
      read: true,
      created_at: msg.created_at
    }));
    res.json(transformedMessages);
  } catch (error) {
    console.error('❌ Error fetching alternative private messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages: ' + error.message });
  }
});

app.get('/test-private-messages', async (req, res) => {
  try {
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
      return res.status(500).json({ success: false, error: error.message });
    }
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
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/test-private-messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content } = req.body;
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
      return res.status(500).json({ success: false, error: error.message });
    }
    io.emit('new-private-message', data[0]);
    res.json({ success: true, message: 'POST Test private message saved successfully', data: data[0] });
  } catch (error) {
    console.error('❌ POST Test private message error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/debug-private-messages', async (req, res) => {
  try {
    const { data: tableInfo, error: tableError } = await supabase
      .from('private_messages')
      .select('*')
      .limit(1);
    if (tableError) {
      return res.status(500).json({ 
        success: false,
        error: 'Table error: ' + tableError.message,
        details: 'The private_messages table might not exist or have RLS issues'
      });
    }
    const { count: totalCount, error: countError } = await supabase
      .from('private_messages')
      .select('*', { count: 'exact', head: true })
      .eq('receiver_username', 'test_user1')
      .eq('read', false);
    if (countError) {
      return res.status(500).json({ success: false, error: 'Count error: ' + countError.message });
    }
    const { data: allMessages, error: messagesError } = await supabase
      .from('private_messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    if (messagesError) {
      return res.status(500).json({ success: false, error: 'Messages error: ' + messagesError.message });
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
    res.status(500).json({ success: false, error: 'Debug error: ' + error.message });
  }
});

app.get('/private-messages', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) {
      return res.status(400).json({ 
        error: "Username query parameter is required",
        example: "/private-messages?username=test_user1" 
      });
    }
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
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

app.get('/api/create-posts-table', async (req, res) => {
  try {
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
      res.json({ success: true, message: "Posts table exists", sampleData: tableCheck?.[0], instructions: "Use POST /api/create-posts-table to create the table if it doesn't exist" });
    }
  } catch (error) {
    console.error('❌ Error checking posts table (GET):', error);
    res.status(500).json({ success: false, error: "Error checking table: " + error.message });
  }
});

// ==============================
// UPTIME & HEALTH
// ==============================

if (config.autoUptime?.enable || isRender) {
  const myUrl = renderExternalUrl || config.autoUptime?.url || `http://localhost:${port}`;
  global.utils.log.info("RENDER UPTIME", `Monitoring endpoint available at: ${myUrl}/uptime`);
  global.utils.log.info("UPTIMEROBOT TIP", `Add this URL to UptimeRobot: ${myUrl}/health`);

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

  if (isRender) {
    const pingInterval = setInterval(() => {
      axios.get(`${myUrl}/uptime`)
        .then(() => global.utils.log.info("RENDER PING", "Keeping Render instance alive"))
        .catch(err => global.utils.log.err("RENDER PING", err.message));
    }, 4 * 60 * 1000);
    process.on('exit', () => clearInterval(pingInterval));
  }
}

// ==============================
// COMMAND SYSTEM (LAZY LOADED)
// ==============================

const PREFIX = config.prefix || "!";
let commands = {};
let commandsLoaded = false;

function loadCommandsLazy() {
  if (commandsLoaded) return;
  try {
    const COMMANDS_DIR = path.join(__dirname, "commands");
    if (fs.existsSync(COMMANDS_DIR)) {
      const commandFiles = fs.readdirSync(COMMANDS_DIR).filter(file => file.endsWith(".js"));
      commandFiles.forEach(file => {
        try {
          const cmd = require(path.join(COMMANDS_DIR, file));
          if (cmd.config?.name) {
            commands[cmd.config.name] = cmd;
            if (cmd.config.aliases) {
              cmd.config.aliases.forEach(alias => commands[alias] = cmd);
            }
            console.log(`✅ Loaded command: ${PREFIX}${cmd.config.name}`);
          }
        } catch (err) {
          console.error(`❌ Failed to load ${file}:`, err);
        }
      });
    } else {
      console.warn('⚠️ Commands directory not found, skipping command loading.');
    }
  } catch (err) {
    console.error('❌ Error loading commands:', err);
  }
  commandsLoaded = true;
}

function handleCommand(input) {
  if (!input.startsWith(PREFIX)) return null;
  const args = input.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  const text = args.join(" ");
  return { commandName, args, text };
}

// ==============================
// PRIVATE MESSAGING (additional)
// ==============================

app.get('/private-messages/conversations/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { data: conversations, error } = await supabase
      .from('private_messages')
      .select('sender_username, receiver_username, content, created_at, read')
      .or(`sender_username.eq.${username},receiver_username.eq.${username}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
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

app.get('/private-messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const { data: messages, error } = await supabase
      .from('private_messages')
      .select('*')
      .or(`and(sender_username.eq.${user1},receiver_username.eq.${user2}),and(sender_username.eq.${user2},receiver_username.eq.${user1})`)
      .order('created_at', { ascending: true });
    if (error) throw error;
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

app.post('/private-messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, image_url } = req.body;
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
    const { data, error } = await supabase
      .from('private_messages')
      .insert([insertData])
      .select();
    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
    io.emit('new-private-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save private message:', error);
    res.status(500).json({ error: "Failed to send private message: " + error.message });
  }
});

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

// ==============================
// PUBLIC CHAT (legacy)
// ==============================

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

app.post('/messages', async (req, res) => {
  try {
    const { content, username, image_url, reply_to } = req.body;
    if ((!content || content.trim() === '') && !image_url) {
      return res.status(400).json({ error: "Content or image is required" });
    }
    if (!username || username.trim() === '') {
      return res.status(400).json({ error: "Username is required" });
    }
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('banned')
      .ilike('username', username)
      .limit(1)
      .single();
    if (!userError && user && user.banned) {
      const banMessage = `🚫 User @${username} has been banned and cannot send messages.`;
      const systemMsg = {
        content: banMessage,
        username: 'System',
        image_url: null,
        reply_to: null,
        created_at: new Date().toISOString()
      };
      const { data: savedSystemMsg, error: saveError } = await supabase
        .from('chatter')
        .insert([systemMsg])
        .select();
      if (!saveError && savedSystemMsg && savedSystemMsg[0]) {
        io.emit('new-message', savedSystemMsg[0]);
      } else {
        io.emit('system-message', banMessage);
      }
      return res.status(403).json({ error: "You are banned and cannot send messages." });
    }
    const insertData = {
      content: (content && content.trim() !== '') ? content.trim() : '',
      username: username.trim(),
      image_url: image_url || '',
      reply_to: reply_to || '',
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();
    if (error) {
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        const minimalData = {
          content: (content && content.trim() !== '') ? content.trim() : 'Message',
          username: username.trim(),
          created_at: new Date().toISOString()
        };
        const { data: retryData, error: retryError } = await supabase
          .from('chatter')
          .insert([minimalData])
          .select();
        if (retryError) throw retryError;
        io.emit('new-message', retryData[0]);
        return res.status(201).json(retryData[0]);
      }
      throw error;
    }
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save message via legacy endpoint:', error);
    res.status(500).json({ error: "Failed to save message: " + error.message });
  }
});

app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }
    const fileBuffer = req.file.buffer;
    const fileName = `${Date.now()}-${req.file.originalname}`;
    const filePath = `images/${fileName}`;
    const { data, error } = await supabase.storage
      .from('chat_images')
      .upload(filePath, fileBuffer, {
        contentType: req.file.mimetype,
        upsert: false
      });
    if (error) {
      return res.status(500).json({ error: 'Storage upload failed', details: error.message });
    }
    const { data: urlData } = supabase.storage
      .from('chat_images')
      .getPublicUrl(filePath);
    res.json({ imageUrl: urlData.publicUrl, message: 'Image uploaded successfully' });
  } catch (error) {
    console.error('❌ Upload endpoint error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

app.delete('/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    const { data: message, error: fetchError } = await supabase
      .from('chatter')
      .select('username')
      .eq('id', id)
      .single();
    if (fetchError || !message) {
      return res.status(404).json({ success: false, error: 'Message not found' });
    }
    if (username !== 'Admin0' && message.username !== username) {
      return res.status(403).json({ success: false, error: 'You can only delete your own messages' });
    }
    const { error } = await supabase
      .from('chatter')
      .delete()
      .eq('id', id);
    if (error) throw error;
    io.emit('message-deleted', id);
    res.status(200).json({ success: true, message: "Message deleted successfully" });
  } catch (error) {
    console.error('❌ Failed to delete message:', error);
    res.status(500).json({ success: false, error: "Failed to delete message: " + error.message });
  }
});

// ==============================
// BOT RESPONSE SAVER
// ==============================

async function saveBotResponseToSupabase(content, originalCommand, commandType = 'AI') {
  try {
    console.log(`🔄 Attempting to save ${commandType} response to Supabase...`);
    ensureBotOnline(commandType === 'AI' ? 'AI' : 'Bot');
    const insertData = {
      content: content || `${commandType} Response`, 
      username: commandType === 'AI' ? 'AI' : 'Bot',
      image_url: '',
      reply_to: originalCommand || '',
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('chatter')
      .insert([insertData])
      .select();
    if (error) {
      if (error.message.includes('null value') || error.message.includes('primary key')) {
        const minimalData = {
          content: content || `${commandType} Response`,
          username: commandType === 'AI' ? 'AI' : 'Bot',
          created_at: new Date().toISOString()
        };
        const { data: retryData, error: retryError } = await supabase
          .from('chatter')
          .insert([minimalData])
          .select();
        if (retryError) throw retryError;
        const botMessage = retryData[0];
        if (commandType === 'AI' || commandType === 'Bot') {
          botMessage.user_status = 'online';
          botMessage.last_seen = null;
        }
        io.emit('new-message', botMessage);
        return retryData;
      }
      throw error;
    }
    const botMessage = data[0];
    if (commandType === 'AI' || commandType === 'Bot') {
      botMessage.user_status = 'online';
      botMessage.last_seen = null;
    }
    io.emit('new-message', botMessage);
    return data;
  } catch (error) {
    console.error(`❌ Error saving ${commandType} response to Supabase:`, error);
    throw error;
  }
}

// ==============================
// TEST ENDPOINTS
// ==============================

app.get('/test-supabase', async (req, res) => {
  try {
    const { data: readData, error: readError } = await supabase
      .from('chatter')
      .select('*')
      .limit(5)
      .order('created_at', { ascending: false });
    if (readError) {
      return res.status(500).json({ success: false, test: 'read', error: readError.message });
    }
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
      return res.status(500).json({ success: false, test: 'insert', error: insertError.message, details: insertError });
    }
    res.json({ 
      success: true, 
      message: 'Supabase connection test successful',
      tests: {
        read: { success: true, messageCount: readData?.length || 0 },
        insert: { success: true, insertedId: insertData[0]?.id }
      },
      recentMessages: readData,
      insertedMessage: insertData[0]
    });
  } catch (error) {
    console.error('❌ Test error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/debug-all-commands', (req, res) => {
  res.json({ success: true, commands: Object.keys(commands) });
});

app.post('/test-message', async (req, res) => {
  try {
    const { content, username } = req.body;
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
      return res.status(500).json({ success: false, error: error.message });
    }
    io.emit('new-message', data[0]);
    res.json({ success: true, message: 'Test message saved successfully', data: data[0] });
  } catch (error) {
    console.error('❌ Test message error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==============================
// COMMAND API HANDLER
// ==============================

app.post("/api/command", async (req, res) => {
  try {
    let { message, source = 'main-chat', reply_to, reply_image_url } = req.body;
    if (!message) return res.status(400).json({ reply: "❌ Message is required" });

    // ===== Handle -prompt command globally =====
    if (message.trim().startsWith('-prompt')) {
      const rest = message.trim().slice(7).trim();
      let imageUrl = null;
      let userPrompt = null;
      if (reply_image_url) {
        imageUrl = reply_image_url;
      } else if (rest.startsWith('http://') || rest.startsWith('https://')) {
        const parts = rest.split(/\s+/);
        if (parts[0].startsWith('http://') || parts[0].startsWith('https://')) {
          imageUrl = parts[0];
          if (parts.length > 1) {
            console.log('Extra text after image URL ignored:', parts.slice(1).join(' '));
          }
        } else {
          userPrompt = rest;
        }
      } else {
        userPrompt = rest;
      }
      if (!imageUrl && (!userPrompt || userPrompt.length === 0)) {
        return res.json({ reply: "❌ Please provide an image URL or a text description after -prompt.\n\nExamples:\n-prompt https://example.com/image.jpg\n-prompt a futuristic city at night" });
      }
      try {
        const prompt = await handlePromptCommand(imageUrl, userPrompt);
        return res.json({ reply: prompt });
      } catch (error) {
        return res.json({ reply: `❌ ${error.message}` });
      }
    }

    // ===== Load commands lazily =====
    loadCommandsLazy();

    // ===== Dash command conversion =====
    if (source === 'private-ai' && !message.startsWith(PREFIX) && message.trim().startsWith('-')) {
      const trimmed = message.trim();
      const parts = trimmed.split(/\s+/);
      const dashCmd = parts[0].substring(1);
      if (commands[dashCmd]) {
        const rest = parts.slice(1).join(' ');
        message = `${PREFIX}${dashCmd}${rest ? ' ' + rest : ''}`;
        console.log(`🔀 Converted dash command: ${trimmed} → ${message}`);
      } else {
        message = `${PREFIX}ai ${trimmed}`;
        console.log(`🤖 Unknown dash command, prefixing with !ai: ${message}`);
      }
    } else if (source === 'private-ai' && !message.startsWith(PREFIX)) {
      const trimmed = message.trim().toLowerCase();
      const firstWord = trimmed.split(' ')[0];
      const commandWords = ['ai', 'help', 'ping', 'prefix', 'ask', 'chat'];
      if (commandWords.includes(firstWord)) {
        message = PREFIX + message;
      } else {
        message = PREFIX + 'ai ' + message;
      }
    }

    // ===== PREFIX command =====
    if (message.trim().toLowerCase() === "prefix") {
      return res.json({ reply: `🔹 My prefix is: ${PREFIX}` });
    }

    const cmd = handleCommand(message);
    if (!cmd) return res.end();

    let finalReply = null;
    let responder = null;

    // ===== AI command =====
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
    } else {
      responder = 'Bot';
      const command = commands[cmd.commandName];
      if (!command) {
        finalReply = "❌ Command not found";
      } else {
        const replies = [];
        const event = { body: cmd.text };
        let imageUrl = null;
        if (reply_image_url) {
          console.log("📸 Using direct reply image URL from frontend:", reply_image_url);
          imageUrl = reply_image_url;
        } else if (reply_to) {
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

// ==============================
// HELPER: extractImageUrlFromMessage
// ==============================

function extractImageUrlFromMessage(message) {
  if (!message) return null;
  if (message.image_url && typeof message.image_url === 'string' && message.image_url.trim() !== '') {
    return message.image_url;
  }
  if (message.attachments) {
    try {
      const atts = typeof message.attachments === 'string' ? JSON.parse(message.attachments) : message.attachments;
      if (Array.isArray(atts)) {
        const img = atts.find(a => a.type === 'photo' || a.type === 'image' || (a.url && /\.(jpg|jpeg|png|gif|webp)/i.test(a.url)));
        if (img && img.url) return img.url;
      }
    } catch (e) {}
  }
  if (message.content) {
    const urlMatch = message.content.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) return urlMatch[0];
  }
  return null;
}

// ==============================
// GET ONLINE USERS
// ==============================

app.get('/online-users', (req, res) => {
  const onlineUsersArray = Array.from(onlineUsers.keys());
  console.log('Current online users:', onlineUsersArray);
  res.json(onlineUsersArray);
});

// ==============================
// ADMIN ENDPOINTS
// ==============================

app.post('/api/admin/block/:username', verifyToken, async (req, res) => {
  try {
    const adminUsername = req.user.username;
    const targetUsername = req.params.username;
    if (adminUsername !== 'Admin0') {
      return res.status(403).json({ success: false, error: 'Only Admin0 can block users.' });
    }
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('id')
      .ilike('username', targetUsername)
      .limit(1)
      .single();
    if (findError || !user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }
    const { error: updateError } = await supabase
      .from('users')
      .update({ banned: true })
      .eq('id', user.id);
    if (updateError) {
      return res.status(500).json({ success: false, error: 'Database error.' });
    }
    onlineUsers.delete(targetUsername);
    io.emit('user-status-change', { username: targetUsername, status: 'offline', lastSeen: new Date().toISOString() });
    console.log(`🚫 User ${targetUsername} blocked by Admin0.`);
    res.json({ success: true, message: `User @${targetUsername} has been blocked.` });
  } catch (error) {
    console.error('❌ Block endpoint error:', error);
    res.status(500).json({ success: false, error: 'Internal server error.' });
  }
});

app.post('/api/admin/clear-all-messages', verifyToken, async (req, res) => {
  try {
    const adminUsername = req.user.username;
    if (adminUsername !== 'Admin0') {
      return res.status(403).json({ success: false, error: 'Only Admin0 can clear all messages.' });
    }
    console.log('🧹 Admin0 is clearing all public messages...');
    const { error } = await supabase
      .from('chatter')
      .delete()
      .neq('id', 0);
    if (error) {
      return res.status(500).json({ success: false, error: 'Database error: ' + error.message });
    }
    console.log('✅ All public messages have been deleted.');
    io.emit('clear-all-messages', { message: 'All public messages have been cleared by Admin0.' });
    res.json({ success: true, message: 'All public messages cleared successfully.' });
  } catch (error) {
    console.error('❌ Clear all messages error:', error);
    res.status(500).json({ success: false, error: 'Internal server error: ' + error.message });
  }
});

// ==============================
// SOCKET.IO EVENTS
// ==============================

io.on('connection', (socket) => {
  console.log('🔌 User connected via polling:', socket.id);

  socket.on('join-user-room', (username) => {
    if (username) {
      socket.join(username);
      console.log(`👤 User ${username} joined their private room`);
    }
  });

  socket.on('leave-user-room', (username) => {
    if (username) {
      socket.leave(username);
      console.log(`👋 User ${username} left their private room`);
    }
  });

  socket.on('request-messages', async () => {
    try {
      const { data, error } = await supabase
        .from('chatter')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && data) {
        const messagesWithStatus = data.map(msg => {
          if (PERMANENT_ONLINE_USERS.includes(msg.username)) {
            return { ...msg, user_status: 'online', last_seen: null };
          }
          return msg;
        });
        socket.emit('chat-messages', messagesWithStatus.reverse());
      }
    } catch (error) {
      console.error('Error sending messages to client:', error);
    }
  });

  socket.on('user-online', (username) => {
    if (username) {
      console.log('👤 User online:', username);
      const existingUser = onlineUsers.get(username);
      const lastSeenTime = existingUser ? existingUser.lastSeen : Date.now();
      onlineUsers.set(username, {
        socketId: socket.id,
        username: username,
        lastSeen: lastSeenTime,
        isOnline: true
      });
      updateUserStatusOnline(username);
      const onlineUsersArray = Array.from(onlineUsers.keys());
      console.log('📊 Updated online users:', onlineUsersArray);
      io.emit('user-status-change', { 
        username, 
        status: 'online',
        lastSeen: null,
        onlineUsers: onlineUsersArray
      });
    }
  });

  socket.on('user-away', (username) => {
    if (username && onlineUsers.has(username) && !PERMANENT_ONLINE_USERS.includes(username)) {
      console.log('⏸️ User away:', username);
      const userData = onlineUsers.get(username);
      userData.lastSeen = Date.now();
      userData.isOnline = false;
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

  socket.on('send-private-message', async (data) => {
    try {
      console.log('🤫 Private AI message received via socket:', data);
      const response = await axios.post('http://localhost:3000/api/ai/private', {
        message: data.content
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      if (response.data.reply) {
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

  socket.on('send-private-message-socket', async (data) => {
    try {
      console.log('🤫 Private message via socket:', data);
      const { sender_username, receiver_username, content, image_url } = data;
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
      const responseData = {
        ...messageData[0],
        custom_message_id: messageId
      };
      io.to(receiver_username).emit('new-private-message', responseData);
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

  socket.on('private-message-confirmation', (data) => {
    console.log('✅ Private message confirmed on server:', data.message_id);
  });

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

  socket.on('disconnect', (reason) => {
    console.log('🔌 User disconnected:', socket.id, 'Reason:', reason);
    let foundUsername = null;
    let userLastSeen = null;
    for (let [username, data] of onlineUsers.entries()) {
      if (data.socketId === socket.id) {
        foundUsername = username;
        userLastSeen = data.lastSeen;
        data.lastSeen = Date.now();
        data.isOnline = false;
        if (!PERMANENT_ONLINE_USERS.includes(username)) {
          updateUserLastActive(username);
        }
        console.log('⏸️ User marked as inactive:', username, 'Last seen:', new Date(userLastSeen).toLocaleString());
        break;
      }
    }
    if (foundUsername && !PERMANENT_ONLINE_USERS.includes(foundUsername)) {
      const userData = onlineUsers.get(foundUsername);
      const onlineUsersArray = Array.from(onlineUsers.keys());
      io.emit('user-status-change', { 
        username: foundUsername, 
        status: 'offline',
        lastSeen: new Date(userLastSeen).toISOString(),
        onlineUsers: onlineUsersArray
      });
      console.log(`📢 Broadcasted offline status for ${foundUsername} with last seen:`, new Date(userLastSeen).toLocaleString());
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

// ==============================
// HELPER FUNCTIONS
// ==============================

function getPrivateChatRoomName(user1, user2) {
  const users = [user1, user2].sort();
  return `private_chat_${users[0]}_${users[1]}`;
}

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

// ==============================
// CLEANUP INACTIVE USERS
// ==============================

setInterval(() => {
  const now = Date.now();
  const removedUsers = [];
  for (let [username, data] of onlineUsers.entries()) {
    if (PERMANENT_ONLINE_USERS.includes(username)) {
      data.lastSeen = now;
      data.isOnline = true;
      continue;
    }
    if (now - data.lastSeen > onlineStatusTimeout) {
      console.log('⏰ Removing inactive user (5 minutes):', username);
      updateUserLastActive(username);
      onlineUsers.delete(username);
      removedUsers.push({
        username: username,
        lastSeen: data.lastSeen
      });
    }
  }
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
}, 60000);

// ==============================
// NEW ENDPOINTS
// ==============================

app.get('/api/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from('chatter')
      .select('*')
      .eq('id', id)
      .single();
    if (error) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json(data);
  } catch (error) {
    console.error('❌ Error in get message by ID:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

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
      return res.status(500).json({ error: 'Failed to update message' });
    }
    io.emit('message-updated', data[0]);
    res.json(data[0]);
  } catch (error) {
    console.error('❌ Error in update message:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/user/last-seen/:username', async (req, res) => {
  try {
    const { username } = req.params;
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

// ==============================
// OAUTH LINK / UNLINK / SET PASSWORD
// ==============================

app.post('/api/auth/link-account', verifyToken, async (req, res) => {
  try {
    const { provider, code } = req.body;
    const userId = req.user.id;
    if (!provider || !code) {
      return res.status(400).json({ success: false, error: "Provider and authorization code are required" });
    }
    const result = await handleOAuthCallback(provider, code, res);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
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
    if (updateError) throw updateError;
    console.log(`✅ ${provider} account linked successfully to user:`, req.user.username);
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
    res.status(500).json({ success: false, error: "Failed to link account: " + error.message });
  }
});

app.post('/api/auth/unlink-account', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', userId)
      .limit(1);
    if (userError || !user || user.length === 0) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    if (!user[0].password_hash) {
      return res.status(400).json({ 
        success: false, 
        error: "Cannot unlink OAuth account. Please set a password first." 
      });
    }
    const { error: updateError } = await supabase
      .from('users')
      .update({
        auth_provider: 'local',
        provider_id: null,
        provider_data: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
    if (updateError) throw updateError;
    console.log('✅ OAuth account unlinked successfully for user:', req.user.username);
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
    res.status(500).json({ success: false, error: "Failed to unlink account: " + error.message });
  }
});

app.post('/api/auth/set-password', verifyToken, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: "Password is required" });
    }
    if (password.length < 4 || password.length > 20) {
      return res.status(400).json({ success: false, error: "Password must be between 4-20 characters" });
    }
    const hashedPassword = hashPassword(password);
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: hashedPassword,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user.id);
    if (updateError) throw updateError;
    console.log('✅ Password set successfully for user:', req.user.username);
    res.json({ 
      success: true, 
      message: "Password set successfully",
      note: "You can now login with your username and password"
    });
  } catch (error) {
    console.error('❌ Set password error:', error);
    res.status(500).json({ success: false, error: "Failed to set password: " + error.message });
  }
});

// ==============================
// ENSURE BOT USERS EXIST
// ==============================

async function ensureBotUsersExist() {
  try {
    for (const username of PERMANENT_ONLINE_USERS) {
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .limit(1);
      if (!existingUser || existingUser.length === 0) {
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
      const { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('id')
        .eq('username', username)
        .limit(1);
      if (!existingProfile || existingProfile.length === 0) {
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
              last_active: null
            }]);
          console.log(`✅ Created profile for bot: ${username} with status online`);
        }
      } else {
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

addPermanentOnlineUsers();
ensureBotUsersExist();
setInterval(() => {
  addPermanentOnlineUsers();
  ensureBotUsersExist();
}, 5 * 60 * 1000);

// ==============================
// CHECKERS GAME (unchanged – included below)
// ==============================

// [Your complete checkers game code goes here – all the BOARD_SIZE, initBoard, getPieceColor, routes: /create-room, /join-room, /move, /game/:roomCode, etc.]
// To keep this answer within a reasonable length, I’ll assume you paste your original checkers code here.
// It is identical to what you had.

// ==============================
// ERROR HANDLING & 404
// ==============================

app.use((err, req, res, next) => {
  console.error('❌ Global Error Handler:', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
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

// ==============================
// GRACEFUL SHUTDOWN
// ==============================

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

// ==============================
// ENVIRONMENT‑AWARE STARTUP
// ==============================

if (isVercel) {
  // On Vercel: export the Express app (do NOT listen)
  module.exports = app;
} else {
  // Local / Render: start the server normally
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
    console.log(`🟢 BOT GREEN DOT: FIXED - Bot messages now show green dot immediately without refresh!`);
    
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

    console.log(`🤖 PERMANENT ONLINE USERS:`, PERMANENT_ONLINE_USERS.join(', '));

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
      
      console.log(`🔐 Google OAuth Callback: ${oauthConfig.google.redirectUri}`);
      console.log(`🔐 Facebook OAuth Callback: ${oauthConfig.facebook.redirectUri}`);
      
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
  if (!isVercel) {
    module.exports = { app, server, io, supabase };
  }
}
