// ===== api/index.js – Complete backend code =====

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

// ===== Initialize =====
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// ===== Detect environment =====
const isVercel = !!process.env.VERCEL;
const isRender = process.env.RENDER === 'true';
const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;

// ===== Socket.io – forced polling for maximum compatibility =====
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], credentials: false },
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

// ===== Online users tracking =====
const onlineUsers = new Map();
const onlineStatusTimeout = 300000; // 5 minutes
const PERMANENT_ONLINE_USERS = ['AI', 'Bot'];

// ===== Supabase =====
const supabase = createClient(
  'https://rqissetffrnkfzfgsngm.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXNzZXRmZnJua2Z6ZmdzbmdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxNzU2NzIsImV4cCI6MjA3NDc1MTY3Mn0.6tCuI4yhn3EXlua9na4kkgMqX6PL00GxjEuY0QG2bTg',
  { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
);

// ===== Multer =====
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|gif|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only images are allowed'));
  }
});

// ===== Middleware =====
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','Accept'], credentials: false, maxAge: 86400 }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static('public'));

// ===== Config =====
global.GoatBot = { config };
global.utils = {
  log: { info: (...a) => console.log("[INFO]", ...a), err: (...a) => console.error("[ERROR]", ...a) },
  getText: () => "✅ Bot is running smoothly"
};

// ===== Helper =====
function hashPassword(password) {
  return crypto.createHash('sha256').update(password + (process.env.JWT_SECRET || 'your-super-secret-jwt-key')).digest('hex');
}
function generateToken(user) {
  return Buffer.from(`${user.id}:${user.username}:${Date.now()}`).toString('base64');
}
function verifyTokenSimple(token) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('ascii');
    const [userId, username, timestamp] = decoded.split(':');
    if (!userId || !username || !timestamp) return null;
    if (Date.now() - parseInt(timestamp) > 30 * 24 * 60 * 60 * 1000) return null;
    return { id: userId, username, timestamp: parseInt(timestamp) };
  } catch { return null; }
}
function escapeHtml(unsafe) {
  return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}
function getPieceColor(piece) { if (piece === 1 || piece === 3) return 'white'; if (piece === 2 || piece === 4) return 'black'; return null; }
function isKing(piece) { return piece === 3 || piece === 4; }
function isValidCoord(row, col) { return row >= 0 && row < 8 && col >= 0 && col < 8; }
function initBoard() {
  const board = Array(8).fill().map(() => Array(8).fill(0));
  for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r][c] = 2;
  for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) board[r][c] = 1;
  return board;
}
function getMoveDirs(piece) {
  if (piece === 1) return [[-1,-1],[-1,1]];
  if (piece === 2) return [[1,-1],[1,1]];
  if (piece === 3 || piece === 4) return [[-1,-1],[-1,1],[1,-1],[1,1]];
  return [];
}
function getAllMoves(board, turn) {
  const moves = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const piece = board[r][c];
    if (piece === 0 || getPieceColor(piece) !== turn) continue;
    const dirs = getMoveDirs(piece);
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (isValidCoord(nr, nc) && board[nr][nc] === 0) moves.push({ from: [r,c], to: [nr,nc], capture: false });
    }
    for (const [dr, dc] of dirs) {
      const mr = r + dr, mc = c + dc, jr = r + dr*2, jc = c + dc*2;
      if (isValidCoord(jr, jc) && board[jr][jc] === 0 && board[mr][mc] !== 0 && getPieceColor(board[mr][mc]) !== turn)
        moves.push({ from: [r,c], to: [jr,jc], capture: true, captured: [mr,mc] });
    }
  }
  return moves;
}
function isValidMove(board, fromR, fromC, toR, toC, turn) {
  const piece = board[fromR][fromC];
  if (piece === 0 || getPieceColor(piece) !== turn) return false;
  const dirs = getMoveDirs(piece);
  for (const [dr, dc] of dirs) if (fromR+dr === toR && fromC+dc === toC && board[toR][toC] === 0) return true;
  for (const [dr, dc] of dirs) {
    const mr = fromR+dr, mc = fromC+dc, jr = fromR+dr*2, jc = fromC+dc*2;
    if (jr === toR && jc === toC && isValidCoord(jr, jc) && board[jr][jc] === 0 && board[mr][mc] !== 0 && getPieceColor(board[mr][mc]) !== turn)
      return true;
  }
  return false;
}
function applyMove(board, fromR, fromC, toR, toC) {
  const newBoard = board.map(row => [...row]);
  const piece = newBoard[fromR][fromC];
  newBoard[toR][toC] = piece;
  newBoard[fromR][fromC] = 0;
  let captured = null;
  if (Math.abs(toR - fromR) === 2) {
    const midR = (fromR+toR)/2, midC = (fromC+toC)/2;
    captured = newBoard[midR][midC];
    newBoard[midR][midC] = 0;
  }
  let promoted = false;
  if ((piece === 1 && toR === 0) || (piece === 2 && toR === 7)) {
    newBoard[toR][toC] = piece === 1 ? 3 : 4;
    promoted = true;
  }
  return { newBoard, captured, promoted };
}
function hasCapture(board, turn) {
  return getAllMoves(board, turn).some(m => m.capture);
}
function checkWinner(board) {
  let white = false, black = false;
  for (let r=0; r<8; r++) for (let c=0; c<8; c++) {
    const p = board[r][c];
    if (p === 1 || p === 3) white = true;
    if (p === 2 || p === 4) black = true;
  }
  if (!white) return 'black';
  if (!black) return 'white';
  if (getAllMoves(board, 'white').length === 0) return 'black';
  if (getAllMoves(board, 'black').length === 0) return 'white';
  return null;
}
function getPrivateChatRoomName(u1, u2) {
  const users = [u1, u2].sort();
  return `private_chat_${users[0]}_${users[1]}`;
}
function isNewUser(createdAt) {
  if (!createdAt) return false;
  return (Date.now() - new Date(createdAt).getTime()) / (1000*60*60*24) <= 7;
}
function extractImageUrlFromMessage(msg) {
  if (!msg) return null;
  if (msg.image_url && typeof msg.image_url === 'string' && msg.image_url.trim()) return msg.image_url;
  if (msg.attachments) {
    try {
      const atts = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments;
      if (Array.isArray(atts)) {
        const img = atts.find(a => a.type === 'photo' || a.type === 'image' || (a.url && /\.(jpg|jpeg|png|gif|webp)/i.test(a.url)));
        if (img && img.url) return img.url;
      }
    } catch {}
  }
  if (msg.content) {
    const match = msg.content.match(/https?:\/\/[^\s]+/i);
    if (match) return match[0];
  }
  return null;
}
function validateHumanName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 2 || name.length > 50) return false;
  if (!/^[a-zA-Z\s\.\-\']+$/.test(name)) return false;
  if (!/[aeiouAEIOU]/.test(name)) return false;
  if (/(.)\1{3,}/.test(name)) return false;
  return true;
}

// ===== Bot users =====
function addPermanentOnlineUsers() {
  const now = Date.now();
  PERMANENT_ONLINE_USERS.forEach(u => {
    onlineUsers.set(u, { socketId: 'permanent-bot-socket', username: u, lastSeen: now, isOnline: true });
  });
  io.emit('user-status-change', { username: 'SYSTEM', status: 'online', onlineUsers: Array.from(onlineUsers.keys()) });
}
function ensureBotOnline(botUsername) {
  if (!PERMANENT_ONLINE_USERS.includes(botUsername)) return;
  const existing = onlineUsers.get(botUsername);
  if (!existing || !existing.isOnline) {
    onlineUsers.set(botUsername, { socketId: 'permanent-bot-socket', username: botUsername, lastSeen: Date.now(), isOnline: true });
    io.emit('user-status-change', { username: botUsername, status: 'online', onlineUsers: Array.from(onlineUsers.keys()) });
  }
}
async function ensureBotUsersExist() {
  for (const u of PERMANENT_ONLINE_USERS) {
    const { data: existing } = await supabase.from('users').select('id').eq('username', u).limit(1);
    if (!existing || existing.length === 0) {
      await supabase.from('users').insert([{ username: u, password_hash: hashPassword('bot-placeholder'), auth_provider: 'local', created_at: new Date().toISOString(), last_login: new Date().toISOString(), is_active: true, avatar_url: `https://i.pravatar.cc/150?u=${u}`, banned: false }]);
    }
    const { data: profile } = await supabase.from('user_profiles').select('id').eq('username', u).limit(1);
    if (!profile || profile.length === 0) {
      const { data: user } = await supabase.from('users').select('id').eq('username', u).single();
      if (user) await supabase.from('user_profiles').insert([{ user_id: user.id, username: u, display_name: u, avatar_url: `https://i.pravatar.cc/150?u=${u}`, status: 'online', last_active: null }]);
    } else {
      await supabase.from('user_profiles').update({ status: 'online', last_active: null }).eq('username', u);
    }
  }
}
addPermanentOnlineUsers();
ensureBotUsersExist();
setInterval(() => { addPermanentOnlineUsers(); ensureBotUsersExist(); }, 5 * 60 * 1000);

// ===== OAuth config =====
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

// ===== Token verification middleware =====
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
    const old = Buffer.from(token, 'base64').toString('ascii');
    const [username, timestamp] = old.split(':');
    if (!username) return res.status(401).json({ success: false, error: "Invalid token" });
    if (Date.now() - parseInt(timestamp) > 30 * 24 * 60 * 60 * 1000) return res.status(401).json({ success: false, error: "Token expired" });
    supabase.from('users').select('*').ilike('username', username).limit(1).then(({ data, error }) => {
      if (error || !data || data.length === 0) return res.status(401).json({ success: false, error: "User not found" });
      req.user = { id: data[0].id, username: data[0].username, email: data[0].email, auth_provider: data[0].auth_provider };
      next();
    }).catch(() => res.status(401).json({ success: false, error: "Invalid token" }));
  } catch {
    res.status(401).json({ success: false, error: "Invalid token" });
  }
}

// ===== Routes =====

// Root – serves index.html with dynamic meta
app.get('/', async (req, res) => {
  try {
    const postId = req.query.post;
    let meta = { title: 'MessageMate', description: 'Chat smarter with MessageMate – Hassan powered messaging companion.', image: 'https://i.ibb.co/p6LrrNRK/1746227326721.jpg', url: req.protocol + '://' + req.get('host') };
    if (postId) {
      const { data: post } = await supabase.from('posts').select('*').eq('id', postId).single();
      if (post) {
        meta.title = `Post by ${post.author_username}`;
        meta.description = post.content.substring(0, 200);
        meta.url += `/?post=${postId}`;
        if (post.media_url && post.media_type === 'image') meta.image = post.media_url;
      }
    }
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    let html = await fs.readFile(htmlPath, 'utf8');
    const metaTags = `<meta property="og:title" content="${escapeHtml(meta.title)}" /><meta property="og:description" content="${escapeHtml(meta.description)}" /><meta property="og:image" content="${escapeHtml(meta.image)}" /><meta property="og:url" content="${escapeHtml(meta.url)}" /><meta property="og:type" content="article" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${escapeHtml(meta.title)}" /><meta name="twitter:description" content="${escapeHtml(meta.description)}" />`;
    html = html.replace(/<!-- POST_META_START -->[\s\S]*?<!-- POST_META_END -->/, `<!-- POST_META_START -->\n${metaTags}\n<!-- POST_META_END -->`);
    res.send(html);
  } catch (err) { res.sendFile(path.join(__dirname, 'public', 'index.html')); }
});

// ===== AUTHENTICATION =====
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username and password required" });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ success: false, error: "Username 3-20 chars" });
    if (password.length < 4 || password.length > 20) return res.status(400).json({ success: false, error: "Password 4-20 chars" });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ success: false, error: "Username letters, numbers, underscore" });
    const { data: existing } = await supabase.from('users').select('username').ilike('username', username);
    if (existing && existing.length > 0) return res.status(409).json({ success: false, error: "Username already exists" });
    const hashed = hashPassword(password);
    const { data: newUser, error: createError } = await supabase.from('users').insert([{ username: username.trim(), password_hash: hashed, email: email || null, auth_provider: 'local', created_at: new Date().toISOString(), last_login: new Date().toISOString(), is_active: true, avatar_url: `https://i.pravatar.cc/150?u=${username}`, banned: false }]).select();
    if (createError) throw createError;
    const token = generateToken(newUser[0]);
    await supabase.from('user_profiles').insert([{ user_id: newUser[0].id, username, display_name: username, avatar_url: `https://i.pravatar.cc/150?u=${username}`, status: 'online' }]);
    res.status(201).json({ success: true, message: "User registered", username, user_id: newUser[0].id, token, auth_provider: 'local' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
app.post('/api/auth/register', async (req, res) => { // alias
  try {
    const { username, password, email } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username and password required" });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ success: false, error: "Username 3-20 chars" });
    if (password.length < 4 || password.length > 20) return res.status(400).json({ success: false, error: "Password 4-20 chars" });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ success: false, error: "Username letters, numbers, underscore" });
    const { data: existing } = await supabase.from('users').select('username').ilike('username', username);
    if (existing && existing.length > 0) return res.status(409).json({ success: false, error: "Username already exists" });
    const hashed = hashPassword(password);
    const { data: newUser, error: createError } = await supabase.from('users').insert([{ username: username.trim(), password_hash: hashed, email: email || null, auth_provider: 'local', created_at: new Date().toISOString(), last_login: new Date().toISOString(), is_active: true, avatar_url: `https://i.pravatar.cc/150?u=${username}`, banned: false }]).select();
    if (createError) throw createError;
    const token = generateToken(newUser[0]);
    await supabase.from('user_profiles').insert([{ user_id: newUser[0].id, username, display_name: username, avatar_url: `https://i.pravatar.cc/150?u=${username}`, status: 'online' }]);
    res.status(201).json({ success: true, message: "User registered", username, user_id: newUser[0].id, token, auth_provider: 'local' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username and password required" });
    const { data: users, error } = await supabase.from('users').select('*').ilike('username', username).limit(1);
    if (error || !users || users.length === 0) return res.status(401).json({ success: false, error: "Invalid credentials" });
    const user = users[0];
    if (user.banned) return res.status(403).json({ success: false, error: "Account banned" });
    if (user.auth_provider !== 'local' && !user.password_hash) return res.status(401).json({ success: false, error: `This account uses ${user.auth_provider}. Please sign in with ${user.auth_provider}.` });
    if (hashPassword(password) !== user.password_hash) return res.status(401).json({ success: false, error: "Invalid credentials" });
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    const token = generateToken(user);
    res.json({ success: true, message: "Login successful", username: user.username, user_id: user.id, token, auth_provider: user.auth_provider });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
app.post('/api/auth/login', async (req, res) => { // alias
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: "Username and password required" });
    const { data: users, error } = await supabase.from('users').select('*').ilike('username', username).limit(1);
    if (error || !users || users.length === 0) return res.status(401).json({ success: false, error: "Invalid credentials" });
    const user = users[0];
    if (user.banned) return res.status(403).json({ success: false, error: "Account banned" });
    if (user.auth_provider !== 'local' && !user.password_hash) return res.status(401).json({ success: false, error: `This account uses ${user.auth_provider}. Please sign in with ${user.auth_provider}.` });
    if (hashPassword(password) !== user.password_hash) return res.status(401).json({ success: false, error: "Invalid credentials" });
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    const token = generateToken(user);
    res.json({ success: true, message: "Login successful", username: user.username, user_id: user.id, token, auth_provider: user.auth_provider });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ available: true });
    const { data } = await supabase.from('users').select('username').ilike('username', username).limit(1);
    res.json({ available: !data || data.length === 0 });
  } catch { res.json({ available: true }); }
});
app.post('/api/auth/check-username', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.json({ available: true });
    const { data } = await supabase.from('users').select('username').ilike('username', username).limit(1);
    res.json({ available: !data || data.length === 0 });
  } catch { res.json({ available: true }); }
});

app.post('/api/auth/auto-login', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: users, error } = await supabase.from('users').select('*').eq('id', userId).limit(1);
    if (error || !users || users.length === 0) return res.status(401).json({ success: false, error: "User not found" });
    const user = users[0];
    if (user.banned) return res.status(403).json({ success: false, error: "Account banned" });
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    res.json({ success: true, message: "Auto-login successful", username: user.username, user_id: user.id, email: user.email, auth_provider: user.auth_provider, avatar_url: user.avatar_url });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/auth/oauth-info', (req, res) => {
  res.json({
    success: true,
    google: { enabled: !!oauthConfig.google.clientId, clientId: oauthConfig.google.clientId, redirectUri: oauthConfig.google.redirectUri },
    facebook: { enabled: !!oauthConfig.facebook.clientId, redirectUri: oauthConfig.facebook.redirectUri },
    endpoints: { google: { auth: '/api/auth/google', callback: '/api/auth/google/callback' }, facebook: { auth: '/api/auth/facebook', callback: '/api/auth/facebook/callback' } }
  });
});

app.get('/api/auth/google', (req, res) => {
  if (!oauthConfig.google.clientId) return res.status(400).json({ success: false, error: "Google OAuth not configured" });
  const url = new URL(oauthConfig.google.authUrl);
  url.searchParams.append('client_id', oauthConfig.google.clientId);
  url.searchParams.append('redirect_uri', oauthConfig.google.redirectUri);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', 'profile email');
  url.searchParams.append('access_type', 'offline');
  url.searchParams.append('prompt', 'consent');
  res.json({ success: true, auth_url: url.toString() });
});
app.get('/api/auth/facebook', (req, res) => {
  if (!oauthConfig.facebook.clientId) return res.status(400).json({ success: false, error: "Facebook OAuth not configured" });
  const url = new URL(oauthConfig.facebook.authUrl);
  url.searchParams.append('client_id', oauthConfig.facebook.clientId);
  url.searchParams.append('redirect_uri', oauthConfig.facebook.redirectUri);
  url.searchParams.append('response_type', 'code');
  url.searchParams.append('scope', 'email,public_profile');
  url.searchParams.append('state', crypto.randomBytes(16).toString('hex'));
  res.json({ success: true, auth_url: url.toString() });
});

async function handleOAuthCallback(provider, code) {
  let tokenResponse, userInfo;
  if (provider === 'google') {
    tokenResponse = await axios.post(oauthConfig.google.tokenUrl, {
      client_id: oauthConfig.google.clientId,
      client_secret: oauthConfig.google.clientSecret,
      code, redirect_uri: oauthConfig.google.redirectUri, grant_type: 'authorization_code'
    });
    userInfo = await axios.get(oauthConfig.google.userInfoUrl, { headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` } });
  } else if (provider === 'facebook') {
    tokenResponse = await axios.get(oauthConfig.facebook.tokenUrl, {
      params: { client_id: oauthConfig.facebook.clientId, client_secret: oauthConfig.facebook.clientSecret, code, redirect_uri: oauthConfig.facebook.redirectUri }
    });
    userInfo = await axios.get(oauthConfig.facebook.userInfoUrl, {
      params: { fields: 'id,name,email,picture.type(large),first_name,last_name', access_token: tokenResponse.data.access_token }
    });
  }
  const providerUser = userInfo.data;
  const providerId = providerUser.id;
  const { data: existing } = await supabase.from('users').select('*').eq('auth_provider', provider).eq('provider_id', providerId).limit(1);
  let user;
  if (existing && existing.length > 0) {
    user = existing[0];
    await supabase.from('users').update({ last_login: new Date().toISOString(), avatar_url: provider === 'google' ? providerUser.picture : (providerUser.picture?.data?.url || user.avatar_url) }).eq('id', user.id);
  } else {
    let username = providerUser.email ? providerUser.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g,'_').toLowerCase() : `user_${Math.random().toString(36).substr(2,6)}`;
    let orig = username, counter = 1;
    while (true) {
      const { data: check } = await supabase.from('users').select('username').eq('username', username).limit(1);
      if (!check || check.length === 0) break;
      username = `${orig}_${counter++}`;
    }
    const userData = {
      username, email: providerUser.email || null, email_verified: provider === 'google' ? (providerUser.verified_email || false) : true,
      auth_provider: provider, provider_id: providerId, provider_data: providerUser,
      avatar_url: provider === 'google' ? providerUser.picture : (providerUser.picture?.data?.url || null),
      created_at: new Date().toISOString(), last_login: new Date().toISOString(), is_active: true, banned: false
    };
    const { data: newUser, error } = await supabase.from('users').insert([userData]).select();
    if (error) throw error;
    user = newUser[0];
    const profileData = {
      user_id: user.id, username, display_name: provider === 'google' ? providerUser.name : providerUser.name,
      avatar_url: user.avatar_url, firstname: provider === 'google' ? providerUser.given_name : providerUser.first_name,
      lastname: provider === 'google' ? providerUser.family_name : providerUser.last_name, bio: '', status: 'online'
    };
    await supabase.from('user_profiles').insert([profileData]);
  }
  const token = generateToken(user);
  return { success: true, user, token };
}

app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) throw new Error(`Google OAuth error: ${error}`);
    if (!code) return res.status(400).json({ success: false, error: "Authorization code required" });
    const result = await handleOAuthCallback('google', code);
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    if (!result.success) return res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(result.error)}`);
    res.redirect(`${frontendUrl}/auth/callback?token=${result.token}&username=${result.user.username}&provider=google`);
  } catch (err) {
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(err.message)}`);
  }
});
app.get('/api/auth/facebook/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) throw new Error(`Facebook OAuth error: ${error}`);
    if (!code) return res.status(400).json({ success: false, error: "Authorization code required" });
    const result = await handleOAuthCallback('facebook', code);
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    if (!result.success) return res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(result.error)}`);
    res.redirect(`${frontendUrl}/auth/callback?token=${result.token}&username=${result.user.username}&provider=facebook`);
  } catch (err) {
    const frontendUrl = process.env.FRONTEND_URL || (isRender ? renderExternalUrl : `http://localhost:${port}`);
    res.redirect(`${frontendUrl}/auth/callback?error=${encodeURIComponent(err.message)}`);
  }
});

app.post('/api/auth/link-account', verifyToken, async (req, res) => {
  try {
    const { provider, code } = req.body;
    const userId = req.user.id;
    if (!provider || !code) return res.status(400).json({ success: false, error: "Provider and code required" });
    const result = await handleOAuthCallback(provider, code);
    if (!result.success) return res.status(400).json({ success: false, error: result.error });
    const { data: existing } = await supabase.from('users').select('id').eq('auth_provider', provider).eq('provider_id', result.user.provider_id).neq('id', userId).limit(1);
    if (existing && existing.length > 0) return res.status(409).json({ success: false, error: `This ${provider} account is already linked to another user` });
    await supabase.from('users').update({ auth_provider: provider, provider_id: result.user.provider_id, provider_data: result.user.provider_data, avatar_url: result.user.avatar_url, email_verified: result.user.email_verified || false, updated_at: new Date().toISOString() }).eq('id', userId);
    const newToken = generateToken({ ...req.user, auth_provider: provider });
    res.json({ success: true, message: `${provider} linked`, auth_provider: provider, token: newToken });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/api/auth/unlink-account', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { data: user } = await supabase.from('users').select('password_hash').eq('id', userId).limit(1);
    if (!user || user.length === 0) return res.status(404).json({ success: false, error: "User not found" });
    if (!user[0].password_hash) return res.status(400).json({ success: false, error: "Cannot unlink. Set a password first." });
    await supabase.from('users').update({ auth_provider: 'local', provider_id: null, provider_data: null, updated_at: new Date().toISOString() }).eq('id', userId);
    const newToken = generateToken({ ...req.user, auth_provider: 'local' });
    res.json({ success: true, message: "Account unlinked", auth_provider: 'local', token: newToken });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/api/auth/set-password', verifyToken, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ success: false, error: "Password required" });
    if (password.length < 4 || password.length > 20) return res.status(400).json({ success: false, error: "Password 4-20 chars" });
    const hashed = hashPassword(password);
    await supabase.from('users').update({ password_hash: hashed, updated_at: new Date().toISOString() }).eq('id', req.user.id);
    res.json({ success: true, message: "Password set" });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== PROFILE =====
app.get('/api/user/profile', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    const { data: users, error: ue } = await supabase.from('users').select('id, username, email, auth_provider, created_at, last_login, avatar_url, provider_data, banned').ilike('username', username).limit(1);
    if (ue || !users || users.length === 0) return res.status(404).json({ success: false, error: "User not found" });
    const user = users[0];
    const { data: profiles } = await supabase.from('user_profiles').select('*').eq('username', username).limit(1);
    const profile = profiles && profiles.length > 0 ? profiles[0] : {};
    const completeProfile = {
      username, email: user.email, user_id: user.id, auth_provider: user.auth_provider || 'local',
      created_at: user.created_at, last_login: user.last_login, avatar_url: user.avatar_url, provider_data: user.provider_data, banned: user.banned || false,
      firstname: profile.firstname || '', lastname: profile.lastname || '', bio: profile.bio || '', age: profile.age || null,
      gender: profile.gender || '', location: profile.location || '', interests: profile.interests || '',
      avatar: profile.avatar_url || user.avatar_url || `https://i.pravatar.cc/150?u=${username}`,
      display_name: profile.display_name || username, status: profile.status || 'online',
      profile_created_at: profile.created_at || new Date().toISOString(), profile_updated_at: profile.updated_at || new Date().toISOString()
    };
    res.json({ success: true, profile: completeProfile });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.put('/api/user/profile', verifyToken, async (req, res) => { await updateProfileHandler(req, res); });
app.post('/api/user/profile', verifyToken, async (req, res) => { await updateProfileHandler(req, res); });
async function updateProfileHandler(req, res) {
  try {
    const username = req.user.username;
    const profileData = req.body;
    if (profileData.display_name && !validateHumanName(profileData.display_name))
      return res.status(400).json({ success: false, error: "Invalid display name" });
    const { data: users } = await supabase.from('users').select('id').ilike('username', username).limit(1);
    if (!users || users.length === 0) return res.status(404).json({ success: false, error: "User not found" });
    const userId = users[0].id;
    const { data: existing } = await supabase.from('user_profiles').select('id').eq('username', username).limit(1);
    const now = new Date().toISOString();
    const profileUpdate = {
      username, user_id: userId, display_name: profileData.display_name || username,
      avatar_url: profileData.avatar || profileData.avatar_url || `https://i.pravatar.cc/150?u=${username}`,
      bio: profileData.bio || '', location: profileData.location || '', firstname: profileData.firstname || '',
      lastname: profileData.lastname || '', age: profileData.age || null, gender: profileData.gender || '',
      interests: profileData.interests || '', status: 'online', updated_at: now
    };
    let result;
    if (existing && existing.length > 0) {
      result = await supabase.from('user_profiles').update(profileUpdate).eq('username', username).select();
    } else {
      result = await supabase.from('user_profiles').insert([{ ...profileUpdate, created_at: now }]).select();
    }
    if (result.error) throw result.error;
    const saved = result.data[0];
    res.json({ success: true, message: "Profile updated", profile: { ...saved, avatar: saved.avatar_url || `https://i.pravatar.cc/150?u=${username}` } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
}
app.get('/api/user/profile/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (PERMANENT_ONLINE_USERS.includes(username)) {
      return res.json({ success: true, profile: { username, firstname: '', lastname: '', bio: '', age: null, gender: '', location: '', interests: '', avatar: `https://i.pravatar.cc/150?u=${username}`, display_name: username, status: 'online', last_active: null, last_seen: null } });
    }
    const { data: profiles } = await supabase.from('user_profiles').select('*').eq('username', username).limit(1);
    const profile = profiles && profiles.length > 0 ? profiles[0] : {};
    res.json({ success: true, profile: { ...profile, avatar: profile.avatar_url || `https://i.pravatar.cc/150?u=${username}` } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== IMAGE UPLOAD =====
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    const fileBuffer = req.file.buffer;
    const fileName = `${Date.now()}-${req.file.originalname}`;
    const filePath = `images/${fileName}`;
    const { error } = await supabase.storage.from('chat_images').upload(filePath, fileBuffer, { contentType: req.file.mimetype, upsert: false });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('chat_images').getPublicUrl(filePath);
    res.json({ imageUrl: urlData.publicUrl, message: 'Uploaded' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== MESSAGES =====
app.get('/api/messages', async (req, res) => {
  try {
    const { data: messages, error } = await supabase.from('chatter').select('id, content, username, created_at, image_url, reply_to').order('created_at', { ascending: false });
    if (error) throw error;
    const usernames = [...new Set(messages.map(m => m.username))];
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
    const { content, username, image_url, reply_to } = req.body;
    if ((!content || content.trim() === '') && !image_url) return res.status(400).json({ error: "Content or image required" });
    if (!username) return res.status(400).json({ error: "Username required" });
    const { data: user } = await supabase.from('users').select('banned').ilike('username', username).limit(1).single();
    if (user && user.banned) {
      const banMsg = `🚫 User @${username} has been banned.`;
      const { data: sysMsg } = await supabase.from('chatter').insert([{ content: banMsg, username: 'System', created_at: new Date().toISOString() }]).select();
      if (sysMsg) io.emit('new-message', sysMsg[0]);
      return res.status(403).json({ error: "You are banned." });
    }
    const insertData = {
      content: (content && content.trim()) ? content.trim() : '',
      username: username.trim(),
      image_url: image_url || '',
      reply_to: reply_to || '',
      created_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from('chatter').insert([insertData]).select();
    if (error) throw error;
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/messages/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const username = req.user.username;
    const { data: msg } = await supabase.from('chatter').select('username').eq('id', id).single();
    if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
    if (username !== 'Admin0' && msg.username !== username) return res.status(403).json({ success: false, error: 'You can only delete your own messages' });
    await supabase.from('chatter').delete().eq('id', id);
    io.emit('message-deleted', id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/api/messages/:id', async (req, res) => {
  try {
    const { data, error } = await supabase.from('chatter').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: 'Not found' });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/messages/:id', async (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });
    const { data, error } = await supabase.from('chatter').update({ content, updated_at: new Date().toISOString() }).eq('id', req.params.id).select();
    if (error) throw error;
    io.emit('message-updated', data[0]);
    res.json(data[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== PRIVATE MESSAGES =====
app.get('/api/private/conversations', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: "Username required" });
    const { data: messages, error } = await supabase.from('private_messages').select('*').or(`sender_username.eq.${username},receiver_username.eq.${username}`).order('created_at', { ascending: false });
    if (error) throw error;
    const convMap = new Map();
    (messages || []).forEach(msg => {
      const other = msg.sender_username === username ? msg.receiver_username : msg.sender_username;
      if (!convMap.has(other) || new Date(msg.created_at) > new Date(convMap.get(other).lastMessageTime)) {
        convMap.set(other, {
          username: other,
          lastMessage: msg.content,
          lastMessageTime: msg.created_at,
          unread: msg.receiver_username === username && !msg.read,
          isSender: msg.sender_username === username
        });
      }
    });
    const result = Array.from(convMap.values()).sort((a,b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/private/messages/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { otherUser } = req.query;
    if (!otherUser) return res.status(400).json({ error: "otherUser required" });
    const { data, error } = await supabase.from('private_messages').select('*').or(`and(sender_username.eq.${username},receiver_username.eq.${otherUser}),and(sender_username.eq.${otherUser},receiver_username.eq.${username})`).order('created_at', { ascending: true });
    if (error) throw error;
    await supabase.from('private_messages').update({ read: true }).eq('receiver_username', username).eq('sender_username', otherUser).eq('read', false);
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/private/messages', async (req, res) => {
  try {
    const { sender_username, receiver_username, content, image_url } = req.body;
    if (!sender_username || !receiver_username) return res.status(400).json({ error: "Sender and receiver required" });
    if ((!content || content.trim() === '') && !image_url) return res.status(400).json({ error: "Content or image required" });
    const { data: sender } = await supabase.from('users').select('banned').ilike('username', sender_username).limit(1).single();
    if (sender && sender.banned) return res.status(403).json({ error: "You are banned." });
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
    const insertData = {
      sender_username: sender_username.trim(),
      receiver_username: receiver_username.trim(),
      content: content ? content.trim() : '',
      image_url: image_url || '',
      read: false,
      created_at: new Date().toISOString(),
      message_id: messageId
    };
    const { data, error } = await supabase.from('private_messages').insert([insertData]).select();
    if (error) throw error;
    const responseData = { ...data[0], custom_message_id: messageId };
    io.to(receiver_username).emit('new-private-message', responseData);
    io.to(sender_username).emit('private-message-sent', responseData);
    res.status(201).json({ success: true, data: responseData, custom_message_id: messageId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/private/unread', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: "Username required" });
    const { count, error } = await supabase.from('private_messages').select('*', { count: 'exact', head: true }).eq('receiver_username', username).eq('read', false);
    if (error) throw error;
    res.json({ unreadCount: count || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.put('/api/private/messages/read', async (req, res) => {
  try {
    const { sender_username, receiver_username } = req.body;
    if (!sender_username || !receiver_username) return res.status(400).json({ error: "Sender and receiver required" });
    await supabase.from('private_messages').update({ read: true }).eq('sender_username', sender_username).eq('receiver_username', receiver_username).eq('read', false);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== USERS =====
app.get('/api/users/all', async (req, res) => {
  try {
    const { data: users, error: ue } = await supabase.from('users').select('id, username, email, auth_provider, created_at, last_login, avatar_url, provider_data, banned').order('created_at', { ascending: false });
    if (ue) throw ue;
    if (!users || users.length === 0) return res.json({ success: true, users: [] });
    const usernames = users.map(u => u.username);
    const { data: profiles } = await supabase.from('user_profiles').select('*').in('username', usernames);
    const profileMap = {};
    if (profiles) profiles.forEach(p => { profileMap[p.username] = p; });
    const allUsers = users.map(user => {
      const p = profileMap[user.username] || {};
      const isBot = PERMANENT_ONLINE_USERS.includes(user.username);
      return {
        username: user.username, email: user.email || '', user_id: user.id, auth_provider: user.auth_provider || 'local',
        created_at: user.created_at, last_login: user.last_login, avatar_url: user.avatar_url, provider_data: user.provider_data, banned: user.banned || false,
        firstname: p.firstname || '', lastname: p.lastname || '', bio: p.bio || '', age: p.age || null, gender: p.gender || '',
        location: p.location || '', interests: p.interests || '',
        avatar: p.avatar_url || user.avatar_url || `https://i.pravatar.cc/150?u=${user.username}`,
        display_name: p.display_name || user.username,
        status: isBot ? 'online' : (p.status || 'offline'),
        last_seen: isBot ? null : (p.last_active || user.last_login),
        message_count: 0, post_count: 0,
        join_date: user.created_at, is_new_user: isNewUser(user.created_at)
      };
    });
    // get message counts
    const { data: msgCounts } = await supabase.from('chatter').select('username').in('username', usernames);
    if (msgCounts) {
      const countMap = {};
      msgCounts.forEach(m => { countMap[m.username] = (countMap[m.username]||0)+1; });
      allUsers.forEach(u => u.message_count = countMap[u.username] || 0);
    }
    // get post counts
    const { data: postCounts } = await supabase.from('posts').select('author_username').in('author_username', usernames);
    if (postCounts) {
      const countMap = {};
      postCounts.forEach(p => { countMap[p.author_username] = (countMap[p.author_username]||0)+1; });
      allUsers.forEach(u => u.post_count = countMap[u.username] || 0);
    }
    res.json({ success: true, users: allUsers, total_count: allUsers.length, new_users: allUsers.filter(u => u.is_new_user).length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/api/users/stats', async (req, res) => {
  try {
    const { count: total } = await supabase.from('users').select('*', { count: 'exact', head: true });
    const today = new Date(); today.setHours(0,0,0,0);
    const { count: newToday } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('created_at', today.toISOString());
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    const { count: active } = await supabase.from('users').select('*', { count: 'exact', head: true }).gte('last_login', yesterday.toISOString());
    res.json({ success: true, stats: { total_users: total||0, new_users_today: newToday||0, active_users_last_24h: active||0 } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/api/user/last-seen/:username', async (req, res) => {
  try {
    const { username } = req.params;
    if (PERMANENT_ONLINE_USERS.includes(username)) return res.json({ username, status: 'online', last_seen: null });
    const { data: profiles } = await supabase.from('user_profiles').select('last_active, status').eq('username', username).limit(1);
    const p = profiles && profiles.length > 0 ? profiles[0] : {};
    res.json({ username, status: p.status || 'offline', last_seen: p.last_active || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== AI =====
app.post('/api/ai/private', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    const response = await axios.get(`https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(message)}&cb=${Date.now()}`, { timeout: 15000 });
    let aiResponse;
    if (typeof response.data === 'string') {
      try { aiResponse = JSON.parse(response.data).response || response.data; } catch { aiResponse = response.data; }
    } else { aiResponse = response.data.response || response.data.message || response.data.data || JSON.stringify(response.data); }
    res.json({ reply: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });
    const response = await axios.get(`https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(message)}&cb=${Date.now()}`, { timeout: 15000 });
    let aiResponse;
    if (typeof response.data === 'string') {
      try { aiResponse = JSON.parse(response.data).response || response.data; } catch { aiResponse = response.data; }
    } else { aiResponse = response.data.response || response.data.message || response.data.data || JSON.stringify(response.data); }
    res.json({ reply: aiResponse });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== COMMAND HANDLER (with -prompt support) =====
const PREFIX = config.prefix || "!";
const commands = {};
const COMMANDS_DIR = path.join(__dirname, 'commands');
fs.ensureDirSync(COMMANDS_DIR);

function loadCommands() {
  Object.keys(require.cache).forEach(k => { if (k.startsWith(COMMANDS_DIR)) delete require.cache[k]; });
  const files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.js'));
  files.forEach(file => {
    try {
      const cmd = require(path.join(COMMANDS_DIR, file));
      if (cmd.config?.name) {
        commands[cmd.config.name] = cmd;
        if (cmd.config.aliases) cmd.config.aliases.forEach(a => commands[a] = cmd);
      }
    } catch (e) { console.error('Failed to load command:', file, e.message); }
  });
}
loadCommands();

function handleCommand(input) {
  if (!input.startsWith(PREFIX)) return null;
  const args = input.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();
  return { commandName: cmd, args, text: args.join(' ') };
}
async function saveBotResponseToSupabase(content, originalCommand, responder) {
  const username = responder === 'AI' ? 'AI' : 'Bot';
  const insertData = {
    content: content || `${responder} response`,
    username,
    image_url: '',
    reply_to: originalCommand || '',
    created_at: new Date().toISOString()
  };
  const { data, error } = await supabase.from('chatter').insert([insertData]).select();
  if (!error && data && data.length) {
    ensureBotOnline(username);
    const botMsg = data[0];
    botMsg.user_status = 'online';
    botMsg.last_seen = null;
    io.emit('new-message', botMsg);
    return data;
  }
  throw new Error(error?.message || 'Save failed');
}

// Helper for -prompt
async function handlePromptCommand(imageUrl, userPrompt) {
  const params = {};
  if (imageUrl) params.imageUrl = imageUrl;
  else if (userPrompt) {
    const clean = userPrompt.replace(/\s+/g,' ').trim();
    if (!clean || clean.length < 5) throw new Error("Text prompt too short. Example: 'a futuristic city at night'");
    params.userPrompt = clean;
  } else throw new Error("Provide image or text.");
  try {
    const response = await axios.get('https://theone-fast-image-gen.vercel.app/prompt', { params, timeout: 20000 });
    return response?.data?.prompt || 'No prompt generated';
  } catch (err) {
    if (err.response?.status === 422) throw new Error("Failed: make your text more descriptive and avoid symbols only.");
    throw new Error("Server error: " + err.message);
  }
}

app.post('/api/command', async (req, res) => {
  try {
    let { message, source = 'main-chat', reply_to, reply_image_url } = req.body;
    if (!message) return res.status(400).json({ reply: "❌ Message required" });

    // -prompt handling (any source)
    if (message.trim().startsWith('-prompt')) {
      const rest = message.trim().slice(7).trim();
      let imageUrl = reply_image_url || null;
      let userPrompt = null;
      if (!imageUrl && (rest.startsWith('http://') || rest.startsWith('https://'))) {
        const parts = rest.split(/\s+/);
        if (parts[0].startsWith('http://') || parts[0].startsWith('https://')) {
          imageUrl = parts[0];
        } else {
          userPrompt = rest;
        }
      } else if (rest) {
        userPrompt = rest;
      }
      if (!imageUrl && (!userPrompt || userPrompt.length === 0)) {
        return res.json({ reply: "❌ Please provide an image URL or a text description after -prompt." });
      }
      try {
        const prompt = await handlePromptCommand(imageUrl, userPrompt);
        return res.json({ reply: prompt });
      } catch (err) {
        return res.json({ reply: `❌ ${err.message}` });
      }
    }

    // Dash command conversion for private AI
    if (source === 'private-ai' && !message.startsWith(PREFIX) && message.trim().startsWith('-')) {
      const parts = message.trim().split(/\s+/);
      const dashCmd = parts[0].substring(1);
      if (commands[dashCmd]) {
        message = `${PREFIX}${dashCmd}${parts.slice(1).length ? ' ' + parts.slice(1).join(' ') : ''}`;
      } else {
        message = `${PREFIX}ai ${message}`;
      }
    } else if (source === 'private-ai' && !message.startsWith(PREFIX)) {
      const firstWord = message.trim().toLowerCase().split(' ')[0];
      if (['ai','help','ping','prefix','ask','chat'].includes(firstWord)) {
        message = PREFIX + message;
      } else {
        message = PREFIX + 'ai ' + message;
      }
    }

    // PREFIX command
    if (message.trim().toLowerCase() === 'prefix') {
      return res.json({ reply: `🔹 My prefix is: ${PREFIX}` });
    }

    const cmd = handleCommand(message);
    if (!cmd) return res.end();

    let finalReply = null;
    let responder = null;

    // AI command
    if (cmd.commandName === 'ai') {
      responder = 'AI';
      try {
        const resp = await axios.get(`https://yau-cener-gpt4-api.vercel.app/ai?prompt=${encodeURIComponent(cmd.text)}&cb=${Date.now()}`, { timeout: 15000 });
        finalReply = resp.data.response || resp.data.message || resp.data.data || (typeof resp.data === 'string' ? resp.data : '⚠️ Unknown AI response');
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
          imageUrl = reply_image_url;
        } else if (reply_to) {
          const { data } = await supabase.from('chatter').select('*').eq('id', reply_to).single();
          if (data) imageUrl = extractImageUrlFromMessage(data);
        }
        if (imageUrl) {
          event.messageReply = { messageID: reply_to || null, body: '', attachments: [{ type: "photo", url: imageUrl }], image_url: imageUrl };
        }
        await command.onStart({
          api: { sendMessage: (msg) => replies.push(typeof msg === 'string' ? msg : JSON.stringify(msg)), supabase, io },
          event,
          args: cmd.args,
          message: { reply: (content) => replies.push(content) }
        });
        finalReply = replies.join("\n") || "❌ No response";
      }
    }

    if (finalReply && source === 'main-chat') {
      try { await saveBotResponseToSupabase(finalReply, cmd.commandName, responder); } catch {}
    }

    return res.json({ reply: finalReply });

  } catch (error) {
    console.error("Command error:", error);
    res.status(500).json({ reply: "❌ Server error: " + error.message });
  }
});

// ===== POSTS =====
app.get('/api/create-posts-table', async (req, res) => {
  try {
    const { data: check, error } = await supabase.from('posts').select('*').limit(1);
    if (error && error.code === '42P01') {
      return res.json({ success: false, error: "Table doesn't exist", instructions: ["Run CREATE TABLE posts ..."] });
    }
    res.json({ success: true, message: "Posts table exists" });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/api/create-posts-table', async (req, res) => {
  // This is a placeholder – you need to create the table via SQL in Supabase dashboard.
  res.json({ success: false, message: "Please create posts, post_comments, post_likes tables using SQL in Supabase." });
});

app.get('/api/posts', async (req, res) => {
  try {
    const { username } = req.query;
    let query = supabase.from('posts').select('*').order('created_at', { ascending: false });
    if (!username) query = query.eq('visibility', 'public');
    const { data: posts, error } = await query;
    if (error) throw error;
    let filtered = posts;
    if (username) filtered = posts.filter(p => p.visibility === 'public' || p.author_username === username);
    const results = await Promise.all((filtered || []).map(async (post) => {
      const { data: comments } = await supabase.from('post_comments').select('*').eq('post_id', post.id).order('created_at', { ascending: true });
      let userLiked = false;
      if (username) {
        const { data: like } = await supabase.from('post_likes').select('id').eq('post_id', post.id).eq('username', username).single();
        userLiked = !!like;
      }
      return { ...post, comments: comments || [], userLiked, author: post.author_username, timestamp: post.created_at, likes: post.likes_count || 0, media: post.media_url ? { url: post.media_url, type: post.media_type || 'image' } : null };
    }));
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts', async (req, res) => {
  try {
    const { author_username, content, media_url, media_type } = req.body;
    if (!author_username || !content) return res.status(400).json({ error: "Author and content required" });
    const { data: author } = await supabase.from('users').select('banned').ilike('username', author_username).limit(1).single();
    if (author && author.banned) return res.status(403).json({ error: "You are banned." });
    const postData = { author_username: author_username.trim(), content: content.trim(), media_url: media_url || null, media_type: media_type || null, likes_count: 0, comments_count: 0, visibility: 'public' };
    const { data: post, error } = await supabase.from('posts').insert([postData]).select();
    if (error) throw error;
    res.status(201).json({ ...post[0], author: post[0].author_username, timestamp: post[0].created_at, likes: 0, comments: [], userLiked: false, media: post[0].media_url ? { url: post[0].media_url, type: post[0].media_type || 'image' } : null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts/:postId/comments', async (req, res) => {
  try {
    const { postId } = req.params;
    const { author_username, content } = req.body;
    if (!author_username || !content) return res.status(400).json({ error: "Author and content required" });
    const { data: post } = await supabase.from('posts').select('id').eq('id', postId).single();
    if (!post) return res.status(404).json({ error: "Post not found" });
    const { data: comment, error } = await supabase.from('post_comments').insert([{ post_id: postId, author_username: author_username.trim(), content: content.trim() }]).select();
    if (error) throw error;
    await supabase.from('posts').update({ comments_count: await getCommentsCount(postId) }).eq('id', postId);
    res.status(201).json(comment[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/posts/:postId/like', async (req, res) => {
  try {
    const { postId } = req.params;
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });
    const { data: post } = await supabase.from('posts').select('id').eq('id', postId).single();
    if (!post) return res.status(404).json({ error: "Post not found" });
    const { data: existing } = await supabase.from('post_likes').select('id').eq('post_id', postId).eq('username', username).single();
    if (existing) {
      await supabase.from('post_likes').delete().eq('id', existing.id);
    } else {
      await supabase.from('post_likes').insert([{ post_id: postId, username }]);
    }
    const newCount = await getLikesCount(postId);
    await supabase.from('posts').update({ likes_count: newCount, updated_at: new Date().toISOString() }).eq('id', postId);
    res.json({ success: true, likesCount: newCount, userLiked: !existing });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.delete('/api/posts/:postId', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const username = req.user.username;
    const { data: post } = await supabase.from('posts').select('author_username').eq('id', postId).single();
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.author_username !== username && username !== 'Admin0') return res.status(403).json({ error: "You can only delete your own posts" });
    await supabase.from('posts').delete().eq('id', postId);
    io.emit('post-deleted', postId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.patch('/api/posts/:postId/visibility', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { visibility } = req.body;
    const username = req.user.username;
    if (!['public','private'].includes(visibility)) return res.status(400).json({ error: "Invalid visibility" });
    const { data: post } = await supabase.from('posts').select('author_username').eq('id', postId).single();
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.author_username !== username) return res.status(403).json({ error: "Only author can change visibility" });
    const { data: updated } = await supabase.from('posts').update({ visibility, updated_at: new Date().toISOString() }).eq('id', postId).select();
    io.emit('post-visibility-changed', updated[0]);
    res.json({ success: true, visibility: updated[0].visibility });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function getCommentsCount(postId) {
  const { count, error } = await supabase.from('post_comments').select('*', { count: 'exact', head: true }).eq('post_id', postId);
  return count || 0;
}
async function getLikesCount(postId) {
  const { count, error } = await supabase.from('post_likes').select('*', { count: 'exact', head: true }).eq('post_id', postId);
  return count || 0;
}

app.get('/api/posts/user/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const { currentUser } = req.query;
    const { data: posts, error } = await supabase.from('posts').select('*').eq('author_username', username).order('created_at', { ascending: false });
    if (error) throw error;
    const results = await Promise.all((posts || []).map(async (post) => {
      const { data: comments } = await supabase.from('post_comments').select('*').eq('post_id', post.id).order('created_at', { ascending: true });
      let userLiked = false;
      if (currentUser) {
        const { data: like } = await supabase.from('post_likes').select('id').eq('post_id', post.id).eq('username', currentUser).single();
        userLiked = !!like;
      }
      return { ...post, comments: comments || [], userLiked, author: post.author_username, timestamp: post.created_at, likes: post.likes_count || 0, media: post.media_url ? { url: post.media_url, type: post.media_type || 'image' } : null };
    }));
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/posts/updates', async (req, res) => {
  try {
    const { lastUpdate } = req.query;
    let query = supabase.from('posts').select('*').order('updated_at', { ascending: false });
    if (lastUpdate) query = query.gt('updated_at', new Date(lastUpdate).toISOString());
    const { data, error } = await query;
    if (error) throw error;
    res.json({ success: true, posts: data || [], timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===== CHECKERS GAME ROUTES =====
app.post('/create-room', verifyToken, async (req, res) => {
  try {
    const username = req.user.username;
    const code = Math.random().toString(36).substring(2,8).toUpperCase();
    const { data: room, error: re } = await supabase.from('rooms').insert([{ code, status: 'waiting' }]).select();
    if (re) throw re;
    await supabase.from('players').insert([{ room_id: room[0].id, username, role: 'white' }]);
    const board = initBoard();
    await supabase.from('games').insert([{ room_id: room[0].id, board_state: board, current_turn: 'white' }]);
    res.json({ success: true, roomCode: code });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/join-room', verifyToken, async (req, res) => {
  try {
    const { roomCode } = req.body;
    const username = req.user.username;
    const { data: room, error: re } = await supabase.from('rooms').select('id, status').eq('code', roomCode).single();
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.status !== 'waiting') return res.status(400).json({ success: false, error: 'Room not available' });
    const { data: existing } = await supabase.from('players').select('id').eq('room_id', room.id).eq('username', username).single();
    if (existing) return res.status(400).json({ success: false, error: 'Already in room' });
    await supabase.from('players').insert([{ room_id: room.id, username, role: 'black' }]);
    await supabase.from('rooms').update({ status: 'playing' }).eq('id', room.id);
    res.json({ success: true, roomCode });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/move', verifyToken, async (req, res) => {
  try {
    const { roomCode, from, to } = req.body;
    const username = req.user.username;
    const [fromR, fromC] = from; const [toR, toC] = to;
    const { data: room } = await supabase.from('rooms').select('id, status').eq('code', roomCode).single();
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    if (room.status !== 'playing') return res.status(400).json({ success: false, error: 'Game not started' });
    const { data: players } = await supabase.from('players').select('username, role').eq('room_id', room.id);
    const player = players.find(p => p.username === username);
    if (!player) return res.status(403).json({ success: false, error: 'Not in game' });
    const { data: game } = await supabase.from('games').select('board_state, current_turn, winner').eq('room_id', room.id).single();
    if (game.winner) return res.status(400).json({ success: false, error: 'Game finished' });
    if (game.current_turn !== player.role) return res.status(403).json({ success: false, error: 'Not your turn' });
    const board = game.board_state;
    if (!isValidMove(board, fromR, fromC, toR, toC, player.role)) return res.status(400).json({ success: false, error: 'Invalid move' });
    if (hasCapture(board, player.role) && Math.abs(toR - fromR) !== 2) return res.status(400).json({ success: false, error: 'You must capture' });
    const { newBoard, captured } = applyMove(board, fromR, fromC, toR, toC);
    let nextTurn = player.role === 'white' ? 'black' : 'white';
    if (captured !== null) {
      const movesAfter = getAllMoves(newBoard, player.role);
      const canCaptureAgain = movesAfter.some(m => m.from[0] === toR && m.from[1] === toC && m.capture);
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
    const { data: room } = await supabase.from('rooms').select('id, status').eq('code', roomCode).single();
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });
    const { data: players } = await supabase.from('players').select('username, role').eq('room_id', room.id);
    const { data: game } = await supabase.from('games').select('board_state, current_turn, winner').eq('room_id', room.id).single();
    const player = players.find(p => p.username === username);
    res.json({ success: true, roomCode, status: room.status, board: game.board_state, currentTurn: game.current_turn, winner: game.winner, players, yourRole: player ? player.role : null });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== ADMIN =====
app.post('/api/admin/block/:username', verifyToken, async (req, res) => {
  try {
    if (req.user.username !== 'Admin0') return res.status(403).json({ success: false, error: 'Only Admin0 can block' });
    const { username } = req.params;
    const { data: user } = await supabase.from('users').select('id').ilike('username', username).single();
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    await supabase.from('users').update({ banned: true }).eq('id', user.id);
    onlineUsers.delete(username);
    io.emit('user-status-change', { username, status: 'offline', lastSeen: new Date().toISOString() });
    res.json({ success: true, message: `User @${username} blocked` });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.post('/api/admin/clear-all-messages', verifyToken, async (req, res) => {
  try {
    if (req.user.username !== 'Admin0') return res.status(403).json({ success: false, error: 'Only Admin0 can clear all messages' });
    await supabase.from('chatter').delete().neq('id', 0);
    io.emit('clear-all-messages', { message: 'All public messages cleared by Admin0' });
    res.json({ success: true, message: 'All messages cleared' });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ===== HEALTH / UPTIME =====
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now(), uptime: process.uptime() });
});
app.get('/uptime', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: Date.now() });
});

// ===== DEBUG endpoints =====
app.get('/test-supabase', async (req, res) => {
  try {
    const { data, error } = await supabase.from('chatter').select('*').limit(5).order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ success: true, message: 'Supabase connected', recent: data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});
app.get('/debug-all-commands', (req, res) => {
  res.json({ success: true, commands: Object.keys(commands) });
});

// ===== 404 catch-all (SPA support) =====
app.use((req, res) => {
  if (req.method === 'GET' && req.accepts('html')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ===== Global error handler =====
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: err.message });
});

// ===== SOCKET.IO EVENTS =====
io.on('connection', (socket) => {
  console.log('🔌 User connected via polling:', socket.id);

  socket.on('join-user-room', (username) => {
    if (username) { socket.join(username); console.log(`👤 ${username} joined private room`); }
  });
  socket.on('leave-user-room', (username) => {
    if (username) { socket.leave(username); console.log(`👋 ${username} left private room`); }
  });

  socket.on('request-messages', async () => {
    try {
      const { data, error } = await supabase.from('chatter').select('*').order('created_at', { ascending: false }).limit(50);
      if (!error && data) {
        const msgs = data.reverse().map(m => PERMANENT_ONLINE_USERS.includes(m.username) ? { ...m, user_status: 'online', last_seen: null } : m);
        socket.emit('chat-messages', msgs);
      }
    } catch {}
  });

  socket.on('user-online', (username) => {
    if (username) {
      onlineUsers.set(username, { socketId: socket.id, username, lastSeen: Date.now(), isOnline: true });
      updateUserStatusOnline(username);
      const list = Array.from(onlineUsers.keys());
      io.emit('user-status-change', { username, status: 'online', lastSeen: null, onlineUsers: list });
    }
  });

  socket.on('user-away', (username) => {
    if (username && onlineUsers.has(username) && !PERMANENT_ONLINE_USERS.includes(username)) {
      const data = onlineUsers.get(username);
      data.lastSeen = Date.now();
      data.isOnline = false;
      io.emit('user-status-change', { username, status: 'away', lastSeen: new Date(data.lastSeen).toISOString(), onlineUsers: Array.from(onlineUsers.keys()) });
    }
  });

  socket.on('user-offline', (username) => {
    if (username && !PERMANENT_ONLINE_USERS.includes(username)) {
      onlineUsers.delete(username);
      io.emit('user-status-change', { username, status: 'offline', onlineUsers: Array.from(onlineUsers.keys()) });
    }
  });

  socket.on('typing-start', (data) => {
    socket.broadcast.emit('user-typing', { username: data.username, isTyping: true });
  });
  socket.on('typing-stop', (data) => {
    socket.broadcast.emit('user-typing', { username: data.username, isTyping: false });
  });

  socket.on('join-private-chat', (data) => {
    const { username, otherUser } = data;
    const room = getPrivateChatRoomName(username, otherUser);
    socket.join(room);
  });
  socket.on('leave-private-chat', (data) => {
    const { username, otherUser } = data;
    const room = getPrivateChatRoomName(username, otherUser);
    socket.leave(room);
  });

  socket.on('send-private-message-socket', async (data) => {
    try {
      const { sender_username, receiver_username, content, image_url } = data;
      const messageId = `socket_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
      const insertData = {
        sender_username: sender_username.trim(),
        receiver_username: receiver_username.trim(),
        content: content ? content.trim() : '',
        image_url: image_url || '',
        read: false,
        created_at: new Date().toISOString(),
        message_id: messageId
      };
      const { data: msg, error } = await supabase.from('private_messages').insert([insertData]).select();
      if (error) throw error;
      const responseData = { ...msg[0], custom_message_id: messageId };
      io.to(receiver_username).emit('new-private-message', responseData);
      socket.emit('private-message-confirmation', { ...responseData, status: 'sent', message_id: messageId });
    } catch (err) { socket.emit('private-message-error', { error: err.message }); }
  });

  socket.on('private-message-typing-start', (data) => {
    const { sender, receiver } = data;
    const room = getPrivateChatRoomName(sender, receiver);
    socket.to(room).emit('private-typing-indicator', { username: sender, isTyping: true });
  });
  socket.on('private-message-typing-stop', (data) => {
    const { sender, receiver } = data;
    const room = getPrivateChatRoomName(sender, receiver);
    socket.to(room).emit('private-typing-indicator', { username: sender, isTyping: false });
  });

  socket.on('join-game-room', (roomCode) => {
    if (roomCode) socket.join(`game_${roomCode}`);
  });
  socket.on('leave-game-room', (roomCode) => {
    if (roomCode) socket.leave(`game_${roomCode}`);
  });

  socket.on('disconnect', (reason) => {
    console.log('🔌 Disconnected:', socket.id, reason);
    let found = null;
    for (let [username, data] of onlineUsers.entries()) {
      if (data.socketId === socket.id) {
        found = username;
        data.lastSeen = Date.now();
        data.isOnline = false;
        if (!PERMANENT_ONLINE_USERS.includes(username)) updateUserLastActive(username);
        break;
      }
    }
    if (found && !PERMANENT_ONLINE_USERS.includes(found)) {
      const data = onlineUsers.get(found);
      io.emit('user-status-change', { username: found, status: 'offline', lastSeen: new Date(data.lastSeen).toISOString(), onlineUsers: Array.from(onlineUsers.keys()) });
    }
  });
});

// ===== Helper functions for DB =====
async function updateUserLastActive(username) {
  await supabase.from('user_profiles').update({ last_active: new Date().toISOString(), status: 'offline' }).eq('username', username);
}
async function updateUserStatusOnline(username) {
  await supabase.from('user_profiles').update({ status: 'online', last_active: new Date().toISOString() }).eq('username', username);
}

// Cleanup inactive users every 60 seconds
setInterval(() => {
  const now = Date.now();
  const toRemove = [];
  for (let [username, data] of onlineUsers.entries()) {
    if (PERMANENT_ONLINE_USERS.includes(username)) continue;
    if (now - data.lastSeen > onlineStatusTimeout) {
      toRemove.push(username);
      updateUserLastActive(username);
      onlineUsers.delete(username);
    }
  }
  if (toRemove.length) {
    const list = Array.from(onlineUsers.keys());
    toRemove.forEach(u => {
      io.emit('user-status-change', { username: u, status: 'offline', onlineUsers: list });
    });
  }
}, 60000);

// ===== EXPORT (Vercel) vs LISTEN (local) =====
if (isVercel) {
  // On Vercel, export the Express app (no server.listen)
  module.exports = app;
} else {
  // Local development – start the server
  server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(`🔹 Command prefix: "${PREFIX}"`);
    console.log(`👥 Online users tracking: ACTIVE (5 min timeout)`);
    console.log(`💬 Real-time messaging: ENABLED (polling only for max compatibility)`);
    console.log(`🤖 Permanent online users: ${PERMANENT_ONLINE_USERS.join(', ')}`);
    if (isRender && renderExternalUrl) {
      console.log(`🌐 Render External URL: ${renderExternalUrl}`);
    }
  });
}
