const axios = require("axios");

module.exports = {
  config: {
    name: "sd",
    version: "1.2",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: "Generate AI image using Seedream API",
    longDescription: "Generate realistic AI images using the Seedream API with optional ratio settings.",
    category: "image",
    guide: "{pn} [your prompt] [--ratio=16:9]\nExample: {pn} futuristic car in desert --ratio=16:9"
  },

  onStart: async function ({ message, args }) {
    if (!args.length) {
      return message.reply("⚠️ | Please enter a prompt.\nExample: sd futuristic car in desert --ratio=16:9");
    }

    // 🔍 Parse ratio argument
    let ratio = "1:1"; // default
    const ratioArg = args.find(a => a.startsWith("--ratio="));
    if (ratioArg) {
      ratio = ratioArg.split("=")[1] || "1:1";
      args = args.filter(a => a !== ratioArg); // remove ratio argument from prompt
    }

    const prompt = args.join(" ");
    if (!prompt) {
      return message.reply("⚠️ | Please enter a valid prompt.");
    }

    try {
      const apiUrl = `https://tawsif.is-a.dev/seedream/gen?prompt=${encodeURIComponent(prompt)}&ratio=${encodeURIComponent(ratio)}`;
      const res = await axios.get(apiUrl);

      if (!res.data || !res.data.success || !res.data.imageUrl) {
        return message.reply("❌ | Failed to generate image.");
      }

      const imgUrl = res.data.imageUrl;

      // 🖼 Send only the image URL (HTML auto-renders it)
      return message.reply(imgUrl);

    } catch (err) {
      console.error("[SD Error]", err.message || err);
      return message.reply("❌ | Image generation failed. Try again later.");
    }
  },

  onChat: async function ({ message, args }) {
    return this.onStart({ message, args });
  }
};
