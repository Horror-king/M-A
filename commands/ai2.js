const axios = require("axios");

console.log("[AIC INIT] Command module loading...");

// === CONFIG ===
// Use a valid model ID known to Groq
const GROQ_API_KEY = process.env.GROQ_API_KEY || "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";
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

if (!GROQ_API_KEY) {
  console.error("[AIC INIT] ⚠️ GROQ_API_KEY is not set!");
}

// Initialize global settings
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
    name: "ai2",
    aliases: ["ai"],
    version: "2.4",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: "AI Chat Command (Groq)",
    longDescription: "Chat with Groq’s LLaMA model. Supports prefix toggle.",
    category: "ai",
    guide: {
      en: "{pn} [message] - Chat with AI\n{pn} toggle - Toggle prefix requirement"
    }
  },

  onStart: async function ({ api, event, args }) {
    console.log("[AIC onStart] args:", args);
    return this.processRequest({ api, event, args });
  },

  onChat: async function ({ api, event }) {
    const body = event.body?.trim() || "";
    if (!body || event.type === "message_reply") return;

    if (!global.data.aicSettings.enabled) {
      console.log("[AIC onChat] Disabled, ignoring message");
      return;
    }

    const lower = body.toLowerCase();
    const isCommand = [
      this.config.name.toLowerCase(),
      `?${this.config.name.toLowerCase()}`,
      `${global.config.PREFIX}${this.config.name.toLowerCase()}`
    ].some(pref => lower.startsWith(pref));

    if (global.data.aicSettings.prefixRequired && !isCommand) {
      return;
    }

    let prompt = body;
    if (isCommand) {
      prompt = body.split(" ").slice(1).join(" ").trim();
    }

    if (!prompt) return;

    console.log("[AIC onChat] Prompt:", prompt);
    return this.processRequest({ api, event, args: [prompt] });
  },

  processRequest: async function ({ api, event, args }) {
    const { threadID, messageID } = event;
    const prompt = args.join(" ").trim();

    try {
      // Toggle command
      if (prompt.toLowerCase() === "toggle") {
        global.data.aicSettings.prefixRequired = !global.data.aicSettings.prefixRequired;
        const status = global.data.aicSettings.prefixRequired
          ? "ON (use prefix)"
          : "OFF (respond to all messages)";
        return api.sendMessage(`✅ Prefix requirement is now ${status}`, threadID, messageID);
      }

      console.log("[AIC processRequest] Sending to Groq API with prompt:", prompt);

      const response = await axios.post(
        GROQ_API_URL,
        {
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 1024,
          temperature: 0.7
        },
        {
          headers: {
            "Authorization": `Bearer ${GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );

      // Log full response for debugging
      console.log("[AIC processRequest] API response status:", response.status);
      console.log("[AIC processRequest] API response data:", JSON.stringify(response.data).slice(0, 500));

      const reply = response.data?.choices?.[0]?.message?.content
        || "⚠️ I couldn’t generate a response.";

      return api.sendMessage(reply, threadID, messageID);

    } catch (err) {
      // Better error logging
      if (err.response) {
        console.error("[AIC ERROR] Response status:", err.response.status);
        console.error("[AIC ERROR] Response data:", err.response.data);
      } else {
        console.error("[AIC ERROR] Message:", err.message);
      }

      let errorMsg = "⚠️ An error occurred while processing your request.";
      if (err.response?.status === 429) {
        errorMsg = "🚦 Too many requests! Please slow down.";
      } else if (err.code === "ECONNABORTED") {
        errorMsg = "⏳ Request timed out. Try again.";
      } else if (err.response?.data?.error?.message) {
        errorMsg = `❌ ${err.response.data.error.message}`;
      }

      return api.sendMessage(errorMsg, threadID, messageID);
    }
  }
};
