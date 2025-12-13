const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const FormData = require("form-data");

module.exports = {
  config: {
    name: "crip",
    version: "2.1",
    author: "Hassan (Fixed)",
    countDown: 10,
    role: 0,
    shortDescription: "Generate AI image",
    longDescription: "Generate an AI image using Crip API and upload to Imgur",
    category: "image",
    guide: "{pn} <prompt>\nExample: crip astronaut dog on mars"
  },

  onStart: async function ({ message, args }) {
    const prompt = args.join(" ").trim();
    if (!prompt) {
      return message.reply(
        "❌ Please enter a prompt.\nExample: crip astronaut dog on mars"
      );
    }

    const tempDir = path.join(__dirname, "temp");
    const fileName = `crip_${Date.now()}.png`;
    const localImagePath = path.join(tempDir, fileName);

    try {
      await fs.ensureDir(tempDir);

      // 1️⃣ Notify user
      await message.reply("🖌️ Generating image with Crip AI...");

      // 2️⃣ Generate image
      const cripApiUrl = "https://hassan-crip-2-o.vercel.app/api/crip";

      const aiResponse = await axios.post(
        cripApiUrl,
        { prompt },
        {
          responseType: "arraybuffer",
          headers: { "Content-Type": "application/json" },
          timeout: 60000
        }
      );

      // 3️⃣ Save locally
      await fs.writeFile(localImagePath, aiResponse.data);

      // 4️⃣ Upload to Imgur
      await message.reply("📤 Uploading image to Imgur...");

      const imgurUrl = await uploadToImgur(localImagePath);

      if (!imgurUrl) {
        throw new Error("Imgur upload failed");
      }

      // 5️⃣ Cleanup
      await fs.remove(localImagePath);

      // 6️⃣ Reply (NO [object Object])
      return message.reply({
        body: `🎨 AI Image Generated\n\n📝 Prompt: "${prompt}"`,
        attachment: imgurUrl
      });

    } catch (err) {
      console.error("CRIP ERROR:", err.message);

      if (await fs.pathExists(localImagePath)) {
        await fs.remove(localImagePath);
      }

      if (err.code === "ECONNABORTED") {
        return message.reply("⏱️ Generation timed out. Try a simpler prompt.");
      }

      return message.reply("❌ Failed to generate image. Please try again later.");
    }
  }
};

/* =========================
   Imgur Upload Function
========================= */
async function uploadToImgur(imagePath) {
  try {
    const IMGUR_CLIENT_ID = "225899c9a3312bd"; // your client ID

    const form = new FormData();
    form.append("image", fs.createReadStream(imagePath));
    form.append("type", "file");

    const response = await axios.post(
      "https://api.imgur.com/3/image",
      form,
      {
        headers: {
          Authorization: `Client-ID ${IMGUR_CLIENT_ID}`,
          ...form.getHeaders()
        },
        timeout: 20000
      }
    );

    if (
      response.data &&
      response.data.success === true &&
      response.data.data?.link
    ) {
      return response.data.data.link;
    }

    return null;

  } catch (error) {
    console.error("IMGUR ERROR:", error.message);
    return null;
  }
      }
