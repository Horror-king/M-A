const fetch = require("node-fetch");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

module.exports = {
  config: {
    name: "crip",
    version: "2.0",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: "Generate AI image via ClipDrop + upload to Imgur",
    longDescription: "Generate a photorealistic image using ClipDrop Text-to-Image API, then upload it to Imgur and return the public link.",
    category: "image",
    guide: "{pn} [your prompt]\nExample: {pn} futuristic cyberpunk city skyline at night"
  },

  onStart: async function ({ message, args }) {
    const prompt = args.join(" ");
    if (!prompt) {
      return message.reply("⚠️ | Please enter a prompt.\nExample: crip futuristic cyberpunk city skyline at night");
    }

    const apiKey = "3b805b36da5054768ba24d0fbd42ca96f375845d0cea06a27d901055cce2e6d33a1b2e7154ae64e28bb4c48aca47aab7";
    const form = new FormData();
    form.append("prompt", prompt);

    try {
      // --- 1️⃣ Generate image using ClipDrop API ---
      const res = await fetch("https://clipdrop-api.co/text-to-image/v1", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          ...form.getHeaders()
        },
        body: form
      });

      if (!res.ok) {
        const errorText = await res.text();
        return message.reply(`❌ | ClipDrop API Error:\n${errorText}`);
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      const imgPath = path.join(__dirname, "crip_image.png");
      fs.writeFileSync(imgPath, buffer);

      // --- 2️⃣ Upload generated image to Imgur ---
      const imgForm = new FormData();
      imgForm.append("image", fs.createReadStream(imgPath));

      const imgurRes = await axios.post("https://api.imgur.com/3/image", imgForm, {
        headers: {
          Authorization: "Client-ID 225899c9a3312bd",
          ...imgForm.getHeaders()
        }
      });

      fs.unlinkSync(imgPath); // Delete local image file

      if (imgurRes.data.success) {
        const imgUrl = imgurRes.data.data.link;
        return message.reply(`🖼️ | Image generated for: "${prompt}"\n${imgUrl}`);
      } else {
        return message.reply("❌ | Failed to upload image to Imgur.");
      }

    } catch (error) {
      console.error("❌ ClipDrop+Imgur error:", error);
      return message.reply("❌ | Image generation failed. Try again later.");
    }
  }
};
