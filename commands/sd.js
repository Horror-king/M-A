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
    version: "2.3",
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
      const modelKey = parsed.model || "sd_4.5"; // default to sd_4.5
      const realModel = MODEL_MAP[modelKey] || MODEL_MAP["sd_4.5"];
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
        console.log(`🔍 Fetching replied message ID: ${event.messageReply.id}`);
        try {
          const { supabase } = api;
          const { data: repliedMsg, error } = await supabase
            .from('chatter')
            .select('*')
            .eq('id', event.messageReply.id)
            .single();

          if (!error && repliedMsg) {
            console.log("✅ Replied message found:", repliedMsg.id);
            if (repliedMsg.image_url) {
              imageUrls.push(repliedMsg.image_url);
              console.log("📸 Using image_url from database:", repliedMsg.image_url);
            } else {
              // Fallback: try to extract from content
              const urlRegex = /(https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|bmp|svg))/gi;
              const matches = repliedMsg.content.match(urlRegex);
              if (matches && matches.length > 0) {
                imageUrls.push(...matches.slice(0, 10));
                console.log("📸 Extracted URLs from content:", matches);
              } else {
                console.log("⚠️ No image URL found in replied message.");
              }
            }
          } else {
            console.log("❌ Replied message not found or error:", error);
          }
        } catch (err) {
          console.error("❌ Error fetching replied message:", err);
        }
      }

      // --- Warn if using nano_banana with only one image ---
      if (realModel === "kie_nano_banana" && imageUrls.length === 1) {
        return message.reply("⚠️ The nano_banana model is designed for combining multiple images. Please use sd_4.0 or sd_4.5 for single image editing, or reply with at least two images.");
      }

      // --- Build the external API URL ---
      let apiUrl = `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;
      if (ratio) apiUrl += `&ratio=${ratio}`;
      apiUrl += qualityParam;
      if (imageUrls.length > 0) {
        apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;
        console.log("✅ Including image URL in API request:", imageUrls);
      } else {
        console.log("ℹ️ No image URL provided – generating new image from prompt only.");
      }
      console.log("🌐 Final external API URL:", apiUrl);

      // Send processing message
      const processingMsg = await message.reply("🎨 | Generating image, please wait... (this may take up to 4 minutes)");
      console.log("⏳ Processing message sent, ID:", processingMsg.messageID);

      // Call the external API
      console.log("⏰ Calling external API with 240s timeout...");
      const res = await axios.get(apiUrl, {
        headers: {
          Cookie: API_COOKIE,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        },
        timeout: 240000, // 4 minutes
        validateStatus: () => true
      });

      console.log("📥 API response received. Status:", res.status);
      console.log("📦 Response headers:", JSON.stringify(res.headers, null, 2));

      const data = res.data;
      if (!data || typeof data !== 'object') {
        console.error("❌ Invalid API response – not an object:", data);
        return message.reply("❌ | Invalid API response.");
      }

      console.log("📄 API response data:", JSON.stringify(data, null, 2));

      if (!data.success || !Array.isArray(data.images) || data.images.length === 0) {
        const errorMsg = data.message || data.error || "Unknown API error";
        console.error("❌ API error:", errorMsg);
        return message.reply(`❌ | API error: ${errorMsg}`);
      }

      const externalImageUrl = data.images[0];
      if (!externalImageUrl || externalImageUrl === "") {
        console.error("❌ API returned empty image URL.");
        return message.reply("❌ | API returned an empty image URL.");
      }

      console.log("✅ External image URL from API:", externalImageUrl);

      // Download the image
      console.log("⏬ Downloading image from external URL...");
      const imageRes = await axios.get(externalImageUrl, {
        responseType: 'arraybuffer',
        timeout: 30000
      });
      const imageBuffer = Buffer.from(imageRes.data, 'binary');
      console.log("📦 Image downloaded, size:", imageBuffer.length);

      // Upload to Imgur
      console.log("⬆️ Uploading to Imgur...");
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
        console.error("❌ Imgur upload failed:", imgurResponse.data);
        return message.reply("❌ | Failed to upload image to Imgur.");
      }

      const imgUrl = imgurResponse.data.data.link;
      console.log("✅ Imgur URL:", imgUrl);

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
      console.log("✅ Command completed successfully");

    } catch (error) {
      console.error("❌ sd command error:", error);
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        return message.reply("❌ | The image generation took too long (over 4 minutes). Please try again later or use a simpler prompt.");
      }
      return message.reply(`❌ | Error: ${error.message}`);
    }
  }
};
