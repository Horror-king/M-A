const axios = require("axios");
const FormData = require("form-data");

module.exports = {
  config: {
    name: "gen",
    version: "1.0",
    hasPermssion: 0,
    credits: "Hassan",
    description: "Generate AI image using TheOne API and optionally upload to Imgur",
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
        return message.reply("📝 Please provide a prompt.\nExample: -gen a futuristic city on Mars");
      }

      // Encode prompt for API call
      const encodedPrompt = encodeURIComponent(inputText);
      const imageUrl = `https://theone-fast-image-gen.vercel.app/view?prompt=${encodedPrompt}`;

      // If you want to upload to Imgur, set your key here 👇
      const IMGUR_API_KEY = "225899c9a3312bd"; // ⬅️ put your Imgur Client ID here later (e.g. "Client-ID abc123")

      let finalUrl = imageUrl;

      if (IMGUR_API_KEY) {
        try {
          // Download image from your API first
          const imageRes = await axios.get(imageUrl, { responseType: "arraybuffer" });
          const imageBuffer = Buffer.from(imageRes.data, "binary");

          // Prepare Imgur upload
          const form = new FormData();
          form.append("image", imageBuffer.toString("base64"));

          const uploadRes = await axios.post("https://api.imgur.com/3/image", form, {
            headers: {
              Authorization: `Client-ID ${IMGUR_API_KEY}`,
              ...form.getHeaders()
            }
          });

          if (uploadRes.data?.data?.link) {
            finalUrl = uploadRes.data.data.link;
          } else {
            console.warn("⚠️ Imgur upload failed, using fallback link");
          }
        } catch (uploadErr) {
          console.error("IMGUR UPLOAD ERROR:", uploadErr.message);
        }
      }

      const output = `✨ Prompt: "${inputText}"\n🖼 Image: ${finalUrl}`;
      return api.sendMessage(output, event.threadID);

    } catch (err) {
      console.error("GEN CMD ERROR:", err.message);
      return message.reply(`🚨 Error: ${err.message || "Failed to generate image"}`);
    }
  }
};
