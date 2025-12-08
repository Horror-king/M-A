const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

// Your API keys
const IMGUR_CLIENT_ID = "225899c9a3312bd"; // Optional - not needed for basic version
const CLIPDROP_API_KEY = "0191d129d8d32d9587cd5a6d745a9e4221fbbe340b955a100b13d0e4bb404df99f861a86469516314f76a540723ca216";

function tmpFile(name = "crip") {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return path.join(process.cwd(), `${name}_${id}.png`);
}

module.exports = {
  config: {
    name: "crip2",
    version: "1.0",
    author: "Hassan",
    countDown: 45,
    role: 0,
    shortDescription: { en: "Generate AI images from text" },
    longDescription: { 
      en: "Create AI-generated images from text prompts using ClipDrop API" 
    },
    category: "image",
    guide: { en: "!crip <your prompt>" }
  },

  onStart: async function ({ api, event, args }) {
    try {
      // Check if user provided prompt
      if (!args.length) {
        return api.sendMessage(
          `🎨 **Crip AI Image Generator**\n\n📝 **Usage:** !crip <your prompt>\n\n✨ **Examples:**\n• !crip beautiful sunset over mountains\n• !crip cute cat wearing sunglasses\n• !crip futuristic city with flying cars`,
          event.threadID,
          event.messageID
        );
      }

      const prompt = args.join(" ").trim();
      
      // Send initial processing message
      const processingMsg = await api.sendMessage(
        `🔄 **Generating image...**\n\n📝 **Prompt:** "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"\n⏳ Please wait 20-45 seconds...`,
        event.threadID,
        event.messageID
      );

      console.log(`[Crip AI] Generating image for: "${prompt}"`);
      console.log(`[Crip AI] Using API key: ${CLIPDROP_API_KEY.substring(0, 15)}...`);
      
      // --- Generate image via ClipDrop API ---
      const clipdropResp = await fetch("https://clipdrop-api.co/text-to-image/v1", {
        method: "POST",
        headers: {
          "x-api-key": CLIPDROP_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ prompt }),
        timeout: 45000
      });

      console.log(`[Crip AI] Response status: ${clipdropResp.status} ${clipdropResp.statusText}`);

      if (!clipdropResp.ok) {
        const errorText = await clipdropResp.text();
        console.error("[Crip AI] ClipDrop Error:", errorText);
        
        let errorMessage = `API Error ${clipdropResp.status}`;
        
        if (clipdropResp.status === 401) {
          errorMessage = "Invalid API key. The key may be expired or incorrect.";
        } else if (clipdropResp.status === 402) {
          errorMessage = "No credits remaining. Get more at https://clipdrop.co";
        } else if (clipdropResp.status === 400) {
          errorMessage = "Bad request. The prompt might contain restricted content.";
        } else if (clipdropResp.status === 429) {
          errorMessage = "Too many requests. Please wait a minute and try again.";
        } else if (clipdropResp.status === 500) {
          errorMessage = "Server error. Please try a different prompt.";
        }
        
        throw new Error(`${errorMessage} (Status: ${clipdropResp.status})`);
      }

      // Get image buffer
      const imageBuffer = await clipdropResp.buffer();
      console.log(`[Crip AI] Received image: ${Math.round(imageBuffer.length / 1024)}KB`);
      
      // Check if image is valid
      if (!imageBuffer || imageBuffer.length < 1000) {
        throw new Error("Invalid image received from API (too small)");
      }

      // Save temporarily (for debugging and as backup)
      const tempFilePath = tmpFile();
      fs.writeFileSync(tempFilePath, imageBuffer);
      console.log(`[Crip AI] Image saved: ${tempFilePath}`);

      // Delete processing message
      if (processingMsg && processingMsg.messageID) {
        await api.unsendMessage(processingMsg.messageID);
      }

      // Send the image directly
      return api.sendMessage(
        {
          body: `✅ **Image Generated Successfully!**\n\n📝 **Prompt:** "${prompt}"\n✨ **Powered by ClipDrop AI**\n\n💡 **Tip:** The image is attached below.`,
          attachment: fs.createReadStream(tempFilePath)
        },
        event.threadID,
        event.messageID,
        async () => {
          // Clean up temp file after sending
          try {
            fs.unlinkSync(tempFilePath);
            console.log(`[Crip AI] Cleaned up: ${tempFilePath}`);
          } catch (cleanupError) {
            console.error("[Crip AI] Cleanup error:", cleanupError);
          }
        }
      );

    } catch (error) {
      console.error("[Crip AI] Error:", error);
      
      // Clean up any temp files
      try {
        const tempFiles = fs.readdirSync(process.cwd())
          .filter(file => file.startsWith("crip_") && file.endsWith(".png"));
        
        tempFiles.forEach(file => {
          try { 
            fs.unlinkSync(path.join(process.cwd(), file)); 
            console.log(`[Crip AI] Cleaned orphaned file: ${file}`);
          } catch {}
        });
      } catch {}
      
      let errorMessage = `❌ **Failed to generate image**\n\n**Error:** ${error.message}`;
      
      // Add troubleshooting tips
      errorMessage += `\n\n🔧 **Troubleshooting:**\n`;
      errorMessage += `1. Check your prompt - avoid inappropriate content\n`;
      errorMessage += `2. Try a simpler, shorter prompt\n`;
      errorMessage += `3. Wait 60 seconds and try again\n`;
      errorMessage += `4. Make sure you have internet connection\n`;
      errorMessage += `5. Try: !crip "simple colorful background"`;
      
      return api.sendMessage(
        errorMessage,
        event.threadID,
        event.messageID
      );
    }
  }
};
