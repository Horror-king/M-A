const axios = require('axios');

module.exports = {
  config: {
    name: 'deepseek',
    aliases: ['ds', 'si'],
    version: '1.0.3',
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
      en: '{pn} <your prompt>'
    }
  },

  onStart: async function ({ api, event, args, message }) {
    try {
      const prompt = args.join(' ').trim();

      if (!prompt) {
        // Use the correct response method
        return message.reply(
          '❌ Please provide a question!\n' +
          'Example: !deepseek What is artificial intelligence?\n' +
          'Aliases: !ds, !si'
        );
      }

      // FIXED: Use proper response format
      const thinkingMessage = await message.reply('🤔 Thinking... Please wait.');

      const apiUrl = `https://fahim-api-demo.onrender.com/deepseek/v1?prompt=${encodeURIComponent(prompt)}`;

      console.log('🔍 Calling DeepSeek API with prompt:', prompt.substring(0, 50) + '...');

      const response = await axios.get(apiUrl, {
        timeout: 30000, // 30 seconds timeout
        headers: {
          'User-Agent': 'GoatBot/1.0',
          'Accept': 'application/json'
        }
      });

      console.log('✅ DeepSeek API Response:', {
        status: response.status,
        data: response.data ? 'Received' : 'No data',
        result: response.data?.result ? response.data.result.substring(0, 100) + '...' : 'No result'
      });

      // STRICT result handling
      if (!response.data || typeof response.data.result !== 'string') {
        return message.reply(
          '❌ Invalid response from DeepSeek API. Received: ' + 
          JSON.stringify(response.data || response).substring(0, 200)
        );
      }

      let reply = response.data.result.trim();

      // Prevent very long messages
      if (reply.length > 3500) {
        reply = reply.slice(0, 3500) + '\n\n...response truncated';
      }

      // Delete the "thinking" message and send the actual response
      try {
        // Send the response
        const finalReply = `🐋 **DeepSeek AI Response:**\n\n${reply}`;
        
        // Return the final response
        return message.reply(finalReply);
        
      } catch (sendError) {
        console.error('❌ Error sending message:', sendError);
        // Fallback: just return the reply
        return {
          reply: `🐋 **DeepSeek AI Response:**\n\n${reply}`
        };
      }

    } catch (error) {
      console.error('❌ DeepSeek Command Error:', error);
      
      let errorMessage = '⚠️ DeepSeek Error: ';
      
      if (error.response) {
        errorMessage += `${error.response.status} ${error.response.statusText || 'Request failed'}`;
        console.error('API Response Error:', {
          status: error.response.status,
          data: error.response.data
        });
      } else if (error.code === 'ECONNABORTED') {
        errorMessage += 'Request timeout. The API is taking too long to respond.';
      } else if (error.message) {
        errorMessage += error.message;
      } else {
        errorMessage += 'Unknown error occurred.';
      }
      
      // Try to get more details about the error
      if (error.config) {
        console.error('Request config:', {
          url: error.config.url,
          method: error.config.method,
          timeout: error.config.timeout
        });
      }
      
      return message.reply(errorMessage);
    }
  }
};
