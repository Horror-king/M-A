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
    version: "1.12",
    role: 0,
    author: "Hassan",
    countDown: 5,
    category: "image",
    guide: {
      en:
        "{pn} a cute cat --model sd_4.5 --quality 4k\n" +
        "Reply to an image + {pn} combine them --model nano_banana --ar 3:2"
    }
  },

  onStart: async function ({ message, event, args, api }) {
    try {
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

      let qualityParam = "", qualityText = "";
      if (realModel !== "kie_nano_banana") {
        const quality = ALLOWED_QUALITY.includes(parsed.quality) ? parsed.quality : "2k";
        qualityParam = `&quality=${quality}`;
        qualityText = `📐 Quality: ${quality}\n`;
      }

      // --- Get image URL from replied message (if any) ---
      let imageUrls = [];
      if (event.messageReply && event.messageReply.id) {
        try {
          const { supabase } = api;
          const { data: repliedMsg, error } = await supabase
            .from('chatter')
            .select('*')
            .eq('id', event.messageReply.id)
            .single();

          if (!error && repliedMsg) {
            if (repliedMsg.image_url) {
              imageUrls.push(repliedMsg.image_url);
            } else {
              const urlRegex = /(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|svg))/gi;
              const matches = repliedMsg.content.match(urlRegex);
              if (matches) {
                imageUrls.push(...matches.slice(0, 10));
              }
            }
          }
        } catch (err) {
          console.error("Error fetching replied message:", err);
        }
      }

      // --- Build the external API URL ---
      let apiUrl = `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;
      if (ratio) apiUrl += `&ratio=${ratio}`;
      apiUrl += qualityParam;
      if (imageUrls.length > 0) {
        apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;
      }

      // Send processing message
      const processingMsg = await message.reply("🎨 | Generating image, please wait... (this may take up to 2 minutes)");

      // Call the external API – it returns JSON
      const res = await axios.get(apiUrl, {
        headers: {
          Cookie: API_COOKIE,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        },
        timeout: 120000,
        validateStatus: () => true
      });

      // Check if the response is JSON with an image URL
      const data = res.data;
      if (!data || typeof data !== 'object') {
        await message.reply("❌ | Invalid API response.");
        return;
      }

      if (!data.success || !Array.isArray(data.images) || data.images.length === 0) {
        const errorMsg = data.message || data.error || "Unknown API error";
        await message.reply(`❌ | API error: ${errorMsg}`);
        return;
      }

      const externalImageUrl = data.images[0];
      if (!externalImageUrl || externalImageUrl === "") {
        await message.reply("❌ | API returned an empty image URL.");
        return;
      }

      // Download the image
      const imageRes = await axios.get(externalImageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      const imageBuffer = Buffer.from(imageRes.data, 'binary');

      // Upload to Imgur
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
        return;
      }

      const imgUrl = imgurResponse.data.data.link;

      // Reply with result
      const replyText =
        `✅ | ${realModel} Result\n\n` +
        `🧠 Prompt: ${prompt}\n` +
        `⚙ Model: ${realModel}\n` +
        `🖼 Ratio: ${ratio || "Auto (API)"}\n` +
        qualityText +
        (imageUrls.length ? `🧩 Images used: ${imageUrls.length}\n` : "") +
        `\n${imgUrl}`;

      await message.reply(replyText);

    } catch (error) {
      console.error("❌ sd command error:", error);
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        await message.reply("❌ | The image generation took too long. Please try again later or use a simpler prompt.");
      } else {
        await message.reply(`❌ | Error: ${error.message}`);
      }
    }
  }
};
