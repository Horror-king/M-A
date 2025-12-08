const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Helper: upload to Imgur
async function uploadToImgur(imagePath) {
  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath));

  const response = await fetch('https://api.imgur.com/3/image', {
    method: 'POST',
    headers: {
      Authorization: `Client-ID 225899c9a3312bd`
    },
    body: form
  });

  const data = await response.json();
  if (!data.success) throw new Error('Imgur upload failed');
  return data.data.link; // direct image link
}

// Temporary file helper
function tmpFile(name = "crip") {
  return path.join(__dirname, `${name}_${Date.now()}.png`);
}

module.exports = {
  config: {
    name: "crip2",
    version: "1.0",
    author: "Hassan",
    countDown: 10,
    role: 0,
    shortDescription: { en: "Generate images using ClipDrop and get Imgur link" },
    longDescription: {
      en: "Generate an image from prompt and get a shareable Imgur link.\nUsage:\n!crip <prompt>"
    },
    category: "image",
    guide: {
      en: "Example:\n!crip vaporwave fashion dog in miami"
    }
  },

  onStart: async function ({ api, event, args }) {
    if (!args.length) {
      return api.sendMessage("❌ Please provide a prompt.\nExample: !crip vaporwave fashion dog in miami", event.threadID, event.messageID);
    }

    const prompt = args.join(" ");
    const tmpPath = tmpFile();

    try {
      await api.sendMessage("⏳ Generating image...", event.threadID, event.messageID);

      // --- ClipDrop API ---
      const clipForm = new FormData();
      clipForm.append("prompt", prompt);

      const clipResponse = await fetch("https://clipdrop-api.co/text-to-image/v1", {
        method: "POST",
        headers: { "x-api-key": process.env.CLIPDROP_API_KEY || "91c943b1448de009eba2ada63b39c50dc5ded3db61dbd14e2d4970a7edc9e73c04b0e11a0520e04f37ee07fd6dc140e9", ...clipForm.getHeaders() },
        body: clipForm
      });

      if (!clipResponse.ok) {
        const errText = await clipResponse.text();
        throw new Error(errText);
      }

      const buffer = await clipResponse.buffer();
      fs.writeFileSync(tmpPath, buffer);

      // --- Upload to Imgur ---
      const imgurLink = await uploadToImgur(tmpPath);

      await api.sendMessage(`✅ Image generated!\n🔗 [Click here](${imgurLink}) to view`, event.threadID, event.messageID);

      // Cleanup
      fs.unlink(tmpPath, () => {});

    } catch (err) {
      console.error(err);
      api.sendMessage(`❌ Failed: ${err.message.slice(0, 200)}`, event.threadID, event.messageID);
    }
  }
};
