const axios = require("axios");

module.exports = {
  config: {
    name: "prompt",
    version: "1.0",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: "Generate an image prompt using AI",
    longDescription: "Generate a detailed prompt from an image URL or text description.",
    category: "image",
    guide: `{pn} <image link>\n{pn} <text>`
  },

  onStart: async function ({ api, event, args, message }) {
    try {
      let imageUrl = null;
      let userPrompt = null;

      // If the first argument is a URL, treat as image
      if (args[0] && args[0].startsWith("http")) {
        imageUrl = args[0];
      } 
      // If replying to an image
      else if (event.messageReply && event.messageReply.attachments && 
               event.messageReply.attachments[0]?.type === "photo") {
        imageUrl = event.messageReply.attachments[0].url;
      }
      // Otherwise treat as text prompt
      else if (args.length > 0) {
        userPrompt = args.join(" ");
      }
      else {
        return message.reply("Send an image link, reply to an image, OR type text.\n\nExamples:\n!prompt https://image.jpg\n!prompt a futuristic city at night");
      }

      // Call the same backend API (same as the private AI -prompt)
      let res;
      if (imageUrl) {
        res = await axios.get("https://theone-fast-image-gen.vercel.app/prompt", {
          params: { imageUrl }
        });
      } else {
        res = await axios.get("https://theone-fast-image-gen.vercel.app/prompt", {
          params: { userPrompt }
        });
      }

      const prompt = res.data?.prompt;
      if (!prompt) {
        return message.reply("Failed to generate prompt.");
      }

      await message.reply(prompt);
    } catch (err) {
      console.error("PROMPT ERROR:", err);
      return message.reply("Error processing request.");
    }
  }
};
