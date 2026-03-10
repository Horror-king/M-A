const axios = require("axios");

// Configuration – move these to environment variables for security
const API_URL = "https://fahim-api-demo.onrender.com/ai/aiease/v1";
const API_COOKIE =
  "connect.sid=s%3A7sKKv8NJgIs6k3gb4DVeDiPAQNr1cyUE.m%2BNmkn%2BHDCqttRUhpW5sm9vjshuCccz3nNSoC3FBQK8";

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
    version: "1.8",
    role: 0,
    author: "S M Fahim",
    countDown: 5,
    category: "image",
    guide: {
      en:
        "{pn} a cute cat --model sd_4.5 --quality 4k\n" +
        "Reply images + {pn} combine them --model nano_banana --ar 3:2"
    }
  },

  onStart: async function ({ api, event, args }) {
    const { supabase, io } = api;
    if (!supabase || !io) {
      console.error("❌ sd command: missing supabase or io in api");
      return;
    }

    const input = args.join(" ").trim();
    if (!input) {
      console.log("sd command: no input");
      return;
    }

    const parsed = parseFlags(input);
    if (!parsed.prompt) {
      console.log("sd command: no prompt after parsing");
      return;
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

    // --- Get image URL from the replied message ---
    let imageUrls = [];
    if (event.messageReply && event.messageReply.id) {
      try {
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
        console.error("❌ Error fetching replied message:", err);
      }
    }

    if (imageUrls.length === 0) {
      console.log("sd command: no image found to edit");
      return;
    }

    // --- Build the external API URL ---
    let apiUrl = `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;
    if (ratio) apiUrl += `&ratio=${ratio}`;
    apiUrl += qualityParam;
    apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;

    try {
      console.log("🔄 Calling external API:", apiUrl);
      const res = await axios.get(apiUrl, {
        headers: {
          Cookie: API_COOKIE,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
        },
        timeout: 60000
      });

      if (!res.data?.success || !Array.isArray(res.data.images) || !res.data.images[0]) {
        console.error("❌ API response missing image:", res.data);
        return;
      }

      const externalImageUrl = res.data.images[0];

      // --- Download the generated image ---
      const imageResponse = await axios.get(externalImageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data, 'binary');

      // --- Upload to your Supabase storage ---
      const fileName = `sd_${Date.now()}.png`;
      const filePath = `sd/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from('chat_images')
        .upload(filePath, imageBuffer, {
          contentType: 'image/png',
          upsert: false
        });

      if (uploadError) {
        console.error("❌ Upload error:", uploadError);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('chat_images')
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;
      console.log("✅ Image uploaded to:", publicUrl);

      // --- Prepare the bot's response message ---
      const botMessage = {
        content: `✅ | ${realModel} Result\n\n🧠 Prompt: ${prompt}\n⚙ Model: ${realModel}\n🖼 Ratio: ${ratio || "Auto (API)"}\n${qualityText}${imageUrls.length ? `🧩 Images used: ${imageUrls.length}\n` : ""}`,
        username: 'Bot',
        image_url: publicUrl,
        reply_to: null,
        created_at: new Date().toISOString()
      };

      // --- Save the message to the database ---
      const { data: savedMsg, error: insertError } = await supabase
        .from('chatter')
        .insert([botMessage])
        .select();

      if (insertError) {
        console.error("❌ Error saving bot message:", insertError);
        return;
      }

      console.log("✅ Bot message saved, broadcasting via socket...");
      io.emit('new-message', savedMsg[0]);

    } catch (error) {
      console.error("❌ sd command error:", error);
    }
  }
};
