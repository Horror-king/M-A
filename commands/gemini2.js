const { GoogleGenAI } = require("@google/genai");
const axios = require("axios");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");

// Temporary file helper
function tmpFile(name = "gemini") {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return path.join(os.tmpdir(), `${name}_${id}.png`);
}

module.exports = {
  config: {
    name: "gemini2",
    version: "1.0",
    author: "Hassan",
    countDown: 10,
    role: 0,
    shortDescription: { en: "Image generation & editing using Gemini" },
    longDescription: {
      en: "Generate or edit images using Google Gemini 2.5 Flash-Image.\n\nUse:\n!gemini <prompt>\n!gemini <image-link> | <prompt>\n(Or reply to an image with !gemini <prompt>)"
    },
    category: "image",
    guide: {
      en: "Examples:\n!gemini a man sitting on a futuristic motorcycle\n!gemini https://example.com/photo.jpg | change background to neon city\n(Reply to an image with !gemini add a wizard hat)"
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      if (!args.length) {
        return api.sendMessage(
          "❌ Usage:\n!gemini <prompt>\n!gemini <image-link> | <prompt>\nOr reply to an image with !gemini <prompt>",
          event.threadID, event.messageID
        );
      }

      let imageUrl = "";
      let promptText = args.join(" ").trim();

      // Detect: <image-url> | <prompt>
      const match = promptText.match(/(https?:\/\/[^\s]+)\s*\|\s*(.*)/i);
      if (match) {
        imageUrl = match[1];
        promptText = match[2];
      }

      // Detect reply-to image
      if (!imageUrl && event.messageReply && event.messageReply.attachments) {
        const img = event.messageReply.attachments.find(a => a.type === "photo" || a.type === "image");
        if (img) imageUrl = img.url;
      }

      await api.sendMessage(
        "⏳ Processing your request...",
        event.threadID,
        event.messageID
      );

      // Initialize Gemini client with YOUR KEY
      const ai = new GoogleGenAI({
        apiKey: process.env.GOOGLE_API_KEY || "AIzaSyBo3FUHrfO63qyjv4R46bDE7Ac74jUTSj4"
      });

      let contents = [];

      // If editing image → convert URL to base64
      if (imageUrl) {
        const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
        const base64Image = Buffer.from(imageResponse.data).toString("base64");

        contents = [
          { text: promptText },
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image
            }
          }
        ];
      } else {
        // Pure text → image generation
        contents = [
          { text: promptText }
        ];
      }

      // Call Gemini
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: contents
      });

      const parts = response.candidates[0].content.parts;

      let outputImage = null;

      for (const part of parts) {
        if (part.inlineData) {
          outputImage = Buffer.from(part.inlineData.data, "base64");
        }
      }

      if (!outputImage)
        throw new Error("Gemini did not return an image.");

      // Save temporary file
      const outPath = tmpFile("gemini");
      await fsp.writeFile(outPath, outputImage);

      await api.sendMessage(
        {
          body: `✅ Image ${imageUrl ? "edited" : "generated"} successfully!\n📝 Prompt: ${promptText}`,
          attachment: fs.createReadStream(outPath)
        },
        event.threadID,
        event.messageID
      );

      // Cleanup
      setTimeout(() => fs.unlink(outPath, () => {}), 20000);

    } catch (err) {
      console.error(err);
      api.sendMessage(
        "❌ Error: " + err.message.slice(0, 200),
        event.threadID,
        event.messageID
      );
    }
  }
};
