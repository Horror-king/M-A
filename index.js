const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const fs = require('fs-extra');
const config = require('./config.json');

// Initialize apps
const app = express();
const port = process.env.PORT || 3000;

// Enhanced global setup
global.GoatBot = { config };
global.utils = {
  log: {
    info: (...args) => console.log(`[INFO][${new Date().toISOString()}]`, ...args),
    err: (...args) => console.error(`[ERROR][${new Date().toISOString()}]`, ...args),
    warn: (...args) => console.warn(`[WARN][${new Date().toISOString()}]`, ...args)
  },
  getText: () => "✅ Bot is running smoothly",
  response: {
    success: (data) => ({ status: 'success', data }),
    error: (message, details) => ({ status: 'error', message, details })
  }
};

// Initialize Supabase client
const supabase = createClient(
  'https://sratulilszjazwcevxta.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyYXR1bGlsc3pqYXp3Y2V2eHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NjIwMDAsImV4cCI6MjA2NjUzODAwMH0.xsNMr1PYeCXMcuEgkkSZnWib63mFATblTF3wR5Zpci4',
  {
    db: { schema: 'public' },
    auth: { persistSession: false }
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
        global.utils.log.info(`Loaded command: ${PREFIX}${cmd.config.name}`);
      }
    } catch (err) {
      global.utils.log.err(`Failed to load ${file}:`, err);
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

// Enhanced Chat API Endpoints

// GET messages
app.get('/messages', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('chatter')
      .select('id, content, username, created_at, image_url, user_id')
      .order('created_at', { ascending: false });

    if (error) {
      global.utils.log.err('Supabase error:', error);
      return res.status(500).json(global.utils.response.error(
        'Database error',
        error.message
      ));
    }

    global.utils.log.info(`Retrieved ${data?.length || 0} messages`);
    res.json(global.utils.response.success(data || []));
  } catch (err) {
    global.utils.log.err('Server error:', err);
    res.status(500).json(global.utils.response.error(
      'Server error',
      err.message
    ));
  }
});

// POST messages
app.post('/messages', async (req, res) => {
  try {
    const { content, username, image_url, user_id } = req.body;

    if ((!content && !image_url) || !username) {
      return res.status(400).json(global.utils.response.error(
        "Content or image, and username are required"
      ));
    }

    const trimmedContent = content?.trim() || '';
    if (trimmedContent.length > 500) {
      return res.status(400).json(global.utils.response.error(
        "Message too long (max 500 characters)"
      ));
    }

    const { data, error } = await supabase
      .from('chatter')
      .insert([{ 
        content: trimmedContent, 
        username,
        user_id: user_id || null, // Store user_id if provided
        image_url 
      }])
      .select();

    if (error) throw error;

    global.utils.log.info('Message saved:', data[0]);
    res.status(201).json(global.utils.response.success(data[0]));
  } catch (error) {
    global.utils.log.err('Error processing message:', error);
    res.status(500).json(global.utils.response.error(
      "Failed to save message",
      error.message
    ));
  }
});

// Image upload endpoint
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json(global.utils.response.error(
        'No image file provided'
      ));
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

    res.json(global.utils.response.success({
      imageUrl: urlData.publicUrl,
      message: 'Image uploaded successfully'
    }));
  } catch (error) {
    global.utils.log.err('Upload error:', error);
    res.status(500).json(global.utils.response.error(
      error.message || 'Failed to upload image'
    ));
  }
});

// DELETE messages with enhanced authentication
app.delete('/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const token = req.headers.authorization?.split(' ')[1];
    
    // Create authenticated Supabase client if token exists
    const supabaseClient = token 
      ? createClient(
          'https://sratulilszjazwcevxta.supabase.co',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNyYXR1bGlsc3pqYXp3Y2V2eHRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTA5NjIwMDAsImV4cCI6MjA2NjUzODAwMH0.xsNMr1PYeCXMcuEgkkSZnWib63mFATblTF3wR5Zpci4',
          {
            global: {
              headers: {
                Authorization: `Bearer ${token}`
              }
            }
          }
        )
      : supabase;

    // First check if message exists
    const { data: messageData, error: fetchError } = await supabaseClient
      .from('chatter')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    if (!messageData) {
      return res.status(404).json(global.utils.response.error(
        "Message not found"
      ));
    }

    // Delete the message
    const { error: deleteError } = await supabaseClient
      .from('chatter')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    res.json(global.utils.response.success({
      id,
      message: "Message deleted successfully"
    }));
  } catch (error) {
    global.utils.log.err('Delete error:', error);
    
    let errorMessage = "Failed to delete message";
    if (error.message.includes('violates row-level security policy')) {
      errorMessage = "You don't have permission to delete this message";
    }

    res.status(500).json(global.utils.response.error(
      errorMessage,
      error.message
    ));
  }
});

// Command API handler
app.post("/api/command", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json(global.utils.response.error(
        "Message is required"
      ));
    }

    if (message.trim().toLowerCase() === "prefix") {
      return res.json(global.utils.response.success({
        reply: `🔹 My command prefix is: \`${PREFIX}\``
      }));
    }

    const cmd = handleCommand(message);
    if (!cmd) return res.end();

    if (cmd.commandName === "ai") {
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
        if (typeof response.data === 'string') {
          try {
            responseData = JSON.parse(response.data);
          } catch (e) {
            if (response.data.includes('error') || response.status !== 200) {
              throw new Error(response.data || `API returned status ${response.status}`);
            }
            return res.json(global.utils.response.success({
              reply: response.data
            }));
          }
        } else {
          responseData = response.data;
        }

        if (responseData.response) {
          return res.json(global.utils.response.success({
            reply: responseData.response
          }));
        } else if (responseData.message) {
          return res.json(global.utils.response.success({
            reply: responseData.message
          }));
        } else if (responseData.data) {
          return res.json(global.utils.response.success({
            reply: responseData.data
          }));
        } else {
          return res.json(global.utils.response.success({
            reply: JSON.stringify(responseData) || "⚠️ No recognizable response format"
          }));
        }
      } catch (aiError) {
        global.utils.log.err("AI Processing Error:", aiError);
        return res.status(500).json(global.utils.response.error(
          "AI Error",
          aiError.message.replace(/[\n\r]/g, ' ').substring(0, 200)
        ));
      }
    }

    const command = commands[cmd.commandName];
    if (!command) {
      return res.json(global.utils.response.error(
        "Command not found"
      ));
    }
    if (typeof command.onStart !== "function") {
      return res.json(global.utils.response.error(
        "This command does not support execution"
      ));
    }

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

    if (!res.headersSent) {
      res.json(global.utils.response.success({
        reply: replies.length === 1 ? replies[0] : replies
      }));
    }
  } catch (error) {
    global.utils.log.err("Server Error:", error);
    res.status(500).json(global.utils.response.error(
      "Server Error",
      error.message
    ));
  }
});

// Start server
app.listen(port, () => {
  global.utils.log.info(`🚀 Server running on port ${port}`);
  global.utils.log.info(`🔹 Command prefix: "${PREFIX}"`);
  if (isRender && renderExternalUrl) {
    global.utils.log.info(`🌐 Render External URL: ${renderExternalUrl}`);
    global.utils.log.info(`⏱️ UptimeRobot monitoring URL: ${renderExternalUrl}/health`);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  global.utils.log.info('SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  global.utils.log.err("UNHANDLED REJECTION", err);
});

process.on('uncaughtException', (err) => {
  global.utils.log.err("UNCAUGHT EXCEPTION", err);
});
