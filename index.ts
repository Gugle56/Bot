import {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { logger } from "../lib/logger.js";

import * as randomCmd from "./commands/random.js";
import * as inventoryCmd from "./commands/inventory.js";
import * as saveCmd from "./commands/save.js";
import * as dailyCmd from "./commands/daily.js";
import * as giveCmd from "./commands/give.js";
import * as storeCmd from "./commands/store.js";
import * as buyCmd from "./commands/buy.js";
import * as helpCmd from "./commands/help.js";
import * as equipCmd from "./commands/equip.js";

interface Command {
  data: SlashCommandOptionsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands: Command[] = [
  randomCmd,
  inventoryCmd,
  equipCmd,
  saveCmd,
  dailyCmd,
  giveCmd,
  storeCmd,
  buyCmd,
  helpCmd,
];

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  logger.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID environment variables");
  process.exit(1);
}

const commandMap = new Collection<string, Command>();
for (const cmd of commands) {
  commandMap.set(cmd.data.name, cmd);
}

async function registerCommands() {
  const rest = new REST().setToken(token!);
  const body = commands.map((c) => c.data.toJSON());
  try {
    logger.info(`Registering ${body.length} slash commands globally...`);
    await rest.put(Routes.applicationCommands(clientId!), { body });
    logger.info("Slash commands registered successfully.");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once(Events.ClientReady, async (c) => {
  logger.info(`Discord bot logged in as ${c.user.tag}`);
  await registerCommands();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) {
    logger.warn(`Unknown command: ${interaction.commandName}`);
    return;
  }

  try {
    await cmd.execute(interaction);
  } catch (err) {
    logger.error({ err, command: interaction.commandName }, "Command error");
    const msg = { content: "❌ Something went wrong. Please try again.", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

client.login(token);

export { client };
