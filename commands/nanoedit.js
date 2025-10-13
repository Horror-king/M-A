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
      
      if (!imageUrlRaw.startsWith("http")) {
        return api.sendMessage("❌ Invalid image link provided.", event.threadID, event.messageID);
      }

      await api.sendMessage("⏳ Editing image using Nano Banana AI... Please wait...", event.threadID, event.messageID);

      // Use the API parameters as expected by the endpoint
      const apiUrl = `${API_BASE_URL}?prompt=${encodeURIComponent(promptRaw)}&url=${encodeURIComponent(imageUrlRaw)}`;

      console.log("🔗 API URL:", apiUrl);

      const response = await axios.get(apiUrl, { 
        responseType: "json", 
        timeout: 120000 
      });
      
      console.log("📥 API Response:", JSON.stringify(response.data, null, 2));

      // FIXED: Handle different possible response structures
      let resultUrl;
      
      if (response.data && response.data.imageUrl) {
        // Case 1: Direct imageUrl in response
        resultUrl = response.data.imageUrl;
      } else if (response.data && response.data.data && response.data.data.imageUrl) {
        // Case 2: Nested imageUrl in data object
        resultUrl = response.data.data.imageUrl;
      } else if (response.data && response.data.success && response.data.data) {
        // Case 3: Image URL might be in data field directly
        resultUrl = response.data.data;
      } else if (response.data && typeof response.data === 'string' && response.data.startsWith('http')) {
        // Case 4: Response is directly the image URL
        resultUrl = response.data;
      } else {
        throw new Error("Invalid API response - no image URL found");
      }

      console.log("🖼️ Result Image URL:", resultUrl);

      // Download the image
      const imageResponse = await axios.get(resultUrl, { 
        responseType: "arraybuffer", 
        timeout: 60000 
      });
      
      const outputPath = tmpFile("nanoedit");
      await fsp.writeFile(outputPath, imageResponse.data);

      // Verify the file was created
      const stats = await fsp.stat(outputPath);
      if (stats.size === 0) {
        throw new Error("Downloaded image file is empty");
      }

      console.log("✅ Image saved to:", outputPath, "Size:", stats.size, "bytes");

      // Send the image
      await api.sendMessage(
        {
          body: `✅ Image edited successfully!\n🖼️ Prompt: ${promptRaw}`,
          attachment: fs.createReadStream(outputPath)
        },
        event.threadID,
        event.messageID
      );

      // Clean up temporary file after sending
      setTimeout(() => {
        fsp.unlink(outputPath).catch(err => {
          console.error("❌ Error deleting temp file:", err.message);
        });
      }, 10000);

    } catch (error) {
      console.error("❌ nanoedit error:", error);
      let message = "❌ Failed to edit image. ";

      if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
        message += "The request timed out.";
      } else if (error.response) {
        message += `API error: ${error.response.status} - ${error.response.statusText}`;
        if (error.response.data) {
          console.error("📄 Error response data:", error.response.data);
        }
      } else if (error.message) {
        message += error.message;
      } else {
        message += "Unknown error occurred.";
      }

      api.sendMessage(message, event.threadID, event.messageID);
    }
  }
};
