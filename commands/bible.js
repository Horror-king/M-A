const axios = require('axios');

module.exports = {
  config: {
    name: 'bible',
    aliases: ['verse', 'bibleverse', 'scripture'],
    version: '2.0',
    author: 'Hassan',
    role: 0,
    category: 'religion',
    shortDescription: {
      en: 'Get Bible verses by reference or random verses.'
    },
    longDescription: {
      en: 'Fetch Bible verses from various translations. You can specify a reference (John 3:16) or get random verses.'
    },
    guide: {
      en: '{pn} [reference] - Get specific verse\n{pn} random - Get random verse\n{pn} search [keyword] - Search verses'
    }
  },

  onStart: async function ({ message, args }) {
    try {
      const query = args.join(' ').trim().toLowerCase();
      
      if (!query) {
        return message.reply(
          '📖 **Bible Verse Command**\n\n' +
          'Usage:\n' +
          '• `!bible john 3:16` - Get specific verse\n' +
          '• `!bible random` - Get random verse\n' +
          '• `!bible search love` - Search verses\n' +
          '• `!bible translations` - Show available translations\n\n' +
          'Examples:\n' +
          '• `!bible genesis 1:1`\n' +
          '• `!bible psalms 23:1-3`\n' +
          '• `!bible random`'
        );
      }

      if (query === 'translations') {
        return message.reply(
          '📚 **Available Bible Translations:**\n\n' +
          '• `kjv` - King James Version (default)\n' +
          '• `niv` - New International Version\n' +
          '• `esv` - English Standard Version\n' +
          '• `nlt` - New Living Translation\n' +
          '• `nasb` - New American Standard Bible\n' +
          '• `csb` - Christian Standard Bible\n' +
          '• `msg` - The Message\n\n' +
          'Usage: `!bible john 3:16 niv`'
        );
      }

      if (query === 'random') {
        return getRandomVerse(message);
      }

      if (query.startsWith('search ')) {
        const searchTerm = query.replace('search ', '').trim();
        if (!searchTerm) {
          return message.reply('Please provide a search term. Example: `!bible search love`');
        }
        return searchVerses(message, searchTerm);
      }

      // Parse reference and translation
      const [reference, translation] = parseReference(query);
      return getBibleVerse(message, reference, translation);

    } catch (error) {
      console.error('❌ Bible command error:', error);
      return message.reply(`⚠️ Error: ${error.message}`);
    }
  }
};

// Function to get specific Bible verse
async function getBibleVerse(message, reference, translation = 'kjv') {
  try {
    await message.reply('📖 Searching for verse...');

    console.log(`🔍 Bible API Request: ${reference} (${translation})`);
    
    // First try: Bible API (more reliable)
    let verseData;
    try {
      const response = await axios.get(
        `https://bible-api.com/${encodeURIComponent(reference)}?translation=${translation}`,
        { timeout: 10000 }
      );
      
      verseData = response.data;
      
      if (!verseData || !verseData.verses || verseData.verses.length === 0) {
        throw new Error('No verses found');
      }
      
    } catch (apiError) {
      console.log('First API failed, trying alternative...');
      // Try alternative API
      const altResponse = await axios.get(
        `https://bible-api-zhpu.onrender.com/bible?ref=${encodeURIComponent(reference)}&trans=${translation}`,
        { timeout: 10000 }
      );
      
      verseData = altResponse.data;
    }

    if (!verseData || !verseData.text) {
      throw new Error('Could not fetch verse');
    }

    const book = verseData.reference || reference;
    const text = verseData.text.trim();
    const translationName = getTranslationName(translation);

    let formattedVerse = `📖 **${book} (${translationName})**\n\n`;
    
    // Format the text nicely
    if (verseData.verses && Array.isArray(verseData.verses)) {
      verseData.verses.forEach(verse => {
        formattedVerse += `**${verse.verse}.** ${verse.text}\n`;
      });
    } else {
      formattedVerse += `${text}\n`;
    }

    // Add copyright notice if available
    if (verseData.copyright) {
      formattedVerse += `\n_${verseData.copyright}_`;
    }

    // Truncate if too long
    if (formattedVerse.length > 2000) {
      formattedVerse = formattedVerse.substring(0, 2000) + '...\n\n(verse truncated)';
    }

    return message.reply(formattedVerse);

  } catch (error) {
    console.error('Bible verse error:', error);
    
    // Fallback verse
    const fallbackVerse = {
      reference: 'John 3:16',
      text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
      translation: 'KJV'
    };
    
    return message.reply(
      `⚠️ Could not fetch "${reference}". Here's a popular verse instead:\n\n` +
      `📖 **${fallbackVerse.reference} (${fallbackVerse.translation})**\n\n` +
      `${fallbackVerse.text}\n\n` +
      `_Try a simpler reference like: john 3:16, psalms 23, matthew 5:3-10_`
    );
  }
}

// Function to get random verse
async function getRandomVerse(message) {
  try {
    await message.reply('🎲 Finding a random verse...');

    // List of popular Bible references for random selection
    const popularVerses = [
      'john 3:16', 'psalms 23:1', 'jeremiah 29:11', 'philippians 4:13',
      'romans 8:28', 'proverbs 3:5-6', 'isaiah 41:10', 'matthew 11:28',
      'psalms 46:1', 'romans 12:2', 'ephesians 2:8-9', '2 timothy 1:7',
      'psalms 119:105', 'galatians 5:22-23', '1 corinthians 13:4-7',
      'matthew 5:3-12', 'psalms 91:1-2', 'hebrews 11:1', 'joshua 1:9'
    ];

    // Random translation
    const translations = ['kjv', 'niv', 'esv', 'nlt'];
    const randomTranslation = translations[Math.floor(Math.random() * translations.length)];
    
    // Random verse from list
    const randomReference = popularVerses[Math.floor(Math.random() * popularVerses.length)];
    
    return getBibleVerse(message, randomReference, randomTranslation);

  } catch (error) {
    console.error('Random verse error:', error);
    return message.reply(
      '📖 **Random Bible Verse**\n\n' +
      '**John 3:16 (KJV)**\n\n' +
      'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.\n\n' +
      '_Try: !bible random for another verse_'
    );
  }
}

// Function to search verses
async function searchVerses(message, searchTerm) {
  try {
    await message.reply(`🔍 Searching for "${searchTerm}"...`);

    // Use Bible API search
    const response = await axios.get(
      `https://bible-api.com/?search=${encodeURIComponent(searchTerm)}`,
      { timeout: 15000 }
    );

    const searchData = response.data;

    if (!searchData || !searchData.verses || searchData.verses.length === 0) {
      return message.reply(`No verses found containing "${searchTerm}". Try a different word.`);
    }

    // Take first 3 results
    const results = searchData.verses.slice(0, 3);
    
    let formattedResults = `🔍 **Search Results for "${searchTerm}"**\n\n`;
    
    results.forEach((verse, index) => {
      formattedResults += `**${index + 1}. ${verse.reference}**\n`;
      formattedResults += `${verse.text.substring(0, 150)}...\n\n`;
    });

    if (searchData.verses.length > 3) {
      formattedResults += `_Showing 3 of ${searchData.verses.length} results_\n`;
    }

    formattedResults += '\n_Use `!bible [reference]` to get full verse._';

    // Truncate if too long
    if (formattedResults.length > 2000) {
      formattedResults = formattedResults.substring(0, 2000) + '...\n\n(results truncated)';
    }

    return message.reply(formattedResults);

  } catch (error) {
    console.error('Search error:', error);
    return message.reply(
      `⚠️ Could not search for "${searchTerm}". Try specific words like: love, faith, hope, peace`
    );
  }
}

// Helper function to parse reference and translation
function parseReference(query) {
  // List of translations for detection
  const translations = {
    'kjv': 'kjv',
    'niv': 'niv',
    'esv': 'esv',
    'nlt': 'nlt',
    'nasb': 'nasb',
    'csb': 'csb',
    'msg': 'msg'
  };

  const words = query.split(' ');
  let translation = 'kjv'; // default
  
  // Check if last word is a translation
  const lastWord = words[words.length - 1].toLowerCase();
  if (translations[lastWord]) {
    translation = translations[lastWord];
    words.pop(); // Remove translation from reference
  }

  const reference = words.join(' ');
  return [reference, translation];
}

// Helper function to get full translation name
function getTranslationName(abbr) {
  const translations = {
    'kjv': 'King James Version',
    'niv': 'New International Version',
    'esv': 'English Standard Version',
    'nlt': 'New Living Translation',
    'nasb': 'New American Standard Bible',
    'csb': 'Christian Standard Bible',
    'msg': 'The Message'
  };
  return translations[abbr] || abbr.toUpperCase();
}
