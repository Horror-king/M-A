const axios = require("axios");

console.log("[WIKIPEDIA INIT] Command module loading...");

module.exports = {
  config: {
    name: "wikipedia",
    aliases: ["wiki"],
    version: "1.0",
    author: "Hassan",
    countDown: 5,
    role: 0,
    shortDescription: "Search Wikipedia",
    longDescription: "Get a quick summary and image from Wikipedia articles",
    category: "information",
    guide: {
      en: "{pn} [topic] - Search Wikipedia for a summary"
    }
  },

  onStart: async function ({ api, event, args }) {
    const query = args.join(" ").trim();
    if (!query) {
      return api.sendMessage("❌ Please provide a search term.\nExample: wiki Kenya", event.threadID, event.messageID);
    }

    try {
      // Wikipedia REST API call
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
      const response = await axios.get(url);

      if (!response.data || response.data.type === "disambiguation") {
        return api.sendMessage(
          `⚠️ Wikipedia has multiple results for **${query}**.\nTry to be more specific.`,
          event.threadID,
          event.messageID
        );
      }

      const title = response.data.title;
      const extract = response.data.extract || "No summary available.";
      const image = response.data.originalimage?.source || response.data.thumbnail?.source || null;

      let reply = `📖 *${title}*\n\n${extract}`;
      if (image) {
        reply += `\n\n🖼️ Image: ${image}`;
      }

      return api.sendMessage(reply, event.threadID, event.messageID);
    } catch (err) {
      console.error("[WIKIPEDIA ERROR]", err.message);
      return api.sendMessage("❌ Could not fetch data from Wikipedia.", event.threadID, event.messageID);
    }
  },

  // Optional: allow "wiki Kenya" to work without prefix if enabled
  onChat: async function ({ api, event }) {
    const body = event.body?.trim() || "";
    if (!body) return;

    const lower = body.toLowerCase();
    if (lower.startsWith("wiki ")) {
      const query = body.slice(5).trim();
      if (!query) return;
      return this.onStart({ api, event, args: [query] });
    }
  }
};
