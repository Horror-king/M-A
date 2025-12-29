const axios = require('axios');

module.exports = {
  config: {
    name: 'deepseek',
    aliases: ['ds', 'seek'],
    version: '1.0.0',
    author: 'Hassan',
    role: 0,
    category: 'ai',
    shortDescription: {
      en: 'Ask DeepSeek AI any question.'
    },
    longDescription: {
      en: 'Uses DeepSeek API to generate AI responses from prompts.'
    },
    guide: {
      en: '{pn} deepseek <your prompt>'
    }
  },

  onStart: async function ({ message, args }) {
    try {
      const prompt = args.join(' ').trim();

      if (!prompt) {
        return message.reply(
          '❌ Usage:\n' +
          'deepseek <your prompt>\n\n' +
          'Example:\n' +
          'deepseek Explain artificial intelligence'
        );
      }

      const apiUrl = `https://fahim-api-demo.onrender.com/deepseek/v1?prompt=${encodeURIComponent(prompt)}`;

      const response = await axios.get(apiUrl, {
        timeout: 20000,
        validateStatus: () => true
      });

      if (!response.data) {
        return message.reply('❌ No response from DeepSeek AI.');
      }

      // Handle different possible API response formats
      const result =
        response.data.result ||
        response.data.response ||
        response.data.message ||
        response.data.answer ||
        response.data;

      let output = typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2);

      // Prevent very long messages
      if (output.length > 3500) {
        output = output.substring(0, 3500) + '\n\n...response truncated';
      }

      return message.reply(
        `🐋 **DeepSeek AI Response:**\n\n${output}`
      );

    } catch (error) {
      return message.reply(`⚠️ DeepSeek Error: ${error.message}`);
    }
  }
};
