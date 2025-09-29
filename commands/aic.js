const axios = require("axios");

console.log("[AIC INIT] Command module loading...");

// === CONFIG ===
const GROQ_API_KEY = "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"; // 🔑 Replace with env or config
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

// Initialize global aic settings
if (!global.data) global.data = {};
if (!global.data.aicSettings) {
  global.data.aicSettings = {
    prefixRequired: true,
    enabled: true
  };
}
console.log("[AIC INIT] Settings initialized:", global.data.aicSettings);

module.exports = {
  config: {
    name: "aic",
    aliases: ["ai"],
    version: "2.4",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: "AI Chat Command",
    longDescription: "Chat with Groq's LLaMA model. Supports prefix toggle.",
    category: "ai",
    guide: {
      en: "{pn} [message] - Chat with AI\n{pn} toggle - Toggle prefix requirement"
    }
  },

  // Command triggered with prefix
  onStart: async function ({ api, event, args }) {
    console.log("[AIC onStart] Triggered with args:", args);
    return this.processRequest({ api, event, args });
  },

  // Passive listener (without prefix if toggled)
  onChat: async function ({ api, event }) {
    const body = event.body?.trim() || "";
    if (!body || event.type === "message_reply") return;

    // Skip if disabled
    if (!global.data.aicSettings.enabled) return;

    // Check if matches command format
    const isCommand = [
      this.config.name.toLowerCase(),
      `?${this.config.name.toLowerCase()}`,
      `${global.config.PREFIX}${this.config.name.toLowerCase()}`
    ].some(prefix => body.toLowerCase().startsWith(prefix));

    // Require prefix if set
    if (global.data.aicSettings.prefixRequired && !isCommand) return;

    // Extract prompt
    let prompt = body;
    if (isCommand) prompt = body.split(" ").slice(1).join(" ").trim();

    if (!prompt) return;

    console.log("[AIC onChat] Processing:", prompt);
    return this.processRequest({ api, event, args: [prompt] });
  },

  // Main AI request processor
  processRequest: async function ({ api, event, args }) {
    const { threadID, senderID, messageID } = event;
    const prompt = args.join(" ").trim();

    try {
      // Handle toggle
      if (prompt.toLowerCase() === "toggle") {
        global.data.aicSettings.prefixRequired = !global.data.aicSettings.prefixRequired;
        const status = global.data.aicSettings.prefixRequired
          ? "ON (use with prefix)"
          : "OFF (respond to all messages)";
        return api.sendMessage(
          `✅ Prefix requirement is now ${status}`,
          threadID,
          messageID
        );
      }

      console.log("[AIC processRequest] Sending to Groq API...");

      const response = await axios.post(
        GROQ_API_URL,
        {
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1000,
          temperature: 0.7
        },
        {
          headers: {
            "Authorization": `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 15000
        }
      );

      const reply =
        response.data?.choices?.[0]?.message?.content ||
        "⚠️ I couldn't generate a response.";

      return api.sendMessage(reply, threadID, messageID);
    } catch (err) {
      console.error("[AIC ERROR]", err.message);

      let errorMsg = "⚠️ An error occurred while processing your request.";
      if (err.response?.status === 429) {
        errorMsg = "🚦 Too many requests! Please slow down.";
      } else if (err.code === "ECONNABORTED") {
        errorMsg = "⏳ The request timed out. Try again.";
      }

      return api.sendMessage(errorMsg, threadID, messageID);
    }
  }
};
