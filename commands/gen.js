const axios = require("axios");
const fs = require("fs");
const path = require("path");

module.exports = {
  config: {
    name: "gen",
    version: "1.1",
    hasPermssion: 0,
    credits: "Hassan",
    description: "Generate AI image using TheOne API (auto sends image)",
    commandCategory: "AI-Image",
    usages: "gen <prompt>",
    cooldowns: 5,
    usePrefix: true,
    aliases: ["gimg", "genimage"]
  },

  onStart: async function ({ api, event, args, message }) {
    try {
      const inputText = args.join(" ").trim();
      if (!inputText) {
        return message.reply("📝 Please provide a prompt.\nExample: -gen futuristic city on Mars");
      }

      const encodedPrompt = encodeURIComponent(inputText);
      const imageUrl = `https://theone-fast-image-gen.vercel.app/view?prompt=${encodedPrompt}`;

      // Download image temporarily
      const imgPath = path.join(__dirname, `${Date.now()}_gen.jpg`);
      const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
      fs.writeFileSync(imgPath, Buffer.from(response.data, "binary"));

      // Send image directly
      await api.sendMessage(
        {
          body: `✨ Prompt: "${inputText}"`,
          attachment: fs.createReadStream(imgPath)
        },
        event.threadID,
        () => fs.unlinkSync(imgPath) // delete after sending
      );
    } catch (err) {
      console.error("GEN CMD ERROR:", err.message);
      return message.reply(`🚨 Error: ${err.message || "Failed to generate image"}`);
    }
  }
};
