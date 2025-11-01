// commands/bored.js
const axios = require("axios");

module.exports = {
  config: {
    name: "bored",
    aliases: ["activity"],
    description: "Suggest something to do when bored"
  },

  onStart: async ({ message }) => {
    try {
      const res = await axios.get("https://www.boredapi.com/api/activity/");
      message.reply(`🎲 Try this: ${res.data.activity}`);
    } catch {
      message.reply("😴 Can't think of anything right now.");
    }
  }
};
