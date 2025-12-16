const axios = require('axios');

module.exports = {
  config: {
    name: 'lyrics',
    aliases: ['lyric', 'song'],
    version: '1.0.0',
    author: 'Hassan',
    role: 0,
    category: 'music',
    shortDescription: {
      en: 'Fetch song lyrics by artist and title.'
    },
    longDescription: {
      en: 'Uses lyrics.ovh API to fetch song lyrics instantly.'
    },
    guide: {
      en: '{pn} lyrics <artist> | <title>'
    }
  },

  onStart: async function ({ message, args }) {
    try {
      const input = args.join(' ').trim();

      if (!input || !input.includes('|')) {
        return message.reply(
          '❌ Usage:\nlyrics <artist> | <song title>\n\nExample:\nlyrics Eminem | Lose Yourself'
        );
      }

      const [artistRaw, titleRaw] = input.split('|');

      const artist = artistRaw.trim();
      const title = titleRaw.trim();

      if (!artist || !title) {
        return message.reply('❌ Both artist and song title are required.');
      }

      const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;

      const response = await axios.get(url, {
        timeout: 15000,
        validateStatus: () => true
      });

      if (!response.data || !response.data.lyrics) {
        return message.reply('❌ Lyrics not found. Try another song.');
      }

      let lyrics = response.data.lyrics;

      // Limit very long lyrics
      if (lyrics.length > 3500) {
        lyrics = lyrics.substring(0, 3500) + '\n\n...lyrics truncated';
      }

      return message.reply(
        `🎵 **${title}** — *${artist}*\n\n${lyrics}`
      );

    } catch (error) {
      return message.reply(`⚠️ Lyrics Error: ${error.message}`);
    }
  }
};
