const axios = require("axios");
const FormData = require("form-data");

const API_URL = "https://fahim-api-demo.onrender.com/ai/aiease/v1";
const API_COOKIE = "connect.sid=s%3A7sKKv8NJgIs6k3gb4DVeDiPAQNr1cyUE.m%2BNmkn%2BHDCqttRUhpW5sm9vjshuCccz3nNSoC3FBQK8";

const ALLOWED_RATIOS = [
  "1:1","5:4","4:5","4:3","3:4",
  "3:2","2:3","16:9","9:16","21:9"
];

const MODEL_MAP = {
  "sd_4.0": "doubao-seedream-4.0",
  "sd_4.5": "doubao-seedream-4.5",
  "nano_banana": "kie_nano_banana"
};

const ALLOWED_QUALITY = ["2k","4k"];

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

// Helper to extract image URL from a message object
function extractImageUrlFromMessage(msg) {
  if (!msg) return null;

  // 1. Direct image_url field
  if (msg.image_url && typeof msg.image_url === 'string' && msg.image_url.trim() !== '') {
    return msg.image_url;
  }

  // 2. Attachments array
  if (msg.attachments) {
    try {
      const atts = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments;
      if (Array.isArray(atts)) {
        const img = atts.find(a => a.type === 'photo' || a.type === 'image' || (a.url && /\.(jpg|jpeg|png|gif|webp)/i.test(a.url)));
        if (img && img.url) return img.url;
      }
    } catch (e) {}
  }

  // 3. Look for URL in content
  if (msg.content) {
    const match = msg.content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
    if (match) return match[0];
  }

  return null;
}

module.exports = {
  config: {
    name: "sd",
    aliases: ["seedream"],
    version: "4.0",
    role: 0,
    author: "Hassan + Modified",
    countDown: 5,
    category: "image",
    guide: {
      en:
`Generate image:
{pn} a cute cat --model sd_4.5 --quality 4k

Edit image (via reply):
Reply to an image with {pn} make it anime style --model sd_4.5

Combine images:
{pn} img1.jpg,img2.jpg | combine them --model nano_banana --ratio 3:2`
    }
  },

  onStart: async function ({ message, args, event, supabase }) {
    try {
      const input = args.join(" ").trim();

      if (!input) {
        return message.reply("❌ | Please provide a prompt.");
      }

      // ---------- COLLECT IMAGE URLS ----------
      let imageUrls = [];

      // ========== PRIMARY METHOD: Use event.reply_to to fetch from database ==========
      if (event.reply_to && supabase) {
        console.log("🔍 Using event.reply_to to fetch image from DB:", event.reply_to);
        try {
          const { data: dbMsg, error } = await supabase
            .from("chatter")
            .select("*")
            .eq("id", event.reply_to)
            .single();

          if (!error && dbMsg) {
            const imgUrl = extractImageUrlFromMessage(dbMsg);
            if (imgUrl) {
              imageUrls.push(imgUrl);
              console.log("📸 Found image from DB via reply_to:", imgUrl);
            } else {
              console.log("⚠️ No image in replied message (DB)");
            }
          } else {
            console.log("⚠️ Could not fetch replied message from DB:", error?.message);
          }
        } catch (err) {
          console.error("❌ DB fetch error:", err);
        }
      }

      // ========== FALLBACK: Use event.messageReply if provided ==========
      if (imageUrls.length === 0 && event.messageReply) {
        console.log("📨 Trying event.messageReply as fallback:", event.messageReply);
        if (event.messageReply.attachments && event.messageReply.attachments.length > 0) {
          event.messageReply.attachments.forEach(att => {
            if (att.url) imageUrls.push(att.url);
          });
        }
        if (event.messageReply.image_url) {
          imageUrls.push(event.messageReply.image_url);
        }
        if (event.messageReply.body) {
          const match = event.messageReply.body.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|webp|gif)/i);
          if (match) imageUrls.push(match[0]);
        }
      }

      // ========== FALLBACK: Check if the message body contains a direct image link ==========
      if (imageUrls.length === 0) {
        const urlMatch = input.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
        if (urlMatch) {
          imageUrls.push(urlMatch[0]);
          console.log("📸 Found image URL in prompt:", urlMatch[0]);
        }
      }

      // 2️⃣  Handle the pipe syntax (img1.jpg,img2.jpg | prompt)
      let promptInput = input;
      if (input.includes("|")) {
        const parts = input.split("|");
        const linkPart = parts[0].trim();
        const promptPart = parts.slice(1).join("|").trim();

        if (linkPart.startsWith("http")) {
          const pipeUrls = linkPart.split(",").map(x => x.trim());
          imageUrls.push(...pipeUrls);
          console.log("🔗 URLs from pipe syntax:", pipeUrls);
        }
        promptInput = promptPart;
      }

      // ---------- PARSE FLAGS ----------
      const parsed = parseFlags(promptInput);

      if (!parsed.prompt) {
        return message.reply("❌ | Prompt cannot be empty.");
      }

      const prompt = parsed.prompt;

      const modelKey = parsed.model || "sd_4.5";
      const realModel = MODEL_MAP[modelKey] || MODEL_MAP["sd_4.5"];

      const ratio =
        parsed.ratio && ALLOWED_RATIOS.includes(parsed.ratio)
          ? parsed.ratio
          : null;

      let qualityParam = "";
      let qualityText = "";

      if (realModel !== "kie_nano_banana") {
        const quality =
          ALLOWED_QUALITY.includes(parsed.quality)
            ? parsed.quality
            : "2k";

        qualityParam = `&quality=${quality}`;
        qualityText = `📐 Quality: ${quality}\n`;
      }

      // ---------- VALIDATE IMAGE COUNT ----------
      if (realModel === "kie_nano_banana") {
        if (imageUrls.length < 2) {
          return message.reply(
            "⚠️ nano_banana requires at least **2 images**.\nExample:\n-sd img1.jpg,img2.jpg | combine them --model nano_banana"
          );
        }
      } else {
        if (imageUrls.length > 1) {
          message.reply(`⚠️ Multiple images detected. Only the first image will be used.`);
          imageUrls = [imageUrls[0]];
        }
      }

      // ---------- BUILD API URL ----------
      let apiUrl =
        `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;

      if (ratio) apiUrl += `&ratio=${ratio}`;
      apiUrl += qualityParam;

      if (imageUrls.length > 0) {
        apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;
      }

      console.log("🚀 Final API URL (sanitized):", apiUrl.replace(API_COOKIE, "HIDDEN"));

      const processing = await message.reply(
        "🎨 Generating image... please wait (up to 4 minutes)"
      );

      const res = await axios.get(apiUrl, {
        headers: {
          Cookie: API_COOKIE,
          "User-Agent": "Mozilla/5.0"
        },
        timeout: 240000
      });

      const data = res.data;

      if (!data.success || !data.images || data.images.length === 0) {
        return message.reply(`❌ API error: ${data.message || "Unknown error"}`);
      }

      const externalImageUrl = data.images[0];

      const imageRes = await axios.get(externalImageUrl, {
        responseType: "arraybuffer"
      });

      const imageBuffer = Buffer.from(imageRes.data, "binary");

      const form = new FormData();
      form.append("image", imageBuffer.toString("base64"));
      form.append("type", "base64");

      const imgurResponse = await axios.post(
        "https://api.imgur.com/3/image",
        form,
        {
          headers: {
            ...form.getHeaders(),
            Authorization: "Client-ID 225899c9a3312bd"
          }
        }
      );

      const imgUrl = imgurResponse.data.data.link;

      const replyText =
`✅ | ${realModel} Result

🧠 Prompt: ${prompt}
⚙ Model: ${realModel}
🖼 Ratio: ${ratio || "Auto"}
${qualityText}${imageUrls.length ? `🧩 Images used: ${imageUrls.length}\n` : ""}

${imgUrl}`;

      await message.reply(replyText);

    } catch (error) {
      if (error.code === "ECONNABORTED") {
        return message.reply(
          "❌ Image generation timeout. Try a simpler prompt."
        );
      }
      return message.reply(`❌ Error: ${error.message}`);
    }
  }
};
