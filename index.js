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

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
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

// Send private message
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
      read: false
    };

    const { data, error } = await supabase
      .from('private_messages')
      .insert([insertData])
      .select();

    if (error) throw error;

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

// GET messages
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

// POST messages - FIXED: Proper handling for regular messages
app.post('/messages', async (req, res) => {
  try {
    const { content, username, image_url, reply_to } = req.body;

    console.log('📨 Received message:', { content, username, image_url, reply_to });

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
      reply_to: reply_to || ''
    };

    console.log('📝 Inserting message to Supabase:', insertData);

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
    
    console.log('✅ Message saved successfully. ID:', data[0]?.id);
    
    // BROADCAST NEW MESSAGE TO ALL CLIENTS IMMEDIATELY
    io.emit('new-message', data[0]);
    res.status(201).json(data[0]);
  } catch (error) {
    console.error('❌ Failed to save message:', error);
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

// DELETE messages
app.delete('/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('chatter')
      .delete()
      .eq('id', id);

    if (error) throw error;
    
    // Broadcast deletion via Socket.io
    io.emit('message-deleted', id);
    res.status(200).json({ success: true });
  } catch (error) {
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
      reply_to: originalCommand || ''
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
      reply_to: ''
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
      reply_to: ''
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

// Command API handler - COMPLETELY REWRITTEN: Single response system
app.post("/api/command", async (req, res) => {
  try {
    const { message, source = 'main-chat' } = req.body;
    console.log('📨 Received command:', { message, source });
    
    if (!message) return res.status(400).json({ reply: "❌ Message is required" });

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
          `https://yau-ai-runing-station.vercel.app/ai?prompt=${encodeURIComponent(cmd.text)}&cb=${Date.now()}`,
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

  // Handle private AI messages
  socket.on('send-private-message', async (data) => {
    try {
      console.log('🤫 Private message received:', data);
      
      // Process private AI response
      const response = await axios.post('http://localhost:3000/api/command', {
        message: data.content,
        source: 'private-ai'
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.data.reply) {
        // Send private AI response back to the specific user
        socket.emit('new-private-message', {
          content: response.data.reply,
          username: 'Private AI'
        });
      }
    } catch (error) {
      console.error('❌ Private message error:', error);
      socket.emit('new-private-message', {
        content: "Error: Could not process your private message",
        username: 'Private AI'
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
        read: false
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
  console.log(`💬 Real-time messaging: ENABLED via Socket.io`);
  console.log(`🔌 Socket.io events: new-message, message-deleted, user-status-change`);
  console.log(`🤫 PRIVATE MESSAGING: ENABLED via Supabase`);
  console.log(`🔒 Private endpoints: /private-messages/*`);
  console.log(`🧪 Test Supabase (GET): http://localhost:${port}/test-supabase`);
  console.log(`🧪 Test Message (POST): http://localhost:${port}/test-message`);
  console.log(`🔍 Debug ALL Commands: http://localhost:${port}/debug-all-commands`);
  if (isRender && renderExternalUrl) {
    console.log(`🌐 Render External URL: ${renderExternalUrl}`);
    console.log(`⏱️ UptimeRobot monitoring URL: ${renderExternalUrl}/health`);
    console.log(`🧪 Test Supabase: ${renderExternalUrl}/test-supabase`);
    console.log(`🧪 Test Message: ${renderExternalUrl}/test-message`);
    console.log(`🔍 Debug ALL Commands: ${renderExternalUrl}/debug-all-commands`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  global.utils.log.err("UNHANDLED REJECTION", err);
});

process.on('uncaughtException', (err) => {
  global.utils.log.err("UNCAUGHT EXCEPTION", err);
});
