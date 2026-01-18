const axios = require("axios");

const API_BASE_URL = "https://fahim-api-demo.onrender.com/ai/gemini/v1";

module.exports = {
  config: {
    name: "g",
    version: "2.2",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Ask AI (text or image)" },
    longDescription: {
      en: "Ask questions or analyze images with short, direct answers only."
    },
    category: "ai",
    guide: {
      en:
        `Usage:\n` +
        `{pn} <question>\n` +
        `{pn} <question> | <imageUrl>\n\n` +
        `Example:\n` +
        `{pn} What is AI?\n` +
        `{pn} What is in this image? | https://example.com/img.jpg`
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      const input = args.join(" ").trim();

      if (!input) {
        return api.sendMessage(
          "❌ Please enter a question.\nExample:\n!g What is AI?",
          event.threadID,
          event.messageID
        );
      }

      // Split question and image URL
      const [question, imgUrl] = input.split("|").map(v => v.trim());

      const finalPrompt =
        `Answer briefly and directly in 1–2 sentences only.\nQuestion: ${question}`;

      const response = await axios.get(API_BASE_URL, {
        params: {
          prompt: finalPrompt,
          imgUrl: imgUrl || ""
        },
        timeout: 60000
      });

      if (
        !response.data?.candidates?.[0]?.content?.parts?.[0]?.text
      ) {
        throw new Error("Invalid API response");
      }

      const reply =
        response.data.candidates[0].content.parts[0].text.trim();

      await api.sendMessage(
        reply,
        event.threadID,
        event.messageID
      );

    } catch (error) {
      console.error("❌ g command error:", error);

      let msg = "❌ Failed to get response.";

      if (error.code === "ECONNABORTED") {
        msg += " Request timed out.";
      } else if (error.response) {
        msg += ` API error: ${error.response.status}`;
      } else {
        msg += ` ${error.message}`;
      }

      await api.sendMessage(msg, event.threadID, event.messageID);
    }
  }
};
