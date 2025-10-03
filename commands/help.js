// commands/help.js
module.exports = {
  config: {
    name: "help",
    aliases: ["commands", "menu"],
    description: "Show a list of all available commands"
  },
  onStart: async function ({ api, message }) {
    try {
      const commands = Object.values(require.cache)
        .filter(m => m.exports?.config?.name)
        .map(m => m.exports.config);

      if (!commands.length) {
        return message.reply("⚠️ No commands found.");
      }

      let reply = "📜 Available Commands:\n\n";
      for (const cmd of commands) {
        reply += `🔹 ${cmd.name}`;
        if (cmd.aliases?.length) {
          reply += ` (aliases: ${cmd.aliases.join(", ")})`;
        }
        if (cmd.description) {
          reply += ` – ${cmd.description}`;
        }
        reply += "\n";
      }

      message.reply(reply);
    } catch (err) {
      console.error("❌ Help command error:", err);
      message.reply("❌ Failed to load help menu.");
    }
  }
};
