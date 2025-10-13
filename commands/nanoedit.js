const axios = require("axios");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

const API_BASE_URL = "https://tawsif.is-a.dev/gemini/nano-banana";

function tmpFile(name = "img") {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return path.join(os.tmpdir(), `${name}_${id}.jpg`);
}

module.exports = {
  config: {
    name: "nanoedit",
    version: "1.0",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Edit an image using a link + prompt." },
    longDescription: {
      en: "Edit or modify an image by entering an image URL and a text prompt using the Nano Banana AI API."
    },
    category: "image",
    guide: {
      en:
        `Usage:\n` +
        `{pn} <image_link> | <prompt>\n\n` +
        `Example:\n` +
        `{pn} https://example.com/photo.jpg | turn this person into a cartoon superhero`
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      const input = args.join(" ").trim();

      if (!input.includes("|")) {
        return api.sendMessage(
          "❌ Incorrect format.\nUse:\n!nanoedit <image_link> | <prompt>\n\nExample:\n!nanoedit https://example.com/img.jpg | add neon lighting and cyberpunk style",
          event.threadID,
          event.messageID
        );
      }

      const [imageUrlRaw, promptRaw] = input.split("|").map(s => s.trim());
      const imageUrl = encodeURIComponent(imageUrlRaw);
      const prompt = encodeURIComponent(promptRaw);

      if (!imageUrlRaw.startsWith("http")) {
        return api.sendMessage("❌ Invalid image link provided.", event.threadID, event.messageID);
      }

      await api.sendMessage("⏳ Editing image using Nano Banana AI... Please wait...", event.threadID, event.messageID);

      const apiUrl = `${API_BASE_URL}?prompt=${prompt}&url=${imageUrl}`;

      const response = await axios.get(apiUrl, { responseType: "json", timeout: 120000 });
      if (!response.data || !response.data.success || !response.data.imageUrl) {
        throw new Error("Invalid API response or missing imageUrl");
      }

      const resultUrl = response.data.imageUrl;

      const imageResponse = await axios.get(resultUrl, { responseType: "arraybuffer", timeout: 60000 });
      const outputPath = tmpFile("nanoedit");
      await fsp.writeFile(outputPath, imageResponse.data);

      await api.sendMessage(
        {
          body: `✅ Image edited successfully!\n🖼️ Prompt: ${promptRaw}`,
          attachment: fs.createReadStream(outputPath)
        },
        event.threadID,
        event.messageID
      );

      setTimeout(() => fsp.unlink(outputPath).catch(() => {}), 10000);

    } catch (error) {
      console.error("❌ nanoedit error:", error);
      let message = "❌ Failed to edit image. ";

      if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
        message += "The request timed out.";
      } else if (error.response) {
        message += `API error: ${error.response.status}`;
      } else {
        message += error.message;
      }

      api.sendMessage(message, event.threadID, event.messageID);
    }
  }
};
