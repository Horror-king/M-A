const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const FormData = require("form-data");

const IMGUR_CLIENT_ID = "225899c9a3312bd";
const CLIPDROP_API_KEY = "91c943b1448de009eba2ada63b39c50dc5ded3db61dbd14e2d4970a7edc9e73c04b0e11a0520e04f37ee07fd6dc140e9"; // weka key yako hapa

function tmpFile(name = "crip") {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return path.join(process.cwd(), `${name}_${id}.png`);
}

module.exports = {
  config: {
    name: "crip2",
    version: "1.0",
    author: "Hassan",
    countDown: 10,
    role: 0,
    shortDescription: { en: "Generate or edit images with Crip AI" },
    longDescription: { en: "Use Crip AI to create images from prompts.\n!crip <prompt>" },
    category: "image",
    guide: { en: "Example:\n!crip vaporwave fashion dog in miami" }
  },

  onStart: async function ({ api, event, args }) {
    try {
      if (!args.length) {
        return api.sendMessage(
          "❌ Usage:\n!crip <prompt>",
          event.threadID,
          event.messageID
        );
      }

      const prompt = args.join(" ").trim();
      await api.sendMessage("⏳ Generating image, please wait...", event.threadID, event.messageID);

      // --- Generate image via ClipDrop ---
      const clipdropResp = await fetch("https://clipdrop-api.co/text-to-image/v1", {
        method: "POST",
        headers: {
          "x-api-key": CLIPDROP_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt })
      });

      if (!clipdropResp.ok) {
        const errText = await clipdropResp.text();
        throw new Error("ClipDrop API error: " + errText);
      }

      const arrayBuffer = await clipdropResp.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const localPath = tmpFile();
      fs.writeFileSync(localPath, buffer);

      // --- Upload image to Imgur ---
      const form = new FormData();
      form.append("image", fs.createReadStream(localPath));

      const imgurResp = await fetch("https://api.imgur.com/3/image", {
        method: "POST",
        headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
        body: form
      });

      const imgurData = await imgurResp.json();
      console.log("Imgur response:", imgurData); // **DEBUG**

      if (!imgurData.success) throw new Error("Imgur upload failed: " + JSON.stringify(imgurData));

      fs.unlinkSync(localPath);

      await api.sendMessage(
        {
          body: `✅ Image generated successfully!\n📝 Prompt: ${prompt}\n🌐 Link: ${imgurData.data.link}`,
        },
        event.threadID,
        event.messageID
      );

    } catch (err) {
      console.error(err);
      await api.sendMessage(`❌ Failed to generate image.\nError: ${err.message}`, event.threadID, event.messageID);
    }
  }
};
