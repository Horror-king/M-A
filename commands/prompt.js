const axios = require("axios");

module.exports = {
  config: {
    name: "prompt",
    version: "1.1",
    author: "Hassan",
    countDown: 3,
    role: 0,
    shortDescription: "Extract prompt from image",
    longDescription: "Reply to an image to get a single clean prompt",
    category: "image",
    guide: `{pn} (reply to an image)`
  },

  onStart: async function ({ event, message, api }) {
    try {
      if (
        !event.messageReply ||
        !event.messageReply.attachments ||
        event.messageReply.attachments[0]?.type !== "photo"
      ) {
        return message.reply("Reply to an image.");
      }

      api.setMessageReaction("⏳", event.messageID, () => {}, true);

      const imageUrl = event.messageReply.attachments[0].url;

      const res = await axios.get(
        "https://theone-fast-image-gen.vercel.app/prompt",
        {
          params: { imageUrl }
        }
      );

      const prompt = res.data?.prompt;

      if (!prompt) {
        return message.reply("Failed to extract prompt.");
      }

      // SEND RAW PROMPT ONLY
      await message.reply(prompt);

      api.setMessageReaction("✅", event.messageID, () => {}, true);
    } catch (err) {
      console.error("PROMPT ERROR:", err);
      return message.reply("Error.");
    }
  }
};
