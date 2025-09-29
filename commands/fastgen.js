const axios = require("axios");

module.exports.config = {
  name: "fastgen",
  version: "1.4",
  hasPermssion: 0,
  credits: "TawsiN (Modified by Hassan)",
  description: "Fast AI image generation with reply-based variation",
  commandCategory: "AI-Image",
  usages: "fastgen <prompt> [--ar 2:3]",
  cooldowns: 5,
  usePrefix: true,
  aliases: ["quickimg", "aigen"]
};

module.exports.run = async function ({ api, event, args }) {
  try {
    const replyText = event.messageReply?.body || "";
    const inputText = args.join(" ");
    let fullInput = `${replyText} ${inputText}`.trim();

    if (!fullInput) {
      return api.sendMessage(
        "📝 Please provide a prompt.\nExample: -fastgen a castle on clouds --ar 2:3",
        event.threadID,
        event.messageID
      );
    }

    // Aspect Ratio
    let aspectRatio = "1:1";
    const arMatch = fullInput.match(/--ar\s*(\d+:\d+)/i);
    if (arMatch) {
      aspectRatio = arMatch[1];
      fullInput = fullInput.replace(arMatch[0], "").trim();
    }

    const prompt = fullInput;
    const count = 4;
    const imageLinks = [];

    for (let i = 0; i < count; i++) {
      const res = await axios.get(`https://www.ai4chat.co/api/image/generate`, {
        params: { prompt, aspect_ratio: aspectRatio }
      });

      if (res.data?.image_link) {
        imageLinks.push(res.data.image_link);
      } else {
        console.warn(`⚠️ Image ${i + 1} failed.`);
      }
    }

    if (imageLinks.length === 0) {
      return api.sendMessage("❌ Couldn't generate any images. Try again.", event.threadID, event.messageID);
    }

    const imageStreams = await Promise.all(
      imageLinks.map(link => axios.get(link, { responseType: "stream" }).then(res => res.data))
    );

    api.sendMessage({
      body: `✨ Prompt: "${prompt}"\n📐 Aspect Ratio: ${aspectRatio}\n🖼 Generated 4 Images\n\n👉 Reply with v1, v2, v3 or v4 for a variation`,
      attachment: imageStreams
    }, event.threadID, (err, info) => {
      if (!err) {
        global.api.handleReply.set(info.messageID, {
          name: "fastgen",
          prompt,
          aspectRatio
        });
      }
    }, event.messageID);

  } catch (err) {
    console.error("FASTGEN ERROR:", err.message || err);
    return api.sendMessage("🚨 An error occurred. Please try again later.", event.threadID, event.messageID);
  }
};

module.exports.onReply = async function ({ api, event, Reply }) {
  try {
    const { body, threadID, messageID } = event;
    const variant = body.toLowerCase().trim();

    const variantIndex = { v1: 0, v2: 1, v3: 2, v4: 3 }[variant];
    if (variantIndex === undefined) return;

    const prompt = Reply.prompt;
    const aspectRatio = Reply.aspectRatio;

    const res = await axios.get(`https://www.ai4chat.co/api/image/generate`, {
      params: { prompt, aspect_ratio: aspectRatio }
    });

    if (!res.data?.image_link) {
      return api.sendMessage("❌ Couldn't generate variation image. Try again.", threadID, messageID);
    }

    const imgStream = await axios.get(res.data.image_link, { responseType: "stream" }).then(r => r.data);

    api.sendMessage({
      body: `🔁 Variation (${variant.toUpperCase()}) for: "${prompt}"`,
      attachment: imgStream
    }, threadID, messageID);

  } catch (err) {
    console.error("FASTGEN onReply ERROR:", err.message || err);
    return api.sendMessage("❌ Failed to generate variation image.", event.threadID, event.messageID);
  }
};
