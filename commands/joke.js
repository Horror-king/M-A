// commands/joke.js
const axios = require("axios");

module.exports = {
  config: {
    name: "joke",
    aliases: ["funny"],
    description: "Get a random joke"
  },

  onStart: async ({ message }) => {
    try {
      const res = await axios.get("https://official-joke-api.appspot.com/random_joke");
      const joke = `${res.data.setup}\n${res.data.punchline}`;
      message.reply(`🤣 ${joke}`);
    } catch {
      message.reply("😅 Couldn't load a joke, try again!");
    }
  }
};
