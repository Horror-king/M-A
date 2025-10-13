const axios = require("axios");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

const API_BASE_URL = "https://tawsif.is-a.dev/gemini/nano-banana";

// helper: temporary file path
function tmpFile(name = "nano") {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return path.join(os.tmpdir(), `${name}_${id}.jpg`);
}

module.exports = {
  config: {
    name: "nano",
    version: "1.2",
    author: "Hassan",
    countDown: 10,
    role: 0,
    shortDescription: { en: "Generate or edit images with Nano Banana AI" },
    longDescription: {
      en: "Use Nano Banana AI to create or edit images.\n\nUsage:\n!nano <prompt> — Generate an image\n!nano <image-link> | <prompt> — Edit by entering image link manually\nOr reply to an image with !nano <prompt>"
    },
    category: "image",
    guide: {
      en: `Examples:\n!nano a cat wearing glasses\n!nano https://example.com/photo.jpg | make the sky pink\n(Or reply to an image with !nano add rainbow background)`
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      if (!args.length) {
        return api.sendMessage(
          "❌ Usage:\n!nano <prompt>\n!nano <image-link> | <prompt>\nOr reply to an image with !nano <prompt>",
          event.threadID,
          event.messageID
        );
      }

      let imageUrl = "";
      let prompt = args.join(" ").trim();

      // case: user entered a link and prompt
      const match = prompt.match(/(https?:\/\/[^\s]+)\s*\|\s*(.*)/i);
      if (match) {
        imageUrl = match[1];
        prompt = match[2];
      }

      // case: user replied to image
      if (!imageUrl && event.messageReply && event.messageReply.attachments) {
        const img = event.messageReply.attachments.find(a => a.type === "photo" || a.type === "image");
        if (img) imageUrl = img.url;
      }

      const encodedPrompt = encodeURIComponent(prompt);
      const encodedUrl = encodeURIComponent(imageUrl);
      const apiUrl = `${API_BASE_URL}?prompt=${encodedPrompt}&url=${encodedUrl}`;

      await api.sendMessage("⏳ Processing your request, please wait...", event.threadID, event.messageID);

      const response = await axios.get(apiUrl, { responseType: "json", timeout: 120000 });
      if (!response.data?.success || !response.data?.imageUrl)
        throw new Error("API did not return a valid image URL.");

      const resultUrl = response.data.imageUrl;

      // download image
      const imgData = await axios.get(resultUrl, { responseType: "arraybuffer", timeout: 60000 });
      const outPath = tmpFile("nano");
      await fsp.writeFile(outPath, imgData.data);

      await api.sendMessage(
        {
          body: `✅ ${imageUrl ? "Edited" : "Generated"} image successfully!\n📝 Prompt: ${prompt}`,
          attachment: fs.createReadStream(outPath)
        },
        event.threadID,
        event.messageID
      );

      // cleanup
      setTimeout(() => fs.unlink(outPath, () => {}), 20000);

    } catch (err) {
      console.error(err);
      let msg = "❌ Failed to process your image.\n";
      if (err.code === "ECONNABORTED") msg += "⏱️ Request timed out. Try again later.";
      else if (err.response) msg += `API Error: ${err.response.status} ${err.response.statusText}`;
      else msg += err.message.slice(0, 200);
      api.sendMessage(msg, event.threadID, event.messageID);
    }
  }
};
