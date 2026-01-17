const axios = require("axios");

const API_BASE_URL = "https://fahim-api-demo.onrender.com/ai/gemini/v1";

module.exports = {
  config: {
    name: "g",
    version: "2.1",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Ask Gemini AI (text or image)" },
    longDescription: {
      en: "Ask questions or analyze images with Gemini AI. Replies are short and direct."
    },
    category: "ai",
    guide: {
      en:
        `Usage:\n` +
        `{pn} <question>\n` +
        `{pn} <question> | <imageUrl>\n\n` +
        `Examples:\n` +
        `{pn} What is JavaScript?\n` +
        `{pn} What is in this image? | https://example.com/img.jpg`
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      const input = args.join(" ").trim();

      if (!input) {
        return api.sendMessage(
          "❌ Please enter a question.\n\nExample:\n!g What is AI?",
          event.threadID,
          event.messageID
        );
      }

      // Split question and image URL (if exists)
      const [question, imgUrl] = input.split("|").map(v => v.trim());

      const finalPrompt =
        `Answer briefly and directly in 1–2 sentences only.\nQuestion: ${question}`;

      await api.sendMessage(
        "🤖 Processing your request...",
        event.threadID,
        event.messageID
      );

      const response = await axios.get(API_BASE_URL, {
        params: {
          prompt: finalPrompt,
          imgUrl: imgUrl || ""
        },
        timeout: 60000
      });

      // Validate response structure
      if (
        !response.data ||
        !response.data.candidates ||
        !response.data.candidates[0]?.content?.parts?.[0]?.text
      ) {
        throw new Error("Invalid API response");
      }

      const reply = response.data.candidates[0].content.parts[0].text.trim();

      await api.sendMessage(
        `🤖 ${reply}`,
        event.threadID,
        event.messageID
      );

    } catch (error) {
      console.error("❌ g command error:", error);

      let errorMsg = "❌ Failed to get response.";

      if (error.code === "ECONNABORTED") {
        errorMsg += " Request timed out.";
      } else if (error.response) {
        errorMsg += ` API error: ${error.response.status}`;
      } else {
        errorMsg += ` ${error.message}`;
      }

      await api.sendMessage(errorMsg, event.threadID, event.messageID);
    }
  }
};
