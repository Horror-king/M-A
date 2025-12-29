const axios = require('axios');

module.exports = {
  config: {
    name: 'deepseek',
    aliases: ['ds', 'si'],
    version: '1.0.2',
    author: 'Hassan',
    role: 0,
    category: 'ai',
    shortDescription: {
      en: 'Ask DeepSeek AI a question.'
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
          'deepseek What is artificial intelligence?'
        );
      }

      const apiUrl =
        `https://fahim-api-demo.onrender.com/deepseek/v1?prompt=${encodeURIComponent(prompt)}`;

      const response = await axios.get(apiUrl, {
        timeout: 20000
      });

      // ✅ STRICT result handling
      if (!response.data || typeof response.data.result !== 'string') {
        return message.reply('❌ Invalid response from DeepSeek API.');
      }

      let reply = response.data.result.trim();

      // Prevent very long messages
      if (reply.length > 3500) {
        reply = reply.slice(0, 3500) + '\n\n...response truncated';
      }

      return message.reply(
        `🐋 **DeepSeek AI Response:**\n\n${reply}`
      );

    } catch (error) {
      return message.reply(
        `⚠️ DeepSeek Error: ${error.response?.status || ''} ${error.message}`
      );
    }
  }
};
