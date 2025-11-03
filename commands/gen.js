const axios = require("axios");

module.exports = {
  config: {
    name: "gen",
    version: "1.3",
    hasPermssion: 0,
    credits: "Hassan",
    description: "Generate AI image using TheOne API (for Page Bot display)",
    commandCategory: "AI-Image",
    usages: "gen <prompt>",
    cooldowns: 5,
    usePrefix: true,
    aliases: ["gimg", "genimage"]
  },

  onStart: async function ({ message, args }) {
    try {
      const prompt = args.join(" ").trim();
      if (!prompt) {
        return message.reply("📝 Please enter a prompt.\nExample: gen futuristic car");
      }

      // Encode and build image URL
      const encodedPrompt = encodeURIComponent(prompt);
      const imageUrl = `https://theone-fast-image-gen.vercel.app/view?prompt=${encodedPrompt}`;

      // Compose final message — must contain the URL for your frontend to show the image
      const responseText = `✨ Prompt: "${prompt}"\n${imageUrl}`;

      // Send message back to page
      return message.reply(responseText);

    } catch (err) {
      console.error("GEN CMD ERROR:", err);
      return message.reply(`🚨 Error: ${err.message || "Failed to generate image"}`);
    }
  }
};
