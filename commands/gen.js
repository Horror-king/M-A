const axios = require('axios');
const FormData = require('form-data');

module.exports = {
  config: {
    name: "gen",
    aliases: ["gimg", "genimage"],
    version: "2.0",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: "Generate image using TheOne API with Imgur upload",
    longDescription: "Generates AI images using TheOne API and uploads to Imgur for fast display.",
    category: "Image Generation",
    guide: {
      en: "{pn} <your prompt> - generate an image using TheOne API and upload to Imgur"
    }
  },

  onStart: async function ({ message, args }) {
    const prompt = args.join(" ");
    if (!prompt) {
      return message.reply("⚠️ | Please provide a prompt.\nExample: /gen a car in cyberpunk style");
    }

    try {
      // Generate image using TheOne API
      const apiUrl = `https://theone-fast-image-gen.vercel.app/view?prompt=${encodeURIComponent(prompt)}`;
      const imageStream = await axios.get(apiUrl, { responseType: 'stream' });

      if (!imageStream.data) {
        return message.reply("❌ | Could not retrieve image from the generator API.");
      }

      // Upload to Imgur
      const form = new FormData();
      form.append('image', imageStream.data, 'generated-image.jpg');
      form.append('type', 'stream');

      const imgurResponse = await axios.post('https://api.imgur.com/3/image', form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': 'Client-ID 225899c9a3312bd' // replace if needed
        }
      });

      if (imgurResponse.data.success) {
        const imgUrl = imgurResponse.data.data.link;
        return message.reply(`🖼️ | Image generated and uploaded to Imgur for: "${prompt}"\n${imgUrl}`);
      } else {
        return message.reply("❌ | Failed to upload image to Imgur.");
      }

    } catch (error) {
      console.error("[GEN Error]", error.message || error);
      return message.reply("❌ | Image generation failed. Try again later.");
    }
  },

  onChat: async function ({ message, args }) {
    return this.onStart({ message, args });
  }
};
