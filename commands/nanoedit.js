const axios = require("axios");

const API_BASE_URL = "https://tawsif.is-a.dev/gemini/nano-banana";

module.exports = {
  config: {
    name: "nanoedit",
    version: "1.2",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Edit image by link and prompt (returns URL)." },
    longDescription: {
      en: "Edit or modify an image using Nano Banana AI by providing an image URL and a text prompt. Returns the generated image URL."
    },
    category: "image",
    guide: {
      en:
        `Usage:\n` +
        `{pn} <image_link> | <prompt>\n\n` +
        `Example:\n` +
        `{pn} https://example.com/photo.jpg | make it look like a cartoon version`
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      const input = args.join(" ").trim();
      if (!input.includes("|")) {
        return api.sendMessage(
          "❌ Wrong format.\nUse:\n!nanoedit <image_link> | <prompt>\n\nExample:\n!nanoedit https://example.com/photo.jpg | add cyberpunk effects",
          event.threadID,
          event.messageID
        );
      }

      const [imageUrlRaw, promptRaw] = input.split("|").map(s => s.trim());
      if (!imageUrlRaw.startsWith("http")) {
        return api.sendMessage("❌ Invalid image link provided.", event.threadID, event.messageID);
      }

      const encodedPrompt = encodeURIComponent(promptRaw);
      const encodedUrl = encodeURIComponent(imageUrlRaw);
      const apiUrl = `${API_BASE_URL}?prompt=${encodedPrompt}&url=${encodedUrl}`;

      await api.sendMessage("⏳ Editing image using Nano Banana AI... Please wait...", event.threadID, event.messageID);

      const response = await axios.get(apiUrl, { responseType: "json", timeout: 120000 });

      if (!response.data || !response.data.success || !response.data.imageUrl) {
        throw new Error("Invalid API response or missing imageUrl");
      }

      const resultUrl = response.data.imageUrl;

      // ✅ Return only link (so HTML can handle image display)
      await api.sendMessage(
        `✅ Image edited successfully!\n🖼️ Prompt: ${promptRaw}\n🔗 Link: ${resultUrl}`,
        event.threadID,
        event.messageID
      );

    } catch (error) {
      console.error("❌ nanoedit error:", error);
      let errMsg = "❌ Failed to edit image. ";
      if (error.code === "ECONNABORTED" || error.message.includes("timeout"))
        errMsg += "The request timed out.";
      else if (error.response)
        errMsg += `API error: ${error.response.status}`;
      else
        errMsg += error.message;
      api.sendMessage(errMsg, event.threadID, event.messageID);
    }
  }
};
