const axios = require('axios');

module.exports = {
  config: {
    name: 'prompt',
    aliases: ['imgprompt', 'describe'],
    version: '1.0.0',
    author: 'Hassan',
    role: 0,
    category: 'ai',
    shortDescription: {
      en: 'Generate an AI image prompt from an image link or description.'
    },
    longDescription: {
      en: 'Uses img2prompt API to generate a detailed AI prompt from an image URL or text description.'
    },
    guide: {
      en:
        '{pn} prompt <image link>\n' +
        '{pn} prompt <image description>'
    }
  },

  onStart: async function ({ message, args }) {
    try {
      const input = args.join(' ').trim();

      if (!input) {
        return message.reply(
          '❌ Usage:\n' +
          'prompt <image link>\n' +
          'prompt <image description>\n\n' +
          'Example:\n' +
          'prompt https://i.postimg.cc/pLr7qvQ8/image.png\n' +
          'prompt a cat wearing sunglasses'
        );
      }

      let apiUrl = '';

      // If input looks like an image URL
      if (input.startsWith('http://') || input.startsWith('https://')) {
        apiUrl =
          `https://fahim-api-demo.onrender.com/img2prompt/v2` +
          `?imageUrl=${encodeURIComponent(input)}` +
          `&language=en&imageModelId=0`;
      } else {
        // Treat input as description
        apiUrl =
          `https://fahim-api-demo.onrender.com/img2prompt/v2` +
          `?description=${encodeURIComponent(input)}` +
          `&language=en&imageModelId=0`;
      }

      const response = await axios.get(apiUrl, {
        timeout: 20000
      });

      if (!response.data || !response.data.prompt) {
        return message.reply('❌ Failed to generate prompt.');
      }

      let promptText = response.data.prompt.trim();

      // Prevent very long messages
      if (promptText.length > 3500) {
        promptText = promptText.slice(0, 3500) + '\n\n...prompt truncated';
      }

      return message.reply(
        `🖼️ **Generated Image Prompt:**\n\n${promptText}`
      );

    } catch (error) {
      return message.reply(
        `⚠️ Prompt Error: ${error.response?.status || ''} ${error.message}`
      );
    }
  }
};
