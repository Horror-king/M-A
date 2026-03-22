const axios = require("axios");
const FormData = require("form-data");

const API_URL = "https://fahim-api-demo.onrender.com/ai/aiease/v1";
const API_COOKIE = "connect.sid=s%3A7sKKv8NJgIs6k3gb4DVeDiPAQNr1cyUE.m%2BNmkn%2BHDCqttRUhpW5sm9vjshuCccz3nNSoC3FBQK8";

const ALLOWED_RATIOS = ["1:1","5:4","4:5","4:3","3:4","3:2","2:3","16:9","9:16","21:9"];

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
  return { prompt: promptParts.join(" "), ratio, model, quality };
}

function extractImageUrlFromMessage(msg) {
  if (!msg) return null;
  // 1. Direct image_url field (Fixes the empty string issue in your screenshot)
  if (msg.image_url && typeof msg.image_url === 'string' && msg.image_url.trim() !== '') {
    return msg.image_url;
  }
  // 2. Metadata or Attachments
  const target = msg.metadata || msg;
  if (target.image_url && target.image_url.trim() !== '') return target.image_url;
  
  if (msg.attachments) {
    try {
      const atts = typeof msg.attachments === 'string' ? JSON.parse(msg.attachments) : msg.attachments;
      if (Array.isArray(atts)) {
        const img = atts.find(a => a.url && /\.(jpg|jpeg|png|gif|webp)/i.test(a.url));
        if (img) return img.url;
      }
    } catch (e) {}
  }
  // 3. Regex match in content
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
    version: "4.1",
    role: 0,
    author: "Hassan + Modified",
    countDown: 5,
    category: "image",
    guide: { en: "Reply to an image with: {pn} change her clothes" }
  },

  onStart: async function ({ message, args, event, supabase }) {
    try {
      const input = args.join(" ").trim();
      if (!input) return message.reply("❌ | Please provide a prompt.");

      let imageUrls = [];

      // Priority 1: Reply Detection
      const replyID = event.reply_to || (event.messageReply ? event.messageReply.messageID : null);
      
      if (replyID && supabase) {
        const { data: dbMsg } = await supabase.from("chatter").select("*").eq("id", replyID).single();
        if (dbMsg) {
          const imgUrl = extractImageUrlFromMessage(dbMsg);
          if (imgUrl) imageUrls.push(imgUrl);
        }
      }

      // Priority 2: Direct messageReply object (if passed from index.js)
      if (imageUrls.length === 0 && event.messageReply?.image_url) {
        imageUrls.push(event.messageReply.image_url);
      }

      // Priority 3: Links in the prompt
      const urlMatch = input.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
      if (urlMatch && imageUrls.length === 0) imageUrls.push(urlMatch[0]);

      // Handle Pipe logic
      let promptInput = input;
      if (input.includes("|")) {
        const parts = input.split("|");
        const linkPart = parts[0].trim();
        if (linkPart.startsWith("http")) {
          imageUrls = linkPart.split(",").map(x => x.trim());
        }
        promptInput = parts.slice(1).join("|").trim();
      }

      const parsed = parseFlags(promptInput);
      const prompt = parsed.prompt;
      const modelKey = parsed.model || "sd_4.5";
      const realModel = MODEL_MAP[modelKey] || MODEL_MAP["sd_4.5"];
      const ratio = (parsed.ratio && ALLOWED_RATIOS.includes(parsed.ratio)) ? parsed.ratio : null;

      let apiUrl = `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;
      if (ratio) apiUrl += `&ratio=${ratio}`;
      if (realModel !== "kie_nano_banana") {
        apiUrl += `&quality=${parsed.quality || "2k"}`;
      }
      if (imageUrls.length > 0) {
        apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;
      }

      await message.reply("🎨 Generating image... please wait");
      const res = await axios.get(apiUrl, { headers: { Cookie: API_COOKIE }, timeout: 240000 });
      
      if (!res.data.success) return message.reply(`❌ Error: ${res.data.message}`);

      // Final Upload to Imgur and Reply
      const imgBuffer = await axios.get(res.data.images[0], { responseType: "arraybuffer" });
      const form = new FormData();
      form.append("image", Buffer.from(imgBuffer.data).toString("base64"));
      form.append("type", "base64");

      const imgur = await axios.post("https://api.imgur.com/3/image", form, {
        headers: { ...form.getHeaders(), Authorization: "Client-ID 225899c9a3312bd" }
      });

      return message.reply(`✅ | Result\n\nPrompt: ${prompt}\nModel: ${realModel}\n\n${imgur.data.data.link}`);
    } catch (error) {
      return message.reply(`❌ Error: ${error.message}`);
    }
  }
};

