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
    author: "Debug",
    countDown: 5,
    category: "image",
    guide: {
      en: "{pn} a cute cat --model sd_4.5"
    }
  },

  onStart: async function ({ message, event, args, api }) {
    console.log("⚡ sd command started");
    try {
      const input = args.join(" ").trim();
      console.log("Input:", input);
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

      console.log("Prompt:", prompt, "Model:", realModel, "Ratio:", ratio);

      // --- Get image URL from replied message ---
      let imageUrls = [];
      if (event.messageReply && event.messageReply.id) {
        console.log("Fetching replied message ID:", event.messageReply.id);
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
              console.log("Found image_url:", repliedMsg.image_url);
            } else {
              const urlRegex = /(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|svg))/gi;
              const matches = repliedMsg.content.match(urlRegex);
              if (matches) {
                imageUrls.push(...matches.slice(0, 10));
                console.log("Found URLs in content:", matches);
              }
            }
          } else {
            console.log("Replied message not found or error:", error);
          }
        } catch (err) {
          console.error("Error fetching replied message:", err);
        }
      }

      // --- Build API URL ---
      let apiUrl = `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;
      if (ratio) apiUrl += `&ratio=${ratio}`;
      apiUrl += qualityParam;
      if (imageUrls.length > 0) {
        apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;
      }
      console.log("External API URL:", apiUrl);

      // Send processing message
      const processingMsg = await message.reply("🎨 | Generating image, please wait...");
      console.log("Processing message sent, ID:", processingMsg.messageID);

      // Call external API
      console.log("Calling external API...");
      const res = await axios.get(apiUrl, {
        headers: {
          Cookie: API_COOKIE,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        },
        timeout: 60000,
        responseType: 'arraybuffer'
      });

      const contentType = res.headers['content-type'];
      console.log("API response status:", res.status, "Content-Type:", contentType);

      if (!contentType || !contentType.startsWith('image/')) {
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
      console.log("Image buffer size:", imageBuffer.length);

      // Upload to Imgur
      console.log("Uploading to Imgur...");
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
        console.log("Imgur upload failed:", imgurResponse.data);
        await message.reply("❌ | Failed to upload image to Imgur.");
        await message.unsend(processingMsg.messageID);
        return;
      }

      const imgUrl = imgurResponse.data.data.link;
      console.log("Imgur URL:", imgUrl);

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
      await message.unsend(processingMsg.messageID);
      console.log("✅ Command completed successfully");

    } catch (error) {
      console.error("❌ sd command error:", error);
      // Try to reply with error
      try {
        await message.reply(`❌ | Error: ${error.message}`);
      } catch (e) {}
    }
  }
};
