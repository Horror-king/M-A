const axios = require("axios");

const LYRICS_API = "https://shizuapi.onrender.com/api/lyricsv2?query=";

module.exports = {
  config: {
    name: "lyrics",
    version: "1.0",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: { en: "Get song lyrics" },
    longDescription: {
      en: "Fetch song lyrics based on a song name or artist using Shizu Lyrics API."
    },
    category: "music",
    guide: {
      en:
        `Usage:\n` +
        `{pn} <song name>\n\n` +
        `Example:\n` +
        `{pn} shape of you`
    }
  },

  onStart: async function ({ api, event, args }) {
    try {
      const query = args.join(" ").trim();

      if (!query) {
        return api.sendMessage(
          "❌ Please provide a song name.\n\nExample:\n!lyrics shape of you",
          event.threadID,
          event.messageID
        );
      }

      await api.sendMessage("🎵Lyrics.", event.threadID, event.messageID);

      const apiUrl = `${LYRICS_API}${encodeURIComponent(query)}`;
      const response = await axios.get(apiUrl, { responseType: "json", timeout: 60000 });

      if (!response.data || !response.data.result) {
        throw new Error("Lyrics not found or invalid API response.");
      }

      const result = response.data.result;
      const title = result.title || query;
      const artist = result.artist || "Unknown Artist";
      const lyrics = result.lyrics || "No lyrics found.";

      const fullMessage =
        `🎵 *${title}* - *${artist}*\n\n` +
        `${lyrics}`;

      await api.sendMessage(fullMessage, event.threadID, event.messageID);

    } catch (error) {
      console.error("❌ Lyrics command error:", error);
      let errorMessage = "❌ Failed to fetch lyrics. ";

      if (error.code === "ECONNABORTED" || error.message.includes("timeout")) {
        errorMessage += "The request timed out. Please try again.";
      } else if (error.response) {
        errorMessage += `API error: ${error.response.status}`;
      } else {
        errorMessage += error.message;
      }

      await api.sendMessage(errorMessage, event.threadID, event.messageID);
    }
  }
};
