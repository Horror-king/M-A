const axios = require("axios");

module.exports = {
  config: {
    name: "fastgen",
    version: "2.0",
    hasPermssion: 0,
    credits: "TawsiN (Modified by Hassan)",
    description: "Fast AI image generation (returns image_url for HTML display)",
    commandCategory: "AI-Image",
    usages: "fastgen <prompt> [--ar 2:3]",
    cooldowns: 5,
    usePrefix: true,
    aliases: ["quickimg", "aigen"]
  },

  onStart: async function ({ event, args, api }) {
    try {
      const inputText = args.join(" ").trim();
      if (!inputText) {
        return {
          reply: "📝 Please provide a prompt.\nExample: -fastgen a castle on clouds --ar 2:3"
        };
      }

      // Extract aspect ratio if provided
      let aspectRatio = "1:1";
      const arMatch = inputText.match(/--ar\s*(\d+:\d+)/i);
      const prompt = arMatch ? inputText.replace(arMatch[0], "").trim() : inputText;
      if (arMatch) aspectRatio = arMatch[1];

      const imageUrls = [];
      const count = 4;

      // Generate images (4)
      for (let i = 0; i < count; i++) {
        const res = await axios.get(`https://www.ai4chat.co/api/image/generate`, {
          params: { prompt, aspect_ratio: aspectRatio },
          timeout: 25000
        });

        if (res.data?.image_link) {
          imageUrls.push(res.data.image_link);
        } else {
          console.warn(`⚠️ Image ${i + 1} failed.`);
        }
      }

      if (imageUrls.length === 0) {
        return { reply: "❌ Failed to generate images. Please try again." };
      }

      // Return clean structure for your HTML front-end
      return {
        reply: {
          message: `✨ Prompt: "${prompt}"\n📐 Aspect Ratio: ${aspectRatio}\n🖼 Generated ${imageUrls.length} Images`,
          image_url: imageUrls
        }
      };

    } catch (err) {
      console.error("FASTGEN ERROR:", err.message);
      return { reply: `🚨 Error: ${err.message || "Failed to generate image"}` };
    }
  }
};
