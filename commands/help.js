module.exports = {
  config: {
    name: "help",
    aliases: ["commands", "menu"],
    version: "1.0",
    author: "Hassan",
    role: 0,
    shortDescription: "Show all available commands",
    longDescription: "Displays a list of all available commands with their usage.",
    category: "system",
    guide: {
      en: "{pn} [command name] - Show details about a specific command"
    }
  },

  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;

    // If user typed: help <command>
    if (args[0]) {
      const cmdName = args[0].toLowerCase();
      const cmd =
        global.client.commands.get(cmdName) ||
        [...global.client.commands.values()].find(c => c.config.aliases?.includes(cmdName));

      if (!cmd) {
        return api.sendMessage(`❌ Command "${cmdName}" not found.`, threadID, messageID);
      }

      const { name, aliases, version, author, shortDescription, longDescription, guide } = cmd.config;

      return api.sendMessage(
        `📖 Command: ${name}\n` +
          (aliases?.length ? `🔗 Aliases: ${aliases.join(", ")}\n` : "") +
          `📝 Description: ${longDescription || shortDescription || "No description"}\n` +
          `⚙️ Version: ${version || "1.0"}\n` +
          `👤 Author: ${author || "Unknown"}\n` +
          (guide?.en ? `\n📌 Usage:\n${guide.en}` : ""),
        threadID,
        messageID
      );
    }

    // Otherwise show full list
    let msg = "📚 Available Commands:\n\n";
    const categories = {};

    for (const cmd of global.client.commands.values()) {
      const cat = cmd.config.category || "Other";
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(cmd.config.name);
    }

    for (const [cat, cmds] of Object.entries(categories)) {
      msg += `📂 ${cat}:\n  ${cmds.join(", ")}\n\n`;
    }

    msg += "ℹ️ Use: help <command> to see details about a specific command.";

    return api.sendMessage(msg, threadID, messageID);
  }
};
