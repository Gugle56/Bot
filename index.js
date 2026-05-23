import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  Client, GatewayIntentBits, Collection, Events,
  REST, Routes, SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits,
} from "discord.js";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DB_PATH   = "./users.json";

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in environment.");
  process.exit(1);
}

// ─── JSON DATABASE ────────────────────────────────────────────────────────────

function loadUsers() {
  if (!existsSync(DB_PATH)) { writeFileSync(DB_PATH, "{}", "utf8"); return {}; }
  try { return JSON.parse(readFileSync(DB_PATH, "utf8")) || {}; } catch { return {}; }
}

function saveUsers(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf8");
}

function getUser(id) {
  const users = loadUsers();
  if (!users[id]) {
    users[id] = { tokens: 3, lastDaily: null, inventory: [], slots: 1 };
    saveUsers(users);
  }
  return users[id];
}

function updateUser(id, patch) {
  const users = loadUsers();
  users[id] = { ...users[id], ...patch };
  saveUsers(users);
  return users[id];
}

function spendTokens(id, amount) {
  const u = getUser(id);
  if (u.tokens < amount) return false;
  updateUser(id, { tokens: u.tokens - amount });
  return true;
}

function addTokens(id, amount) {
  const u = getUser(id);
  const tokens = u.tokens + amount;
  updateUser(id, { tokens });
  return tokens;
}

function claimDaily(id) {
  const u = getUser(id);
  if (u.lastDaily) {
    const hoursLeft = 12 - (Date.now() - new Date(u.lastDaily).getTime()) / 3_600_000;
    if (hoursLeft > 0) return { success: false, hoursLeft };
  }
  const tokens = u.tokens + 1;
  updateUser(id, { tokens, lastDaily: new Date().toISOString() });
  return { success: true, newBalance: tokens };
}

function getInventory(id) { return getUser(id).inventory || []; }

function saveToSlot(id, slot, colorName, colorHex, rarity) {
  const u = getUser(id);
  const inv = u.inventory || [];
  const idx = inv.findIndex((s) => s.slot === slot);
  const entry = { slot, color_name: colorName, color_hex: colorHex, rarity, saved_at: new Date().toISOString() };
  if (idx >= 0) inv[idx] = entry; else inv.push(entry);
  inv.sort((a, b) => a.slot - b.slot);
  updateUser(id, { inventory: inv });
}

function getMaxSlots(id) { return getUser(id).slots || 1; }

function slotCost(currentSlots) { return currentSlots * 5; }

function upgradeSlot(id) {
  const u = getUser(id);
  const cur = u.slots || 1;
  if (cur >= 99) return { success: false, reason: "You already have the maximum 99 slots!" };
  const cost = slotCost(cur);
  if (u.tokens < cost) return { success: false, reason: `Not enough Bidoof Tokens! You need ${cost} but have ${u.tokens}.` };
  updateUser(id, { tokens: u.tokens - cost, slots: cur + 1 });
  return { success: true, newSlots: cur + 1, cost };
}

// ─── COLORS ───────────────────────────────────────────────────────────────────

const RARITY = {
  common:    { emoji: "⚪", weight: 50,   label: "Common",    color: 0xaaaaaa },
  uncommon:  { emoji: "🟢", weight: 25,   label: "Uncommon",  color: 0x57f287 },
  rare:      { emoji: "🔵", weight: 14,   label: "Rare",      color: 0x3498db },
  epic:      { emoji: "🟣", weight: 8,    label: "Epic",      color: 0x9b59b6 },
  legendary: { emoji: "🟡", weight: 2.5,  label: "Legendary", color: 0xf1c40f },
  "???":     { emoji: "🌈", weight: 0.5,  label: "???",       color: 0xff6ec7 },
};

const COLORS = [
  // COMMON
  { name: "Discord Background", hex: "#313338", rarity: "common" },
  { name: "Discord Sidebar",    hex: "#2b2d31", rarity: "common" },
  { name: "Discord Input",      hex: "#383a40", rarity: "common" },
  { name: "Charcoal",           hex: "#36393f", rarity: "common" },
  { name: "Invisible Black",    hex: "#000001", rarity: "common" },
  { name: "Ash Gray",           hex: "#b2b2b2", rarity: "common" },
  { name: "Silver",             hex: "#c0c0c0", rarity: "common" },
  { name: "Light Gray",         hex: "#d3d3d3", rarity: "common" },
  { name: "White",              hex: "#ffffff", rarity: "common" },
  { name: "Ivory",              hex: "#fffff0", rarity: "common" },
  { name: "Cream",              hex: "#fffdd0", rarity: "common" },
  { name: "Snow",               hex: "#fffafa", rarity: "common" },
  { name: "Beige",              hex: "#f5f5dc", rarity: "common" },
  { name: "Stone",              hex: "#9e9e9e", rarity: "common" },
  { name: "Slate Gray",         hex: "#708090", rarity: "common" },
  { name: "Dim Gray",           hex: "#696969", rarity: "common" },
  { name: "Powder Blue",        hex: "#b0e0e6", rarity: "common" },
  { name: "Lavender Blush",     hex: "#fff0f5", rarity: "common" },
  { name: "Misty Rose",         hex: "#ffe4e1", rarity: "common" },
  { name: "Bisque",             hex: "#ffe4c4", rarity: "common" },
  { name: "Wheat",              hex: "#f5deb3", rarity: "common" },
  { name: "Tan",                hex: "#d2b48c", rarity: "common" },
  { name: "Sandy Brown",        hex: "#f4a460", rarity: "common" },
  { name: "Maroon",             hex: "#800000", rarity: "common" },
  { name: "Brown",              hex: "#a52a2a", rarity: "common" },
  { name: "Chocolate",          hex: "#d2691e", rarity: "common" },
  { name: "Salmon",             hex: "#fa8072", rarity: "common" },
  { name: "Coral",              hex: "#ff7f50", rarity: "common" },
  { name: "Orange Red",         hex: "#ff4500", rarity: "common" },
  { name: "Orange",             hex: "#ffa500", rarity: "common" },
  { name: "Gold",               hex: "#ffd700", rarity: "common" },
  { name: "Yellow",             hex: "#ffff00", rarity: "common" },
  { name: "Khaki",              hex: "#f0e68c", rarity: "common" },
  { name: "Yellow Green",       hex: "#9acd32", rarity: "common" },
  { name: "Olive",              hex: "#808000", rarity: "common" },
  { name: "Lime Green",         hex: "#32cd32", rarity: "common" },
  { name: "Pale Green",         hex: "#98fb98", rarity: "common" },
  { name: "Sea Green",          hex: "#2e8b57", rarity: "common" },
  { name: "Forest Green",       hex: "#228b22", rarity: "common" },
  { name: "Green",              hex: "#008000", rarity: "common" },
  { name: "Teal",               hex: "#008080", rarity: "common" },
  { name: "Cyan",               hex: "#00ffff", rarity: "common" },
  { name: "Sky Blue",           hex: "#87ceeb", rarity: "common" },
  { name: "Dodger Blue",        hex: "#1e90ff", rarity: "common" },
  { name: "Blue",               hex: "#0000ff", rarity: "common" },
  { name: "Navy",               hex: "#000080", rarity: "common" },
  { name: "Lavender",           hex: "#e6e6fa", rarity: "common" },
  { name: "Violet",             hex: "#ee82ee", rarity: "common" },
  { name: "Fuchsia",            hex: "#ff00ff", rarity: "common" },
  { name: "Purple",             hex: "#800080", rarity: "common" },
  { name: "Indigo",             hex: "#4b0082", rarity: "common" },
  { name: "Hot Pink",           hex: "#ff69b4", rarity: "common" },
  { name: "Pink",               hex: "#ffc0cb", rarity: "common" },
  { name: "Crimson",            hex: "#dc143c", rarity: "common" },
  { name: "Red",                hex: "#ff0000", rarity: "common" },
  // UNCOMMON
  { name: "Neon Green",         hex: "#39ff14", rarity: "uncommon" },
  { name: "Electric Blue",      hex: "#7df9ff", rarity: "uncommon" },
  { name: "Hot Coral",          hex: "#ff6b6b", rarity: "uncommon" },
  { name: "Pastel Purple",      hex: "#b39ddb", rarity: "uncommon" },
  { name: "Soft Mint",          hex: "#aaf0d1", rarity: "uncommon" },
  { name: "Butter Yellow",      hex: "#fffd82", rarity: "uncommon" },
  { name: "Dusty Rose",         hex: "#dcae96", rarity: "uncommon" },
  { name: "Tiffany Blue",       hex: "#81d8d0", rarity: "uncommon" },
  { name: "Periwinkle",         hex: "#ccccff", rarity: "uncommon" },
  { name: "Mauve",              hex: "#e0b0ff", rarity: "uncommon" },
  { name: "Champagne",          hex: "#f7e7ce", rarity: "uncommon" },
  { name: "Slate Blue",         hex: "#6a5acd", rarity: "uncommon" },
  { name: "Turquoise",          hex: "#40e0d0", rarity: "uncommon" },
  { name: "Spring Green",       hex: "#00ff7f", rarity: "uncommon" },
  { name: "Medium Purple",      hex: "#9370db", rarity: "uncommon" },
  { name: "Sage",               hex: "#b2ac88", rarity: "uncommon" },
  { name: "Rust",               hex: "#b7410e", rarity: "uncommon" },
  { name: "Terra Cotta",        hex: "#e2725b", rarity: "uncommon" },
  { name: "Burnt Orange",       hex: "#cc5500", rarity: "uncommon" },
  { name: "Amber",              hex: "#ffbf00", rarity: "uncommon" },
  { name: "Goldenrod",          hex: "#daa520", rarity: "uncommon" },
  { name: "Jade",               hex: "#00a86b", rarity: "uncommon" },
  { name: "Emerald",            hex: "#50c878", rarity: "uncommon" },
  { name: "Royal Blue",         hex: "#4169e1", rarity: "uncommon" },
  { name: "Sapphire",           hex: "#0f52ba", rarity: "uncommon" },
  { name: "Rose",               hex: "#ff007f", rarity: "uncommon" },
  { name: "Raspberry",          hex: "#e30b5d", rarity: "uncommon" },
  { name: "Eggplant",           hex: "#614051", rarity: "uncommon" },
  { name: "Burgundy",           hex: "#800020", rarity: "uncommon" },
  { name: "Peach",              hex: "#ffcba4", rarity: "uncommon" },
  { name: "Tangerine",          hex: "#f28500", rarity: "uncommon" },
  { name: "Lemon",              hex: "#fff44f", rarity: "uncommon" },
  { name: "Avocado",            hex: "#568203", rarity: "uncommon" },
  { name: "Seafoam",            hex: "#71eeb8", rarity: "uncommon" },
  { name: "Baby Blue",          hex: "#89cff0", rarity: "uncommon" },
  { name: "Denim",              hex: "#1560bd", rarity: "uncommon" },
  { name: "Wisteria",           hex: "#c9a0dc", rarity: "uncommon" },
  { name: "Lilac",              hex: "#c8a2c8", rarity: "uncommon" },
  { name: "Heliotrope",         hex: "#df73ff", rarity: "uncommon" },
  // RARE
  { name: "Lapis Lazuli",       hex: "#26619c", rarity: "rare" },
  { name: "Byzantine",          hex: "#bd33a4", rarity: "rare" },
  { name: "Neon Purple",        hex: "#bc13fe", rarity: "rare" },
  { name: "Neon Pink",          hex: "#ff6ec7", rarity: "rare" },
  { name: "Neon Yellow",        hex: "#dfff00", rarity: "rare" },
  { name: "Neon Orange",        hex: "#ff6700", rarity: "rare" },
  { name: "Neon Red",           hex: "#ff3131", rarity: "rare" },
  { name: "Electric Violet",    hex: "#8f00ff", rarity: "rare" },
  { name: "Electric Crimson",   hex: "#ff003f", rarity: "rare" },
  { name: "Cerulean",           hex: "#007ba7", rarity: "rare" },
  { name: "Ultramarine",        hex: "#3f00ff", rarity: "rare" },
  { name: "Prussian Blue",      hex: "#003153", rarity: "rare" },
  { name: "Carmine",            hex: "#960018", rarity: "rare" },
  { name: "Malachite",          hex: "#0bda51", rarity: "rare" },
  { name: "Viridian",           hex: "#40826d", rarity: "rare" },
  { name: "Saffron",            hex: "#f4c430", rarity: "rare" },
  { name: "Jet Black",          hex: "#0a0a0a", rarity: "rare" },
  { name: "Obsidian",           hex: "#1b1b1b", rarity: "rare" },
  { name: "Platinum",           hex: "#e5e4e2", rarity: "rare" },
  { name: "Moonstone",          hex: "#3aa8c1", rarity: "rare" },
  { name: "Discord Blurple",    hex: "#5865f2", rarity: "rare" },
  { name: "Discord Green",      hex: "#57f287", rarity: "rare" },
  { name: "Discord Yellow",     hex: "#fee75c", rarity: "rare" },
  { name: "Discord Fuchsia",    hex: "#eb459e", rarity: "rare" },
  { name: "Discord Red",        hex: "#ed4245", rarity: "rare" },
  // EPIC
  { name: "Aurora Borealis",    hex: "#54dfc0", rarity: "epic" },
  { name: "Twilight",           hex: "#4f3a6e", rarity: "epic" },
  { name: "Nebula Pink",        hex: "#e040fb", rarity: "epic" },
  { name: "Cosmic Purple",      hex: "#7b2d8b", rarity: "epic" },
  { name: "Stardust",           hex: "#d4a0ff", rarity: "epic" },
  { name: "Galaxy Blue",        hex: "#13274f", rarity: "epic" },
  { name: "Solar Flare",        hex: "#ff6b00", rarity: "epic" },
  { name: "Void Black",         hex: "#020209", rarity: "epic" },
  { name: "Blood Moon",         hex: "#a80000", rarity: "epic" },
  { name: "Dark Matter",        hex: "#111111", rarity: "epic" },
  { name: "Glitch Pink",        hex: "#ff2079", rarity: "epic" },
  { name: "Plasma Blue",        hex: "#00b4d8", rarity: "epic" },
  { name: "Quantum Teal",       hex: "#009688", rarity: "epic" },
  { name: "Holographic",        hex: "#c0f0ff", rarity: "epic" },
  { name: "Cyberpunk Yellow",   hex: "#f0ff00", rarity: "epic" },
  { name: "Matrix Green",       hex: "#00ff41", rarity: "epic" },
  { name: "Synthwave Red",      hex: "#ff0a54", rarity: "epic" },
  { name: "Synthwave Purple",   hex: "#9d00ff", rarity: "epic" },
  { name: "Vaporwave Pink",     hex: "#ff71ce", rarity: "epic" },
  { name: "Vaporwave Blue",     hex: "#01cdfe", rarity: "epic" },
  { name: "Vaporwave Purple",   hex: "#b967ff", rarity: "epic" },
  { name: "Retrowave Orange",   hex: "#ff6d00", rarity: "epic" },
  // LEGENDARY
  { name: "Bidoof Gold",        hex: "#f5c842", rarity: "legendary" },
  { name: "Shiny Gold",         hex: "#ffd700", rarity: "legendary" },
  { name: "Ancient Gold",       hex: "#cfb53b", rarity: "legendary" },
  { name: "Midas Touch",        hex: "#e8c325", rarity: "legendary" },
  { name: "Phoenix Fire",       hex: "#ff4500", rarity: "legendary" },
  { name: "Celestial Blue",     hex: "#4169e1", rarity: "legendary" },
  { name: "Divine White",       hex: "#fffef0", rarity: "legendary" },
  { name: "Arcane Purple",      hex: "#800080", rarity: "legendary" },
  { name: "Mythril Silver",     hex: "#aac8d4", rarity: "legendary" },
  { name: "Sacred Crimson",     hex: "#c41e3a", rarity: "legendary" },
  { name: "Eternal Night",      hex: "#000033", rarity: "legendary" },
  { name: "Primordial Void",    hex: "#000000", rarity: "legendary" },
  { name: "Lich Purple",        hex: "#4b0082", rarity: "legendary" },
  { name: "Vampire Crimson",    hex: "#8b0000", rarity: "legendary" },
  { name: "Ruby",               hex: "#9b111e", rarity: "legendary" },
  { name: "Sapphire Blue",      hex: "#0f52ba", rarity: "legendary" },
  { name: "Emerald Green",      hex: "#50c878", rarity: "legendary" },
  { name: "Amethyst",           hex: "#9966cc", rarity: "legendary" },
  { name: "Diamond",            hex: "#b9f2ff", rarity: "legendary" },
  // ???
  { name: "Bidoof's Blessing",  hex: "#f7dc6f", rarity: "???" },
  { name: "Ditto Purple",       hex: "#b57adf", rarity: "???" },
  { name: "Missingno",          hex: "#ff00ff", rarity: "???" },
  { name: "Shiny Bidoof",       hex: "#dcc48a", rarity: "???" },
  { name: "True Invisible",     hex: "#2b2d31", rarity: "???" },
  { name: "Void",               hex: "#000000", rarity: "???" },
  { name: "Glitched",           hex: "#00ff00", rarity: "???" },
  { name: "404 Blue",           hex: "#0000ff", rarity: "???" },
  { name: "Time Paradox",       hex: "#ffffff", rarity: "???" },
  { name: "Null",               hex: "#010101", rarity: "???" },
  { name: "Undefined",          hex: "#fefefe", rarity: "???" },
  { name: "Overflow",           hex: "#ff8800", rarity: "???" },
  { name: "The One Color",      hex: "#5865f2", rarity: "???" },
  { name: "Bidoof's True Form", hex: "#a0522d", rarity: "???" },
];

function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}

function rollRarity(guaranteed) {
  if (guaranteed === "epic")      return weightedRandom(["epic","legendary","???"], [70, 25, 5]);
  if (guaranteed === "legendary") return weightedRandom(["legendary","???"], [90, 10]);
  const keys = Object.keys(RARITY);
  return weightedRandom(keys, keys.map((k) => RARITY[k].weight));
}

function randomColorByRarity(rarity) {
  const pool = COLORS.filter((c) => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)];
}

function hexToInt(hex) { return parseInt(hex.replace("#", ""), 16); }

// ─── COMMANDS ─────────────────────────────────────────────────────────────────

async function getOrCreateRole(guild, name, hex) {
  return guild.roles.cache.find((r) => r.name === name)
    ?? await guild.roles.create({ name, color: hexToInt(hex), reason: "BidoofColor" });
}

function roleToColor(name) {
  for (const [rarity, cfg] of Object.entries(RARITY)) {
    if (name.startsWith(cfg.emoji)) return { colorName: name.slice(cfg.emoji.length + 1), rarity };
  }
  return null;
}

async function removeOldColorRoles(member) {
  const old = member.roles.cache.filter((r) =>
    Object.values(RARITY).some((c) => r.name.startsWith(c.emoji)));
  if (old.size) await member.roles.remove(old);
}

const commands = [
  // /random
  {
    data: new SlashCommandBuilder()
      .setName("random")
      .setDescription("Roll a random colour! Costs 1 Bidoof Token.")
      .addStringOption((o) => o.setName("mode").setDescription("Roll mode").setRequired(false)
        .addChoices(
          { name: "Standard (1 token)", value: "standard" },
          { name: "Guaranteed Epic (25 tokens)", value: "epic" },
          { name: "Guaranteed Legendary (50 tokens)", value: "legendary" },
        )),
    async execute(i) {
      await i.deferReply();
      const mode = i.options.getString("mode") ?? "standard";
      const cost = mode === "epic" ? 25 : mode === "legendary" ? 50 : 1;
      if (!spendTokens(i.user.id, cost)) {
        return i.editReply(`❌ Need **${cost}** tokens but you have **${getUser(i.user.id).tokens}**. Use \`/daily\` for free tokens.`);
      }
      const rarity = rollRarity(mode !== "standard" ? mode : undefined);
      const color  = randomColorByRarity(rarity);
      const cfg    = RARITY[rarity];
      const embed  = new EmbedBuilder()
        .setTitle(`${cfg.emoji} You got a colour!`)
        .setDescription(`**${color.name}**\n\`${color.hex}\`\n\nRarity: ${cfg.emoji} **${cfg.label}**`)
        .setColor(hexToInt(color.hex))
        .setFooter({ text: `Cost: ${cost} token${cost !== 1 ? "s" : ""} • /inventory to manage` })
        .setTimestamp();
      if (i.guild) {
        try {
          const role   = await getOrCreateRole(i.guild, `${cfg.emoji} ${color.name}`, color.hex);
          const member = await i.guild.members.fetch(i.user.id);
          await removeOldColorRoles(member);
          await member.roles.add(role);
          embed.addFields({ name: "Role", value: `<@&${role.id}>`, inline: true });
        } catch { embed.addFields({ name: "⚠️ Role", value: "Missing permissions", inline: true }); }
      }
      embed.addFields({ name: "Balance", value: `${getUser(i.user.id).tokens} 🪙`, inline: true });
      await i.editReply({ embeds: [embed] });
    },
  },

  // /inventory
  {
    data: new SlashCommandBuilder()
      .setName("inventory")
      .setDescription("View your saved colour slots and Bidoof Token balance.")
      .addUserOption((o) => o.setName("user").setDescription("[Admin] Check another user").setRequired(false)),
    async execute(i) {
      await i.deferReply();
      const targetUser = i.options.getUser("user");
      if (targetUser && !i.memberPermissions?.has(PermissionFlagsBits.Administrator))
        return i.editReply("❌ Only admins can view other users' inventories.");
      const subject = targetUser ?? i.user;
      const u   = getUser(subject.id);
      const inv = getInventory(subject.id);
      const embed = new EmbedBuilder()
        .setTitle(`🎨 ${subject.username}'s Inventory`)
        .setColor(0x5865f2).setThumbnail(subject.displayAvatarURL()).setTimestamp()
        .addFields(
          { name: "💰 Bidoof Tokens", value: `**${u.tokens}** 🪙`, inline: true },
          { name: "📦 Slots",         value: `**${inv.length}** / **${u.slots}** used`, inline: true },
        );
      if (u.lastDaily) {
        const hl = Math.max(0, 12 - (Date.now() - new Date(u.lastDaily).getTime()) / 3_600_000);
        const h = Math.floor(hl), m = Math.floor((hl - h) * 60);
        embed.addFields({ name: "⏰ Next Daily", value: hl > 0 ? `${h}h ${m}m` : "Ready! `/daily`", inline: true });
      } else {
        embed.addFields({ name: "⏰ Daily Token", value: "Ready! Use `/daily`", inline: true });
      }
      if (inv.length === 0) {
        embed.setDescription("No colours saved! Use `/random` then `/save <slot>`.");
      } else {
        for (const s of inv) {
          const cfg = RARITY[s.rarity] ?? { emoji: "❓", label: s.rarity };
          embed.addFields({ name: `Slot ${s.slot}: ${cfg.emoji} ${s.color_name}`, value: `\`${s.color_hex}\` — ${cfg.label}`, inline: true });
        }
      }
      await i.editReply({ embeds: [embed] });
    },
  },

  // /save
  {
    data: new SlashCommandBuilder()
      .setName("save")
      .setDescription("Save your current colour role to an inventory slot.")
      .addIntegerOption((o) => o.setName("slot").setDescription("Slot number (1–99)").setRequired(true).setMinValue(1).setMaxValue(99)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const slot = i.options.getInteger("slot", true);
      const max  = getMaxSlots(i.user.id);
      if (slot > max) return i.editReply(`❌ You only have **${max}** slot(s). Use \`/buy slot\` to unlock more.`);
      const member = await i.guild.members.fetch(i.user.id);
      const colourRole = member.roles.cache.find((r) => roleToColor(r.name) !== null);
      if (!colourRole) return i.editReply("❌ No colour role equipped! Use `/random` first.");
      const info = roleToColor(colourRole.name);
      const hex  = "#" + colourRole.color.toString(16).padStart(6, "0");
      saveToSlot(i.user.id, slot, info.colorName, hex, info.rarity);
      const cfg = RARITY[info.rarity];
      await i.editReply({ embeds: [
        new EmbedBuilder().setTitle("✅ Colour Saved!")
          .setDescription(`**${info.colorName}** → **Slot ${slot}**\n\`${hex}\` — ${cfg.emoji} ${cfg.label}`)
          .setColor(hexToInt(hex)).setTimestamp()
      ]});
    },
  },

  // /equip
  {
    data: new SlashCommandBuilder()
      .setName("equip")
      .setDescription("Equip a saved colour from your inventory.")
      .addIntegerOption((o) => o.setName("slot").setDescription("Slot to equip (1–99)").setRequired(true).setMinValue(1).setMaxValue(99)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const slot  = i.options.getInteger("slot", true);
      const inv   = getInventory(i.user.id);
      const entry = inv.find((s) => s.slot === slot);
      if (!entry) {
        const used = inv.map((s) => s.slot).join(", ") || "none";
        return i.editReply(`❌ Slot **${slot}** is empty!\nSaved slots: **${used}**`);
      }
      const cfg = RARITY[entry.rarity] ?? { emoji: "❓", label: entry.rarity };
      try {
        const role   = await getOrCreateRole(i.guild, `${cfg.emoji} ${entry.color_name}`, entry.color_hex);
        const member = await i.guild.members.fetch(i.user.id);
        await removeOldColorRoles(member);
        await member.roles.add(role);
        await i.editReply({ embeds: [
          new EmbedBuilder().setTitle("✅ Colour Equipped!")
            .setDescription(`Slot ${slot}: ${cfg.emoji} **${entry.color_name}**\n\`${entry.color_hex}\` — ${cfg.label}`)
            .setColor(hexToInt(entry.color_hex)).setTimestamp()
        ]});
      } catch { await i.editReply("❌ Could not assign role — check bot permissions and role order."); }
    },
  },

  // /daily
  {
    data: new SlashCommandBuilder().setName("daily").setDescription("Claim your free Bidoof Token every 12 hours."),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const result = claimDaily(i.user.id);
      if (!result.success) {
        const h = Math.floor(result.hoursLeft), m = Math.floor((result.hoursLeft - h) * 60);
        return i.editReply(`⏰ Already claimed! Come back in **${h}h ${m}m**.`);
      }
      await i.editReply({ embeds: [
        new EmbedBuilder().setTitle("🪙 Daily Token Claimed!")
          .setDescription(`+1 Bidoof Token! New balance: **${result.newBalance}** 🪙`)
          .setColor(0xf5c842).setFooter({ text: "Come back in 12 hours!" }).setTimestamp()
      ]});
    },
  },

  // /give
  {
    data: new SlashCommandBuilder()
      .setName("give").setDescription("[Admin] Give Bidoof Tokens to a user.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("Tokens to give").setRequired(true).setMinValue(1).setMaxValue(9999)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const target = i.options.getUser("user", true);
      const amount = i.options.getInteger("amount", true);
      const bal    = addTokens(target.id, amount);
      await i.editReply({ embeds: [
        new EmbedBuilder().setTitle("🪙 Tokens Given!")
          .setDescription(`Gave **${amount}** token${amount !== 1 ? "s" : ""} to <@${target.id}>.\nNew balance: **${bal}** 🪙`)
          .setColor(0xf5c842).setTimestamp()
      ]});
    },
  },

  // /store
  {
    data: new SlashCommandBuilder().setName("store").setDescription("View the Bidoof Token store."),
    async execute(i) {
      await i.deferReply();
      const u = getUser(i.user.id);
      const nextCost = u.slots < 99 ? slotCost(u.slots) : null;
      await i.editReply({ embeds: [
        new EmbedBuilder().setTitle("🛒 Bidoof Token Store").setColor(0xf5c842)
          .setDescription(`Balance: **${u.tokens}** 🪙 | Slots: **${u.slots}** / 99`)
          .addFields(
            { name: "🎲 Standard Roll — 1 token",               value: "`/random` — any rarity", inline: false },
            { name: "🟣 Guaranteed Epic Roll — 25 tokens",      value: "`/random mode:Guaranteed Epic`", inline: false },
            { name: "🟡 Guaranteed Legendary Roll — 50 tokens", value: "`/random mode:Guaranteed Legendary`", inline: false },
            { name: "📦 Extra Slot", value: nextCost ? `Next slot: **${nextCost} tokens** → \`/buy slot\`` : "Max slots reached!", inline: false },
            { name: "📊 Slot Prices", value: "Slot 2: 5 | Slot 3: 10 | Slot 4: 15 | +5 each", inline: false },
          )
          .setFooter({ text: "Free token every 12h with /daily" }).setTimestamp()
      ]});
    },
  },

  // /buy
  {
    data: new SlashCommandBuilder()
      .setName("buy").setDescription("Purchase items from the store.")
      .addStringOption((o) => o.setName("item").setDescription("Item to buy").setRequired(true)
        .addChoices({ name: "Extra Inventory Slot", value: "slot" })),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const result = upgradeSlot(i.user.id);
      if (!result.success) return i.editReply(`❌ ${result.reason}`);
      const tokens = getUser(i.user.id).tokens;
      await i.editReply({ embeds: [
        new EmbedBuilder().setTitle("📦 Slot Unlocked!")
          .setDescription(`You now have **${result.newSlots}** slots!\nCost: **${result.cost}** 🪙 | Remaining: **${tokens}** 🪙`)
          .setColor(0x57f287)
          .setFooter({ text: result.newSlots < 99 ? `Next slot: ${slotCost(result.newSlots)} tokens` : "Max slots!" })
          .setTimestamp()
      ]});
    },
  },

  // /help
  {
    data: new SlashCommandBuilder().setName("help").setDescription("Show all BidoofColor bot commands."),
    async execute(i) {
      await i.reply({ ephemeral: true, embeds: [
        new EmbedBuilder().setTitle("🎨 BidoofColor Bot — Help").setColor(0x5865f2)
          .setDescription("Roll random colour roles! Start with 3 Bidoof Tokens 🪙, earn 1 free every 12h.")
          .addFields(
            { name: "🎲 Rolling",   value: "`/random` — 1 token\n`/random mode:Guaranteed Epic` — 25 tokens\n`/random mode:Guaranteed Legendary` — 50 tokens", inline: false },
            { name: "⭐ Rarities",  value: "⚪ Common 50% | 🟢 Uncommon 25% | 🔵 Rare 14%\n🟣 Epic 8% | 🟡 Legendary 2.5% | 🌈 ??? 0.5%", inline: false },
            { name: "📦 Inventory", value: "`/inventory` — view slots & tokens\n`/save <slot>` — save current colour\n`/equip <slot>` — equip saved colour", inline: false },
            { name: "🪙 Tokens",    value: "`/daily` — free token every 12h\n`/store` — view shop\n`/buy slot` — unlock extra slot (5→10→15→+5)", inline: false },
            { name: "🔑 Admin",     value: "`/give <user> <amount>` — give tokens\n`/inventory user:<user>` — view any inventory", inline: false },
          )
          .setFooter({ text: "BidoofColor Bot • collect rare colours!" }).setTimestamp()
      ]});
    },
  },
];

// ─── BOT SETUP ────────────────────────────────────────────────────────────────

const commandMap = new Collection();
for (const cmd of commands) commandMap.set(cmd.data.name, cmd);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  await new REST().setToken(TOKEN).put(Routes.applicationCommands(CLIENT_ID), {
    body: commands.map((c) => c.data.toJSON()),
  });
  console.log("Slash commands registered.");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(err);
    const msg = { content: "❌ Something went wrong.", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

client.login(TOKEN);
