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
    version: "2.0",
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

  onStart: async function ({ message, event, args }) {
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

      // --- Get image URL from the replied message (if any) ---
      let imageUrls = [];
      if (event.messageReply && event.messageReply.id) {
        try {
          // In a real environment you would fetch the message from your database.
          // Since we don't have supabase here, we'll assume the replied message's
          // content contains the image URL, or you can implement a fetch.
          // For simplicity, we'll rely on the user to paste an image URL in the reply.
          // But if you have the message content from the event, you can extract it:
          const repliedContent = event.messageReply.body || event.messageReply.text;
          if (repliedContent) {
            const urlRegex = /(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|svg))/gi;
            const matches = repliedContent.match(urlRegex);
            if (matches) {
              imageUrls.push(...matches.slice(0, 10));
            }
          }
        } catch (err) {
          console.error("Error extracting image from reply:", err);
        }
      }

      // --- Build the external API URL ---
      let apiUrl = `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;
      if (ratio) apiUrl += `&ratio=${ratio}`;
      apiUrl += qualityParam;
      if (imageUrls.length > 0) {
        apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;
      }

      // Send a processing message
      await message.reply("🎨 | Generating image, please wait...");

      // Call the external API – it returns JSON with an image URL
      const res = await axios.get(apiUrl, {
        headers: {
          Cookie: API_COOKIE,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        },
        timeout: 120000, // 2 minutes
        validateStatus: () => true // don't throw on any status
      });

      const data = res.data;
      if (!data || typeof data !== 'object') {
        return message.reply("❌ | Invalid API response.");
      }

      if (!data.success || !Array.isArray(data.images) || data.images.length === 0) {
        const errorMsg = data.message || data.error || "Unknown API error";
        return message.reply(`❌ | API error: ${errorMsg}`);
      }

      const externalImageUrl = data.images[0];
      if (!externalImageUrl || externalImageUrl === "") {
        return message.reply("❌ | API returned an empty image URL.");
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
        return message.reply("❌ | Failed to upload image to Imgur.");
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
        return message.reply("❌ | The image generation took too long. Please try again later or use a simpler prompt.");
      }
      return message.reply(`❌ | Error: ${error.message}`);
    }
  }
};
