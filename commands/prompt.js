const axios = require("axios");

module.exports = {
  config: {
    name: "prompt",
    version: "3.0",
    author: "Hassan",
    countDown: 3,
    role: 0,
    shortDescription: "Get AI image prompt",
    longDescription: "Use image, link, or text to generate prompt",
    category: "image",
    guide: `{pn} <image link>\n{pn} <text>\nOR reply to an image`
  },

  onStart: async function ({ args, message, event, api }) {
    try {
      let imageUrl = null;
      let userPrompt = null;

      // 🧠 1. If link provided
      if (args[0] && args[0].startsWith("http")) {
        imageUrl = args[0];
      }

      // 🖼️ 2. If replying to image
      else if (
        event.messageReply &&
        event.messageReply.attachments &&
        event.messageReply.attachments[0]?.type === "photo"
      ) {
        imageUrl = event.messageReply.attachments[0].url;
      }

      // ✍️ 3. If text provided
      else if (args.length > 0) {
        userPrompt = args.join(" ");
      }

      // ❌ Nothing provided
      else {
        return message.reply(
          "Send an image link, reply to an image, OR type text.\n\nExamples:\n-prompt https://image.jpg\n-prompt a futuristic city at night"
        );
      }

      api.setMessageReaction("⏳", event.messageID, () => {}, true);

      let res;

      // 🎯 Decide API mode
      if (imageUrl) {
        res = await axios.get(
          "https://theone-fast-image-gen.vercel.app/prompt",
          {
            params: { imageUrl }
          }
        );
      } else {
        res = await axios.get(
          "https://theone-fast-image-gen.vercel.app/prompt",
          {
            params: { userPrompt }
          }
        );
      }

      const prompt = res.data?.prompt;

      if (!prompt) {
        return message.reply("Failed to generate prompt.");
      }

      // ✅ Send clean prompt
      await message.reply(prompt);

      api.setMessageReaction("✅", event.messageID, () => {}, true);

    } catch (err) {
      console.error("PROMPT ERROR:", err);
      return message.reply("Error processing request.");
    }
  }
};
