const axios = require('axios');

// Simple in-memory conversation store
const conversationMemory = new Map();

module.exports = {
  config: {
    name: 'deepseek',
    aliases: ['ds', 'seek'],
    version: '2.0.0',
    author: 'Hassan',
    role: 0,
    category: 'ai',
    shortDescription: {
      en: 'Chat with DeepSeek AI (memory enabled).'
    },
    longDescription: {
      en: 'DeepSeek AI with conversation memory, system prompt, and markdown formatting.'
    },
    guide: {
      en: '{pn} deepseek <your message>'
    }
  },

  onStart: async function ({ message, args, event }) {
    try {
      const prompt = args.join(' ').trim();

      if (!prompt) {
        return message.reply(
          '❌ Usage:\n' +
          'deepseek <your message>\n\n' +
          'Example:\n' +
          'deepseek Explain JavaScript promises'
        );
      }

      const userId = event.senderID;

      // Initialize memory if not exists
      if (!conversationMemory.has(userId)) {
        conversationMemory.set(userId, []);
      }

      const memory = conversationMemory.get(userId);

      // System prompt (role definition)
      const systemPrompt =
        'You are DeepSeek AI, a helpful, intelligent, and polite assistant. ' +
        'Explain things clearly, use markdown formatting when helpful, ' +
        'and keep responses concise but informative.';

      // Build conversation context
      let context = systemPrompt + '\n\n';

      memory.forEach(turn => {
        context += `User: ${turn.user}\nAI: ${turn.ai}\n`;
      });

      context += `User: ${prompt}\nAI:`;

      const apiUrl =
        `https://fahim-api-demo.onrender.com/deepseek/v1?prompt=${encodeURIComponent(context)}`;

      const response = await axios.get(apiUrl, {
        timeout: 20000
      });

      if (!response.data || !response.data.result) {
        return message.reply('❌ Invalid response from DeepSeek API.');
      }

      let aiReply = response.data.result.trim();

      // Save memory (limit to last 5 turns)
      memory.push({
        user: prompt,
        ai: aiReply
      });

      if (memory.length > 5) {
        memory.shift();
      }

      // Limit long messages
      if (aiReply.length > 3500) {
        aiReply = aiReply.substring(0, 3500) + '\n\n*…response truncated*';
      }

      return message.reply(
        `🐋 **DeepSeek AI**\n\n${aiReply}`
      );

    } catch (error) {
      return message.reply(`⚠️ DeepSeek Error: ${error.message}`);
    }
  }
};
