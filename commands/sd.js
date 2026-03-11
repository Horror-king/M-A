const axios = require('axios');
const FormData = require('form-data');

const API_URL = "https://fahim-api-demo.onrender.com/ai/aiease/v1";
const API_COOKIE = "connect.sid=s%3A7sKKv8NJgIs6k3gb4DVeDiPAQNr1cyUE.m%2BNmkn%2BHDCqttRUhpW5sm9vjshuCccz3nNSoC3FBQK8";

const ALLOWED_RATIOS = [
  "1:1", "5:4", "4:5", "4:3", "3:4",
  "3:2", "2:3", "16:9", "9:16", "21:9"
];

const MODEL_MAP = {
  "sd_4.0": "doubao-seedream-4.0",
  "sd_4.5": "doubao-seedream-4.5",
  "nano_banana": "kie_nano_banana"
};

const ALLOWED_QUALITY = ["2k", "4k"];

function parseFlags(input) {
  const tokens = input.split(/\s+/);
  const promptParts = [];
  let ratio, model, quality;

  for (let i = 0; i < tokens.length; i++) {
    switch (tokens[i]) {
      case "--ar":
      case "--ratio":
        ratio = tokens[++i];
        break;
      case "--model":
        model = tokens[++i];
        break;
      case "--quality":
        quality = tokens[++i];
        break;
      default:
        promptParts.push(tokens[i]);
    }
  }

  return {
    prompt: promptParts.join(" "),
    ratio,
    model,
    quality
  };
}

module.exports = {
  config: {
    name: "sd",
    aliases: ["seedream"],
    version: "1.9",
    role: 0,
    author: "S M Fahim (adapted by Hassan)",
    countDown: 5,
    category: "image",
    guide: {
      en:
        "{pn} a cute cat --model sd_4.5 --quality 4k\n" +
        "Reply to an image + {pn} combine them --model nano_banana --ar 3:2"
    }
  },

  onStart: async function ({ message, event, args, api }) {
    const input = args.join(" ").trim();
    if (!input) {
      return message.reply("❌ | Please provide a prompt.");
    }

    const parsed = parseFlags(input);
    if (!parsed.prompt) {
      return message.reply("❌ | Prompt cannot be empty.");
    }

    const prompt = parsed.prompt;
    const modelKey = parsed.model || "sd_4.0";
    const realModel = MODEL_MAP[modelKey] || MODEL_MAP["sd_4.0"];

    const ratio = parsed.ratio && ALLOWED_RATIOS.includes(parsed.ratio) ? parsed.ratio : null;

    let qualityParam = "";
    let qualityText = "";
    if (realModel !== "kie_nano_banana") {
      const quality = ALLOWED_QUALITY.includes(parsed.quality) ? parsed.quality : "2k";
      qualityParam = `&quality=${quality}`;
      qualityText = `📐 Quality: ${quality}\n`;
    }

    // --- Get image URL from the replied message (if any) ---
    let imageUrls = [];
    if (event.messageReply && event.messageReply.id) {
      try {
        // Fetch the replied message from the database using the provided supabase instance
        const { supabase } = api; // supabase is available in the api object
        const { data: repliedMsg, error } = await supabase
          .from('chatter')
          .select('*')
          .eq('id', event.messageReply.id)
          .single();

        if (!error && repliedMsg) {
          if (repliedMsg.image_url) {
            imageUrls.push(repliedMsg.image_url);
          } else {
            // Fallback: extract image URLs from the content
            const urlRegex = /(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|svg))/gi;
            const matches = repliedMsg.content.match(urlRegex);
            if (matches) {
              imageUrls.push(...matches.slice(0, 10));
            }
          }
        }
      } catch (err) {
        console.error("❌ Error fetching replied message:", err);
      }
    }

    // --- Build the external API URL ---
    let apiUrl = `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;
    if (ratio) apiUrl += `&ratio=${ratio}`;
    apiUrl += qualityParam;
    if (imageUrls.length > 0) {
      apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;
    }

    // Notify user that processing has started
    const processingMsg = await message.reply("🎨 | Generating image, please wait...");

    try {
      console.log("🔄 Calling external API:", apiUrl);
      const res = await axios.get(apiUrl, {
        headers: {
          Cookie: API_COOKIE,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        },
        timeout: 60000,
        responseType: 'arraybuffer' // fetch as binary
      });

      // The API returns an image directly (not JSON). Check content-type.
      const contentType = res.headers['content-type'];
      if (!contentType || !contentType.startsWith('image/')) {
        // If it's JSON, there was an error
        let errorText = res.data.toString();
        try {
          const json = JSON.parse(errorText);
          if (json.error) errorText = json.error;
        } catch (e) {}
        await message.reply(`❌ | API error: ${errorText}`);
        await message.unsend(processingMsg.messageID);
        return;
      }

      const imageBuffer = Buffer.from(res.data, 'binary');

      // --- Upload to Imgur ---
      const form = new FormData();
      form.append('image', imageBuffer.toString('base64'));
      form.append('type', 'base64');

      const imgurResponse = await axios.post('https://api.imgur.com/3/image', form, {
        headers: {
          ...form.getHeaders(),
          'Authorization': 'Client-ID 225899c9a3312bd'
        }
      });

      if (!imgurResponse.data.success) {
        await message.reply("❌ | Failed to upload image to Imgur.");
        await message.unsend(processingMsg.messageID);
        return;
      }

      const imgUrl = imgurResponse.data.data.link;

      // Build the reply message
      const replyText =
        `✅ | ${realModel} Result\n\n` +
        `🧠 Prompt: ${prompt}\n` +
        `⚙ Model: ${realModel}\n` +
        `🖼 Ratio: ${ratio || "Auto (API)"}\n` +
        qualityText +
        (imageUrls.length ? `🧩 Images used: ${imageUrls.length}\n` : "") +
        `\n${imgUrl}`;

      await message.reply(replyText);
      await message.unsend(processingMsg.messageID); // remove the "processing" message

    } catch (error) {
      console.error("❌ sd command error:", error);
      await message.reply("❌ | Image generation failed. Please try again later.");
      await message.unsend(processingMsg.messageID);
    }
  },

  // Optional: allow using the command in onChat as well
  onChat: async function ({ message, event, args, api }) {
    return this.onStart({ message, event, args, api });
  }
};
