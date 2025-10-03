// commands/advice.js
const axios = require("axios");

module.exports = {
  config: {
    name: "advice",
    aliases: ["tip", "suggestion"],
    description: "Get a random piece of advice"
  },

  onStart: async function ({ message }) {
    try {
      const res = await axios.get("https://api.adviceslip.com/advice");
      const advice = res.data?.slip?.advice;

      if (!advice) {
        return message.reply("⚠️ Couldn't fetch advice. Try again later.");
      }

      return message.reply(`💡 Advice: ${advice}`);
    } catch (err) {
      console.error("❌ Advice command error:", err.message || err);
      return message.reply("❌ Failed to get advice. Please try again later.");
    }
  }
};
