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

module.exports = {
  config: {
    name: "sd",
    aliases: ["seedream"],
    version: "4.1-FIXED",
    role: 0,
    author: "Hassan + FIXED",
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

  onStart: async function ({ message, args, event }) {
    try {
      let input = args.join(" ").trim();

      if (!input) {
        return message.reply("❌ | Please provide a prompt.");
      }

      // ---------- COLLECT IMAGE URLS ----------
      let imageUrls = [];

      // 🔥 1️⃣ PRIORITY: reply image (FORCE USE)
      if (event && event.messageReply) {
        console.log("📨 Replied message data:", event.messageReply);

        // ✅ FIRST: direct image_url (MOST IMPORTANT FIX)
        if (event.messageReply.image_url) {
          imageUrls.push(event.messageReply.image_url);
          console.log("🚀 Using image_url:", event.messageReply.image_url);
        }

        // ✅ SECOND: attachments
        if (imageUrls.length === 0 && event.messageReply.attachments?.length > 0) {
          const att = event.messageReply.attachments.find(a => a.url);
          if (att) {
            imageUrls.push(att.url);
            console.log("🚀 Using attachment:", att.url);
          }
        }

        // ✅ THIRD: extract ANY URL (not only .jpg)
        if (imageUrls.length === 0 && event.messageReply.body) {
          const match = event.messageReply.body.match(/https?:\/\/[^\s]+/i);
          if (match) {
            imageUrls.push(match[0]);
            console.log("🚀 Using body URL:", match[0]);
          }
        }
      }

      // 🔥 2️⃣ PIPE SYNTAX (only if no reply image)
      let promptInput = input;
      if (input.includes("|") && imageUrls.length === 0) {
        const parts = input.split("|");
        const linkPart = parts[0].trim();
        const promptPart = parts.slice(1).join("|").trim();

        if (linkPart.startsWith("http")) {
          const pipeUrls = linkPart.split(",").map(x => x.trim());
          imageUrls.push(...pipeUrls);
          console.log("🔗 Using pipe URLs:", pipeUrls);
        }

        promptInput = promptPart;
      }

      console.log("🧩 FINAL IMAGE URLS:", imageUrls);

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

      // ---------- VALIDATION ----------
      if (realModel === "kie_nano_banana") {
        if (imageUrls.length < 2) {
          return message.reply(
            "⚠️ nano_banana requires at least 2 images."
          );
        }
      } else {
        if (imageUrls.length > 1) {
          message.reply("⚠️ Multiple images detected. Using first only.");
          imageUrls = [imageUrls[0]];
        }
      }

      // ---------- BUILD API ----------
      let apiUrl =
        `${API_URL}?prompt=${encodeURIComponent(prompt)}&model=${realModel}`;

      if (ratio) apiUrl += `&ratio=${ratio}`;
      apiUrl += qualityParam;

      // 🔥 CRITICAL: ALWAYS FORCE IMAGE INTO API
      if (imageUrls.length > 0) {
        apiUrl += `&url=${encodeURIComponent(imageUrls.join(","))}`;
        console.log("🚀 FORCED IMAGE:", imageUrls);
      } else {
        console.log("⚠️ NO IMAGE USED (text-to-image)");
      }

      console.log("🌐 API URL READY");

      await message.reply(
        "🎨 Generating image... please wait (up to 4 minutes)"
      );

      const res = await axios.get(apiUrl, {
        headers: {
          Cookie: API_COOKIE,
          "User-Agent": "Mozilla/5.0"
        },
        timeout: 240000,
        validateStatus: () => true
      });

      console.log("📡 STATUS:", res.status);

      const data = res.data;

      if (!data || !data.success || !data.images?.length) {
        console.log("❌ API FAIL:", data);
        return message.reply(`❌ API error: ${data?.message || "Unknown error"}`);
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
${qualityText}🧩 Image used: ${imageUrls.length ? "YES" : "NO"}

${imgUrl}`;

      await message.reply(replyText);

    } catch (error) {
      if (error.code === "ECONNABORTED") {
        return message.reply("❌ Timeout. Try simpler prompt.");
      }
      return message.reply(`❌ Error: ${error.message}`);
    }
  }
};
