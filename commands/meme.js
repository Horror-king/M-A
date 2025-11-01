// commands/meme.js
const axios = require("axios");

module.exports = {
  config: {
    name: "meme",
    aliases: ["fun"],
    description: "Get a random meme"
  },

  onStart: async ({ message }) => {
    try {
      const res = await axios.get("https://meme-api.com/gimme");
      const { url, title } = res.data;
      message.reply({ body: `😂 ${title}`, attachment: await axios.get(url, { responseType: "stream" }) });
    } catch {
      message.reply("😢 Couldn't load meme.");
    }
  }
};
