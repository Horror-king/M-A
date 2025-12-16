const axios = require('axios');

module.exports = {
  config: {
    name: 'mate',
    version: '1.0.0',
    author: 'Hassan',
    role: 0,
    category: 'ai',
    shortDescription: {
      en: 'Mate AI powered by Hassan API.',
    },
    longDescription: {
      en: 'Uses hassan-llama-api to answer any prompt.',
    },
    guide: {
      en: '{pn} [prompt]',
    },
  },

  onStart: async function () {},

  onChat: async function ({ api, event, args, message }) {
    try {
      const body = event.body.toLowerCase();

      // trigger only when message begins with "mate"
      if (!body.startsWith("mate")) return;

      const prompt = event.body.substring("mate".length).trim();

      if (prompt === '') {
        await message.reply(
          "Kindly provide the question at your convenience and I shall strive to deliver an effective response. Your satisfaction is my top priority."
        );
        return;
      }

      api.setMessageReaction("⌛", event.messageID, () => { }, true);

      let updatedPrompt = `Follow as written: Mostly answer in 1 word or 1 sentene. For any affirmation to your answers only yes or no. Answer in 1-2 sentences for generic questions and longer for complex questions. Mostly stick to 1 sentences unless asked long answers. Now: ${prompt}`;

      const url = `https://hassan-llama-api.vercel.app/llama?prompt=${encodeURIComponent(updatedPrompt)}`;

      const response = await axios.get(url);

      if (!response.data || !response.data.response) {
        throw new Error("Invalid API response");
      }

      await message.reply(response.data.response);

      api.setMessageReaction("🔱", event.messageID, () => { }, true);

    } catch (error) {
      await message.reply(`⚠️ Error: ${error.message}`);
    }
  },
};
