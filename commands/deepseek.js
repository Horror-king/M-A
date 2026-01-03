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

  onStart: async function ({ api, event, args, message }) {
    try {
      const prompt = args.join(' ').trim();

      if (!prompt) {
        return api.sendMessage(
          '❌ Usage:\n' +
          '!deepseek <your prompt>\n\n' +
          'Example:\n' +
          '!deepseek What is artificial intelligence?',
          event.threadID,
          event.messageID
        );
      }

      // Show typing indicator
      api.sendTypingIndicator(event.threadID, true);

      const apiUrl = `https://fahim-api-demo.onrender.com/deepseek/v1?prompt=${encodeURIComponent(prompt)}`;

      const response = await axios.get(apiUrl, {
        timeout: 30000, // 30 seconds timeout
        headers: {
          'User-Agent': 'GoatBot/1.0'
        }
      });

      // STRICT result handling
      if (!response.data || typeof response.data.result !== 'string') {
        return api.sendMessage(
          '❌ Invalid response from DeepSeek API. Received: ' + JSON.stringify(response.data).substring(0, 200),
          event.threadID,
          event.messageID
        );
      }

      let reply = response.data.result.trim();

      // Prevent very long messages
      if (reply.length > 3500) {
        reply = reply.slice(0, 3500) + '\n\n...response truncated';
      }

      return api.sendMessage(
        `🐋 **DeepSeek AI Response:**\n\n${reply}`,
        event.threadID,
        event.messageID
      );

    } catch (error) {
      console.error('❌ DeepSeek Command Error:', error);
      
      let errorMessage = '⚠️ DeepSeek Error: ';
      
      if (error.response) {
        errorMessage += `${error.response.status} ${error.response.statusText || 'Request failed'}`;
      } else if (error.code === 'ECONNABORTED') {
        errorMessage += 'Request timeout. The API is taking too long to respond.';
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Unknown error occurred.';
      }
      
      return api.sendMessage(
        errorMessage,
        event.threadID,
        event.messageID
      );
    }
  }
};
