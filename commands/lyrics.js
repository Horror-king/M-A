const fetch = require("node-fetch");

module.exports = {
  name: "lyrics",
  execute: async (message, args, io, client, supabase, saveChatToSupabase) => {
    try {
      const query = args.join(" ");
      if (!query) {
        message.channel.send("Please provide the song name or artist.");
        return;
      }

      const apiUrl = `https://shizuapi.onrender.com/api/lyricsv2?query=${encodeURIComponent(query)}`;

      const response = await fetch(apiUrl);
      const data = await response.json();

      if (!data || !data.result) {
        message.channel.send("Lyrics not found. Try another song.");
        return;
      }

      const title = data.result.title || query;
      const artist = data.result.artist || "";
      const lyrics = data.result.lyrics || "No lyrics found.";

      const fullMessage = `🎵 *${title}* - *${artist}*\n\n${lyrics}`;

      message.channel.send(fullMessage);

      await saveChatToSupabase(message.channel.id, "Bot", fullMessage, "text");

    } catch (err) {
      console.error("Lyrics cmd error:", err);
      message.channel.send("There was an error fetching lyrics.");
    }
  }
};
