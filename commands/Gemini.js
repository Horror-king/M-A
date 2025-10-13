const axios = require("axios");

const API_BASE_URL = "https://tawsif.is-a.dev/gemini/chat";

module.exports = {
  config: {
    name: "gemini",
    version: "1.0",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Chat with Gemini AI" },
    longDescription: {
      en: "Send a message to Gemini AI and receive an intelligent response using the Gemini Chat API."
    },
    category: "ai",
    guide: {
      en:
        `Usage:\n` +
        `{pn} <message>\n\n` +
        `Example:\n` +
        `{pn} Hello Gemini, how are you today?`
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      const message = args.join(" ").trim();

      if (!message) {
        return api.sendMessage(
          "❌ Please provide a message to send to Gemini.\n\nExample:\n!gemini tell me a joke",
          event.threadID,
          event.messageID
        );
      }

      // Generate random or consistent ID for session
      const sessionId = String(event.senderID || 1);

      await api.sendMessage("💬 Talking to Gemini AI... please wait...", event.threadID, event.messageID);

      const apiUrl = `${API_BASE_URL}?message=${encodeURIComponent(message)}&id=${sessionId}`;
      const response = await axios.get(apiUrl, { responseType: "json", timeout: 60000 });

      if (!response.data || !response.data.success || !response.data.reply) {
        throw new Error("Invalid API response or missing 'reply' field.");
      }

      const reply = response.data.reply;

      await api.sendMessage(
        `🤖 Gemini says:\n${reply}`,
        event.threadID,
        event.messageID
      );

    } catch (error) {
      console.error("❌ Gemini command error:", error);
      let errorMessage = "❌ Failed to get response from Gemini API. ";

      if (error.code === 'ECONNABORTED' || error.message.includes("timeout")) {
        errorMessage += "The request timed out. Please try again.";
      } else if (error.response) {
        errorMessage += `API error: ${error.response.status}`;
      } else {
        errorMessage += error.message;
      }

      await api.sendMessage(errorMessage, event.threadID, event.messageID);
    }
  }
};
