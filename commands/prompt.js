const axios = require("axios");

module.exports = {
  config: {
    name: "prompt",
    version: "3.1",
    author: "Hassan",
    countDown: 3,
    role: 0,
    shortDescription: "Get AI image prompt",
    longDescription: "Use image, link, or text to generate prompt",
    category: "image",
    guide: `{pn} <image link>\n{pn} <text>\nOR reply to an image`
  },

  onStart: async function ({ args, message, event, api }) {
    let imageUrl = null;
    let userPrompt = null;

    try {
      // 1️⃣ Detect input
      if (args[0] && args[0].startsWith("http")) {
        imageUrl = args[0];
      } else if (
        event.messageReply &&
        event.messageReply.attachments &&
        event.messageReply.attachments[0]?.type === "photo"
      ) {
        imageUrl = event.messageReply.attachments[0].url;
      } else if (args.length > 0) {
        userPrompt = args.join(" ");
      } else {
        return message.reply(
          "Send an image link, reply to an image, OR type text."
        );
      }

      api.setMessageReaction("⏳", event.messageID, () => {}, true);

      // 2️⃣ Call API safely
      const res = await axios.get(
        "https://theone-fast-image-gen.vercel.app/prompt",
        {
          params: imageUrl ? { imageUrl } : { userPrompt },
          timeout: 15000 // ⏱️ prevent hanging
        }
      );

      console.log("API RESPONSE:", res.data); // 🔍 debug

      // 3️⃣ Safe extraction
      const prompt =
        res?.data?.prompt ||
        res?.data?.data?.prompt ||
        res?.data;

      if (!prompt || typeof prompt !== "string") {
        return message.reply("Failed to generate prompt.");
      }

      await message.reply(prompt);

      api.setMessageReaction("✅", event.messageID, () => {}, true);

    } catch (err) {
      console.error("PROMPT ERROR FULL:", err.response?.data || err.message);

      return message.reply(
        "Error processing request. API might be slow or temporarily down."
      );
    }
  }
};
