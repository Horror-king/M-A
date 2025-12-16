const axios = require('axios');

module.exports = {
  config: {
    name: 'mate',
    aliases: ['m'],
    version: '1.0.0',
    author: 'Hassan',
    role: 0,
    category: 'ai',
    shortDescription: {
      en: 'Mate AI powered by Hassan API.'
    },
    longDescription: {
      en: 'Uses hassan-llama-api to answer prompts intelligently.'
    },
    guide: {
      en: '{pn} mate <prompt>'
    }
  },

  onStart: async function ({ message, event, args }) {
    try {
      const prompt = args.join(' ').trim();

      if (!prompt) {
        return message.reply(
          'Kindly provide your question so I can assist you effectively.'
        );
      }

      const enhancedPrompt =
        `Follow strictly:\n` +
        `- Mostly answer in 1 word or 1 sentence.\n` +
        `- Affirmations: only YES or NO.\n` +
        `- 1–2 sentences for normal questions.\n` +
        `- Longer only if complex or requested.\n\n` +
        `Question: ${prompt}`;

      const url = `https://hassan-llama-api.vercel.app/llama?prompt=${encodeURIComponent(enhancedPrompt)}`;

      const response = await axios.get(url, {
        timeout: 15000,
        validateStatus: () => true
      });

      if (!response.data || !response.data.response) {
        throw new Error('Invalid API response');
      }

      return message.reply(response.data.response);

    } catch (error) {
      return message.reply(`⚠️ Mate AI Error: ${error.message}`);
    }
  }
};
