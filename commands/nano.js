const axios = require("axios");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

// --- Configuration ---
const API_BASE_URL = "https://tawsif.is-a.dev/gemini/nano-banana";
const COMMAND_NAME = "nano";

// Helper: create a unique temp filepath
function tmpFile(name = "img") {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return path.join(os.tmpdir(), `${name}_${id}.jpg`);
}

module.exports = {
  config: {
    name: "nano",
    version: "1.1",
    author: "Hassan",
    countDown: 10,
    role: 0,
    shortDescription: { en: "Generate or edit images using Nano Banana AI." },
    longDescription: { 
      en: "Generate a new image from a text prompt, or reply to an image with a prompt to edit it using the Nano Banana AI API.\n\nUsage:\n!nano <prompt> - Generate an image\nReply to an image with !nano <prompt> - Edit the image" 
    },
    category: "image",
    guide: { 
      en: 
        `To generate an image: {pn} <prompt>\n` +
        `Example: {pn} a photorealistic astronaut riding a horse on Mars\n\n` +
        `To edit an image: Reply to an image with {pn} <prompt>\n` +
        `Example: Reply to a photo with {pn} turn her shirt blue and add neon lights`
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      const prompt = args.join(" ").trim();
      
      if (!prompt) {
        return api.sendMessage(
          `❌ Please provide a prompt to generate or edit an image.\n\n` +
          `Usage:\n` +
          `!nano <prompt> - Generate an image\n` +
          `Reply to an image with !nano <prompt> - Edit the image`,
          event.threadID,
          event.messageID
        );
      }

      let imageUrl = "";
      
      // Check if replying to a message with image attachment
      if (event.messageReply && event.messageReply.attachments) {
        const imageAttachment = event.messageReply.attachments.find(
          attachment => attachment.type === "photo" || attachment.type === "image"
        );
        if (imageAttachment) {
          imageUrl = imageAttachment.url;
        }
      }

      // Construct API URL
      const encodedPrompt = encodeURIComponent(prompt);
      const encodedUrl = encodeURIComponent(imageUrl);
      const apiUrl = `${API_BASE_URL}?prompt=${encodedPrompt}&url=${encodedUrl}`;

      // Send initial message
      await api.sendMessage(
        "⏳ Generating image with Nano Banana AI... Please wait...",
        event.threadID,
        event.messageID
      );

      // Make API request
      const response = await axios.get(apiUrl, {
        responseType: "json",
        timeout: 120000
      });

      if (!response.data || !response.data.success || !response.data.imageUrl) {
        throw new Error("Invalid API response: missing imageUrl");
      }

      const resultUrl = response.data.imageUrl;

      // Download the generated image
      const imageResponse = await axios.get(resultUrl, { 
        responseType: "arraybuffer",
        timeout: 60000
      });

      // Save to temp file
      const outputPath = tmpFile("nano");
      await fsp.writeFile(outputPath, imageResponse.data);

      // Send the image
      await api.sendMessage(
        {
          body: `✅ Image ${imageUrl ? 'edited' : 'generated'} successfully!\n📝 Prompt: ${prompt}`,
          attachment: fs.createReadStream(outputPath)
        },
        event.threadID,
        event.messageID
      );

      // Cleanup temp file
      try {
        await fsp.unlink(outputPath);
      } catch (cleanupError) {
        console.error("Cleanup error:", cleanupError);
      }

    } catch (error) {
      console.error("❌ Nano command error:", error);
      
      let errorMessage = "❌ Failed to process the image. ";
      
      if (error.code === 'ECONNABORTED' || error.message.includes("timeout")) {
        errorMessage += "The request timed out. Please try again with a simpler prompt.";
      } else if (error.response) {
        errorMessage += `API error: ${error.response.status} - ${error.response.statusText}`;
      } else if (error.message) {
        errorMessage += error.message.substring(0, 200);
      } else {
        errorMessage += "The AI may have blocked the content, or the API is currently unavailable.";
      }

      await api.sendMessage(
        errorMessage,
        event.threadID,
        event.messageID
      );
    }
  },

  // Handle chat events for your specific setup
  onChat: async function ({ api, event, args }) {
    // This can be used if you need additional chat handling
    // but the main functionality is in onStart
  }
};
