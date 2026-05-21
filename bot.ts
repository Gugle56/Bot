import "dotenv/config";
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type Role,
} from "discord.js";
import Database from "better-sqlite3";
import path from "node:path";

// ─── Database (SQLite, no setup needed) ───────────────────────────────────────

const db = new Database(path.join(process.cwd(), "tokens.db"));
db.exec(`CREATE TABLE IF NOT EXISTS user_tokens (
  user_id TEXT PRIMARY KEY,
  tokens  INTEGER NOT NULL DEFAULT 0
)`);

const stmtUpsert = db.prepare("INSERT INTO user_tokens (user_id, tokens) VALUES (?, 0) ON CONFLICT DO NOTHING");
const stmtDecr   = db.prepare("UPDATE user_tokens SET tokens = tokens - 1 WHERE user_id = ? AND tokens > 0");
const stmtAdd    = db.prepare<[string, number], { tokens: number }>(
  "INSERT INTO user_tokens (user_id, tokens) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET tokens = tokens + excluded.tokens RETURNING tokens"
);
const stmtGet    = db.prepare<[string], { tokens: number }>("SELECT tokens FROM user_tokens WHERE user_id = ?");

function consumeToken(userId: string): boolean {
  stmtUpsert.run(userId);
  return stmtDecr.run(userId).changes > 0;
}

function giveTokens(userId: string, amount: number): number {
  return (stmtAdd.get(userId, amount))?.tokens ?? amount;
}

function getTokens(userId: string): number {
  return stmtGet.get(userId)?.tokens ?? 0;
}

// ─── Rarity ──────────────────────────────────────────────────────────────────

type RarityTier = { name: string; label: string; cumulative: number };

const RARITIES: RarityTier[] = [
  { name: "common",    label: "⬜ Common",    cumulative: 0.50 },
  { name: "uncommon",  label: "🟩 Uncommon",  cumulative: 0.75 },
  { name: "rare",      label: "🟦 Rare",       cumulative: 0.90 },
  { name: "epic",      label: "🟪 Epic",       cumulative: 0.98 },
  { name: "legendary", label: "🌟 Legendary",  cumulative: 1.00 },
];

function rollRarity(): RarityTier {
  const roll = Math.random();
  return RARITIES.find((r) => roll < r.cumulative) ?? RARITIES[RARITIES.length - 1]!;
}

// ─── Color generation ─────────────────────────────────────────────────────────

function hslToColor(h: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
}

function rand(min: number, max: number) { return min + Math.random() * (max - min); }

const LEGENDARY_COLORS = [0xff0000,0x00ff00,0x0000ff,0xffff00,0xff00ff,0x00ffff,0xffffff,0xffd700,0xff4500,0x5865f2];

function generateColor(rarity: RarityTier): number {
  const h = rand(0, 360);
  switch (rarity.name) {
    case "common":    return hslToColor(h, rand(0.00, 0.25), rand(0.30, 0.65));
    case "uncommon":  return hslToColor(h, rand(0.25, 0.55), rand(0.55, 0.80));
    case "rare":      return hslToColor(h, rand(0.55, 0.80), rand(0.35, 0.60));
    case "epic":      return hslToColor(h, rand(0.80, 1.00), rand(0.30, 0.55));
    case "legendary": return LEGENDARY_COLORS[Math.floor(Math.random() * LEGENDARY_COLORS.length)]!;
    default:          return Math.floor(Math.random() * 0xffffff);
  }
}

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, "0").toUpperCase()}`;
}

// ─── Color naming ─────────────────────────────────────────────────────────────

const NAMED_COLORS: [string, number][] = [
  ["Black",0x000000],["White",0xffffff],["Red",0xff0000],["Lime",0x00ff00],["Blue",0x0000ff],
  ["Yellow",0xffff00],["Cyan",0x00ffff],["Magenta",0xff00ff],["Silver",0xc0c0c0],["Gray",0x808080],
  ["Maroon",0x800000],["Olive",0x808000],["Green",0x008000],["Purple",0x800080],["Teal",0x008080],
  ["Navy",0x000080],["Orange",0xff8000],["Gold",0xffd700],["Crimson",0xdc143c],["Coral",0xff7f50],
  ["Salmon",0xfa8072],["Tomato",0xff6347],["Orange Red",0xff4500],["Dark Orange",0xff8c00],
  ["Hot Pink",0xff69b4],["Deep Pink",0xff1493],["Pink",0xffc0cb],["Light Pink",0xffb6c1],
  ["Violet",0xee82ee],["Orchid",0xda70d6],["Plum",0xdda0dd],["Medium Orchid",0xba55d3],
  ["Dark Violet",0x9400d3],["Blue Violet",0x8a2be2],["Indigo",0x4b0082],["Lavender",0xe6e6fa],
  ["Medium Purple",0x9370db],["Royal Blue",0x4169e1],["Dodger Blue",0x1e90ff],["Deep Sky Blue",0x00bfff],
  ["Sky Blue",0x87ceeb],["Steel Blue",0x4682b4],["Cornflower Blue",0x6495ed],["Midnight Blue",0x191970],
  ["Slate Blue",0x6a5acd],["Cadet Blue",0x5f9ea0],["Powder Blue",0xb0e0e6],["Light Blue",0xadd8e6],
  ["Aquamarine",0x7fffd4],["Turquoise",0x40e0d0],["Dark Turquoise",0x00ced1],["Sea Green",0x2e8b57],
  ["Medium Sea Green",0x3cb371],["Spring Green",0x00ff7f],["Chartreuse",0x7fff00],["Lawn Green",0x7cfc00],
  ["Yellow Green",0x9acd32],["Olive Drab",0x6b8e23],["Dark Green",0x006400],["Forest Green",0x228b22],
  ["Lime Green",0x32cd32],["Pale Green",0x98fb98],["Khaki",0xf0e68c],["Dark Khaki",0xbdb76b],
  ["Tan",0xd2b48c],["Burlywood",0xdeb887],["Sandy Brown",0xf4a460],["Peru",0xcd853f],
  ["Chocolate",0xd2691e],["Sienna",0xa0522d],["Brown",0xa52a2a],["Saddle Brown",0x8b4513],
  ["Firebrick",0xb22222],["Dark Red",0x8b0000],["Rose",0xff007f],["Discord Blurple",0x5865f2],
  ["Amber",0xffbf00],["Wheat",0xf5deb3],["Peach",0xffcba4],["Mauve",0xe0b0ff],
];

function getColorName(color: number): string {
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  let bestName = "Unknown", bestDist = Infinity;
  for (const [name, ref] of NAMED_COLORS) {
    const dr = r - ((ref >> 16) & 0xff), dg = g - ((ref >> 8) & 0xff), db = b - (ref & 0xff);
    const dist = dr*dr + dg*dg + db*db;
    if (dist < bestDist) { bestDist = dist; bestName = name; }
  }
  return bestName;
}

// ─── Role management ──────────────────────────────────────────────────────────

const HEX_ROLE_RE = /^#[0-9A-F]{6}$/;

async function getOrCreateColorRole(guild: Guild, member: GuildMember, color: number): Promise<Role> {
  const hexName = toHex(color);
  const existing = member.roles.cache.find((r) => HEX_ROLE_RE.test(r.name));
  if (existing) return existing.edit({ name: hexName, colors: { primaryColor: color }, reason: "Personal color updated" });
  const newRole = await guild.roles.create({ name: hexName, colors: { primaryColor: color }, reason: "Personal color role" });
  await member.roles.add(newRole, "Personal color roll");
  return newRole;
}

// ─── Command handlers ─────────────────────────────────────────────────────────

async function handlePray(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  if (!isAdmin) {
    if (!consumeToken(interaction.user.id)) {
      await interaction.reply({ content: "You have no tokens left. Ask an admin for more with `/respect`.", ephemeral: true });
      return;
    }
  }
  const targetUser = interaction.options.getUser("user") ?? interaction.user;
  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: "Could not find that member.", ephemeral: true });
    return;
  }
  const rarity = rollRarity();
  const color = generateColor(rarity);
  await getOrCreateColorRole(interaction.guild, member, color);
  const isSelf = targetUser.id === interaction.user.id;
  const who = isSelf ? "You" : `**${member.displayName}**`;
  await interaction.reply(`${who} rolled \`${toHex(color)}\` **${getColorName(color)}** — ${rarity.label}!`);
}

async function handleRespect(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }
  const targetUser = interaction.options.getUser("user", true);
  const amount = interaction.options.getInteger("amount") ?? 1;
  const newTotal = giveTokens(targetUser.id, amount);
  await interaction.reply(`Gave **${amount}** token${amount === 1 ? "" : "s"} to <@${targetUser.id}>. They now have **${newTotal}** token${newTotal === 1 ? "" : "s"}.`);
}

async function handleRespectCheck(interaction: ChatInputCommandInteraction) {
  const targetUser = interaction.options.getUser("user") ?? interaction.user;
  const isSelf = targetUser.id === interaction.user.id;
  const tokens = getTokens(targetUser.id);
  const who = isSelf ? "You have" : `**${targetUser.displayName}** has`;
  await interaction.reply(`${who} **${tokens}** respect token${tokens === 1 ? "" : "s"}.`);
}

// ─── Startup ──────────────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("pray")
    .setDescription("Spend a token to roll a random colour for yourself or another member")
    .addUserOption((opt) => opt.setName("user").setDescription("Member to roll for (defaults to you)").setRequired(false)),
  new SlashCommandBuilder()
    .setName("respect")
    .setDescription("Admin only: give tokens to a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((opt) => opt.setName("user").setDescription("Member to give tokens to").setRequired(true))
    .addIntegerOption((opt) => opt.setName("amount").setDescription("Number of tokens to give (default 1)").setMinValue(1).setRequired(false)),
  new SlashCommandBuilder()
    .setName("respect-check")
    .setDescription("Check how many respect tokens you (or another member) have")
    .addUserOption((opt) => opt.setName("user").setDescription("Member to check (defaults to you)").setRequired(false)),
].map((cmd) => cmd.toJSON());

async function main() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not set in your .env file");

  const rest = new REST().setToken(token);
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("clientReady", async (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    await rest.put(Routes.applicationCommands(c.user.id), { body: commands });
    console.log("Slash commands registered.");
  });

  client.on("interactionCreate", async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      if      (interaction.commandName === "pray")          await handlePray(interaction);
      else if (interaction.commandName === "respect")       await handleRespect(interaction);
      else if (interaction.commandName === "respect-check") await handleRespectCheck(interaction);
    } catch (err) {
      console.error("Error handling interaction:", err);
      const msg = { content: "Something went wrong.", ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg.content);
      else await interaction.reply(msg);
    }
  });

  await client.login(token);
}

main().catch(console.error);
