// commands/dog.js
const axios = require("axios");

module.exports = {
  config: {
    name: "dog",
    aliases: ["puppy"],
    description: "Get a random dog image"
  },

  onStart: async ({ message }) => {
    try {
      const res = await axios.get("https://dog.ceo/api/breeds/image/random");
      const img = res.data.message;
      message.reply({ body: "🐶 Woof! Here's a dog!", attachment: await axios.get(img, { responseType: "stream" }) });
    } catch {
      message.reply("🐕 Couldn't get a dog photo right now.");
    }
  }
};
