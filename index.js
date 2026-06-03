// ═══════════════════════════════════════════════════════════════════════════
//  BidoofColor Bot v2  ·  Single-file edition
//  Start:  node index.js
//  Env:    DISCORD_TOKEN  DISCORD_CLIENT_ID
//
//  IMPORTANT — enable both in the Discord Developer Portal before running:
//    Bot → Privileged Gateway Intents → Server Members Intent  ✓
//    Bot → Privileged Gateway Intents → Message Content Intent ✓
//
//  Files created automatically at runtime:
//    users.json   — token balances, inventory, badges
//    config.json  — gym leaders, battle channels, badge images
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  Client, GatewayIntentBits, Collection, Events,
  REST, Routes, SlashCommandBuilder, EmbedBuilder,
  PermissionFlagsBits, ChannelType,
} from "discord.js";

// ─────────────────────────────────────────────────────────────
//  ENV
// ─────────────────────────────────────────────────────────────
const TOKEN      = process.env.DISCORD_TOKEN;
const CLIENT_ID  = process.env.DISCORD_CLIENT_ID;
const POKETWO_ID = "716390085896962058";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌  Missing DISCORD_TOKEN or DISCORD_CLIENT_ID");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
//  JSON STORAGE
// ─────────────────────────────────────────────────────────────
function readJSON(path, fallback) {
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(fallback, null, 2), "utf8");
    return structuredClone(fallback);
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed ?? structuredClone(fallback);
  } catch {
    console.warn(`⚠️  ${path} was corrupted – resetting.`);
    writeFileSync(path, JSON.stringify(fallback, null, 2), "utf8");
    return structuredClone(fallback);
  }
}
function writeJSON(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

// ── users.json ── { [discordId]: { tokens, lastDaily, inventory, slots, badges } }
const USERS_DEFAULT = {};
function loadUsers() { return readJSON("./users.json", USERS_DEFAULT); }
function saveUsers(d) { writeJSON("./users.json", d); }

// ── config.json ─────────────────────────────────────────────
const CONFIG_DEFAULT = {
  gymLeaders:     {},   // { [gymType]: discordUserId }
  gymBadges:      {},   // { [gymType]: { name, imageUrl } }
  battleChannels: [],   // channel IDs where gym battles are tracked
  resultsChannel: null, // channel ID where results are posted
  battleHistory:  [],   // last 500 battles
};
function loadConfig() { return readJSON("./config.json", CONFIG_DEFAULT); }
function saveConfig(d) { writeJSON("./config.json", d); }

// ─────────────────────────────────────────────────────────────
//  USER HELPERS
// ─────────────────────────────────────────────────────────────
function makeDefaultUser() {
  return { tokens: 3, lastDaily: null, inventory: [], slots: 1, badges: [] };
}
function getUser(id) {
  const users = loadUsers();
  if (!users[id]) users[id] = makeDefaultUser();
  // back-fill missing fields for old records
  if (!Array.isArray(users[id].badges))    users[id].badges    = [];
  if (!Array.isArray(users[id].inventory)) users[id].inventory = [];
  if (!users[id].slots)                    users[id].slots      = 1;
  saveUsers(users);
  return users[id];
}
function updateUser(id, patch) {
  const users   = loadUsers();
  users[id]     = { ...getUser(id), ...patch };
  saveUsers(users);
  return users[id];
}
function spendTokens(id, n) {
  const u = getUser(id);
  if (u.tokens < n) return false;
  updateUser(id, { tokens: u.tokens - n });
  return true;
}
function addTokens(id, n) {
  const u = getUser(id);
  const t = u.tokens + n;
  updateUser(id, { tokens: t });
  return t;
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
function getInventory(id)  { return getUser(id).inventory || []; }
function getMaxSlots(id)   { return getUser(id).slots || 1; }
function slotCost(n)       { return n * 5; }

function saveToSlot(id, slot, colorName, colorHex, rarity) {
  const u   = getUser(id);
  const inv = [...(u.inventory || [])];
  const idx = inv.findIndex((s) => s.slot === slot);
  const entry = { slot, color_name: colorName, color_hex: colorHex, rarity, saved_at: new Date().toISOString() };
  if (idx >= 0) inv[idx] = entry; else inv.push(entry);
  inv.sort((a, b) => a.slot - b.slot);
  updateUser(id, { inventory: inv });
}
function upgradeSlot(id) {
  const u   = getUser(id);
  const cur = u.slots || 1;
  if (cur >= 99) return { success: false, reason: "You already have the maximum 99 slots!" };
  const cost = slotCost(cur);
  if (u.tokens < cost) return { success: false, reason: `Need **${cost}** tokens but you only have **${u.tokens}**.` };
  updateUser(id, { tokens: u.tokens - cost, slots: cur + 1 });
  return { success: true, newSlots: cur + 1, cost };
}

// ─────────────────────────────────────────────────────────────
//  RARITY + COLOR POOL
// ─────────────────────────────────────────────────────────────
const RARITY = {
  common:    { emoji: "⚪", weight: 60,  label: "Common",    color: 0x808080 },
  uncommon:  { emoji: "🟢", weight: 25,  label: "Uncommon",  color: 0x57f287 },
  rare:      { emoji: "🔵", weight: 10,  label: "Rare",      color: 0x3498db },
  epic:      { emoji: "🟣", weight: 4,   label: "Epic",      color: 0x9b59b6 },
  legendary: { emoji: "🟡", weight: 0.8, label: "Legendary", color: 0xf1c40f },
  "???":     { emoji: "🌈", weight: 0.2, label: "???",       color: 0xffd700 },
};

const COLORS = [
  // ── COMMON (60%) ─ dull, grayish, muddy, unappealing ──────
  { name: "Ash",             hex: "#808080", rarity: "common" },
  { name: "Dim Gray",        hex: "#696969", rarity: "common" },
  { name: "Dark Concrete",   hex: "#5A5A5A", rarity: "common" },
  { name: "Stone",           hex: "#4A4A4A", rarity: "common" },
  { name: "Smudge",          hex: "#6A6060", rarity: "common" },
  { name: "Gravel",          hex: "#9A9898", rarity: "common" },
  { name: "Pewter",          hex: "#8A9090", rarity: "common" },
  { name: "Pale Silver",     hex: "#C0C0C0", rarity: "common" },
  { name: "Gainsboro",       hex: "#DCDCDC", rarity: "common" },
  { name: "Dingy White",     hex: "#E0DDD5", rarity: "common" },
  { name: "Milky",           hex: "#F0EDE0", rarity: "common" },
  { name: "Pale Bone",       hex: "#DDD8C8", rarity: "common" },
  { name: "Old Parchment",   hex: "#D4C9B0", rarity: "common" },
  { name: "Faded Cream",     hex: "#E8E0C8", rarity: "common" },
  { name: "Muddy Brown",     hex: "#7A6550", rarity: "common" },
  { name: "Drab",            hex: "#9C8B75", rarity: "common" },
  { name: "Worn Sand",       hex: "#C4A882", rarity: "common" },
  { name: "Faded Tan",       hex: "#C8B89A", rarity: "common" },
  { name: "Dirty Linen",     hex: "#C8C0AA", rarity: "common" },
  { name: "Bark",            hex: "#705040", rarity: "common" },
  { name: "Old Wood",        hex: "#806050", rarity: "common" },
  { name: "Sludge",          hex: "#8B8878", rarity: "common" },
  { name: "Dust",            hex: "#928C7E", rarity: "common" },
  { name: "Khaki Mud",       hex: "#B8A88A", rarity: "common" },
  { name: "Swamp Green",     hex: "#6B7050", rarity: "common" },
  { name: "Army Drab",       hex: "#888850", rarity: "common" },
  { name: "Murky Olive",     hex: "#7A7A00", rarity: "common" },
  { name: "Dull Sage",       hex: "#9A9A70", rarity: "common" },
  { name: "Foggy Green",     hex: "#90A088", rarity: "common" },
  { name: "Stale Blue",      hex: "#7F8C9A", rarity: "common" },
  { name: "Slate Mist",      hex: "#8898A4", rarity: "common" },
  { name: "Faded Denim",     hex: "#8090A8", rarity: "common" },
  { name: "Washed Purple",   hex: "#B8A0B8", rarity: "common" },
  { name: "Pale Mauve",      hex: "#C4B8C4", rarity: "common" },
  { name: "Dusty Pink",      hex: "#C4A0A0", rarity: "common" },
  { name: "Muted Rose",      hex: "#B89090", rarity: "common" },
  { name: "Yellowed Paper",  hex: "#D4CC98", rarity: "common" },
  { name: "Charcoal Faint",  hex: "#505050", rarity: "common" },

  // ── UNCOMMON (25%) ─ muted, soft, slightly better ──────────
  { name: "Baby Blue",       hex: "#ADD8E6", rarity: "uncommon" },
  { name: "Light Pink",      hex: "#FFB6C1", rarity: "uncommon" },
  { name: "Pale Mint",       hex: "#98FB98", rarity: "uncommon" },
  { name: "Peach",           hex: "#FFDAB9", rarity: "uncommon" },
  { name: "Lavender",        hex: "#E6E6FA", rarity: "uncommon" },
  { name: "Sky Blue",        hex: "#87CEEB", rarity: "uncommon" },
  { name: "Steel Blue Mist", hex: "#B0C4DE", rarity: "uncommon" },
  { name: "Thistle",         hex: "#D8BFD8", rarity: "uncommon" },
  { name: "Plum Mist",       hex: "#DDA0DD", rarity: "uncommon" },
  { name: "Sandy",           hex: "#D2B48C", rarity: "uncommon" },
  { name: "Rosy Brown",      hex: "#BC8F8F", rarity: "uncommon" },
  { name: "Indian Red",      hex: "#CD5C5C", rarity: "uncommon" },
  { name: "Light Coral",     hex: "#F08080", rarity: "uncommon" },
  { name: "Dark Salmon",     hex: "#E9967A", rarity: "uncommon" },
  { name: "Wheat",           hex: "#F5DEB3", rarity: "uncommon" },
  { name: "Pale Yellow",     hex: "#FFFFE0", rarity: "uncommon" },
  { name: "Aqua Mist",       hex: "#AFEEEE", rarity: "uncommon" },
  { name: "Powder Blue",     hex: "#B0E0E6", rarity: "uncommon" },
  { name: "Sage",            hex: "#B2AC88", rarity: "uncommon" },
  { name: "Moss",            hex: "#8A9A5B", rarity: "uncommon" },
  { name: "Seafoam",         hex: "#71C8A0", rarity: "uncommon" },
  { name: "Soft Teal",       hex: "#80B8B0", rarity: "uncommon" },
  { name: "Muted Violet",    hex: "#9B89B4", rarity: "uncommon" },
  { name: "Soft Purple",     hex: "#B09DC8", rarity: "uncommon" },
  { name: "Dusty Blue",      hex: "#7090B0", rarity: "uncommon" },
  { name: "Dusty Rose",      hex: "#DCAE96", rarity: "uncommon" },
  { name: "Blush",           hex: "#E8B4B8", rarity: "uncommon" },
  { name: "Burlywood",       hex: "#DEB887", rarity: "uncommon" },

  // ── RARE (10%) ─ normal colors, medium saturation ──────────
  { name: "Teal",            hex: "#008080", rarity: "rare" },
  { name: "Dark Cyan",       hex: "#008B8B", rarity: "rare" },
  { name: "Cadet Blue",      hex: "#5F9EA0", rarity: "rare" },
  { name: "Slate Blue",      hex: "#6A5ACD", rarity: "rare" },
  { name: "Medium Orchid",   hex: "#BA55D3", rarity: "rare" },
  { name: "Tomato",          hex: "#FF6347", rarity: "rare" },
  { name: "Dark Orange",     hex: "#FF8C00", rarity: "rare" },
  { name: "Goldenrod",       hex: "#DAA520", rarity: "rare" },
  { name: "Sea Green",       hex: "#2E8B57", rarity: "rare" },
  { name: "Forest Green",    hex: "#228B22", rarity: "rare" },
  { name: "Sienna",          hex: "#A0522D", rarity: "rare" },
  { name: "Chocolate",       hex: "#D2691E", rarity: "rare" },
  { name: "Medium Purple",   hex: "#9370DB", rarity: "rare" },
  { name: "Rebecca Purple",  hex: "#663399", rarity: "rare" },
  { name: "Deep Sky Blue",   hex: "#00BFFF", rarity: "rare" },
  { name: "Cornflower Blue", hex: "#6495ED", rarity: "rare" },
  { name: "Medium Violet Red", hex: "#C71585", rarity: "rare" },
  { name: "Olive Drab",      hex: "#6B8E23", rarity: "rare" },
  { name: "Steel Blue",      hex: "#4682B4", rarity: "rare" },
  { name: "Peru",            hex: "#CD853F", rarity: "rare" },

  // ── EPIC (4%) ─ attractive, vibrant, desirable ─────────────
  { name: "Hot Pink",        hex: "#FF69B4", rarity: "epic" },
  { name: "Deep Pink",       hex: "#FF1493", rarity: "epic" },
  { name: "Dodger Blue",     hex: "#1E90FF", rarity: "epic" },
  { name: "Royal Blue",      hex: "#4169E1", rarity: "epic" },
  { name: "Orange Red",      hex: "#FF4500", rarity: "epic" },
  { name: "Blue Violet",     hex: "#8A2BE2", rarity: "epic" },
  { name: "Spring Green",    hex: "#00FA9A", rarity: "epic" },
  { name: "Turquoise",       hex: "#40E0D0", rarity: "epic" },
  { name: "Coral",           hex: "#FF7F50", rarity: "epic" },
  { name: "Orchid",          hex: "#DA70D6", rarity: "epic" },
  { name: "Lime Green",      hex: "#32CD32", rarity: "epic" },
  { name: "Gold Orange",     hex: "#FFA500", rarity: "epic" },

  // ── LEGENDARY (0.8%) ─ iconic, pure, vibrant ───────────────
  { name: "Pure Red",        hex: "#FF0000", rarity: "legendary" },
  { name: "Pure Blue",       hex: "#0000FF", rarity: "legendary" },
  { name: "Pure Green",      hex: "#00FF00", rarity: "legendary" },
  { name: "Pure Yellow",     hex: "#FFFF00", rarity: "legendary" },
  { name: "Magenta",         hex: "#FF00FF", rarity: "legendary" },
  { name: "Cyan",            hex: "#00FFFF", rarity: "legendary" },
  { name: "Emerald",         hex: "#50C878", rarity: "legendary" },
  { name: "Crimson",         hex: "#DC143C", rarity: "legendary" },
  { name: "Sapphire",        hex: "#0F52BA", rarity: "legendary" },
  { name: "Amethyst",        hex: "#9966CC", rarity: "legendary" },
  { name: "Deep Violet",     hex: "#6600CC", rarity: "legendary" },
  { name: "Electric Orange", hex: "#FF6000", rarity: "legendary" },

  // ── ??? (0.2%) ─ luxury, premium, special ──────────────────
  { name: "Pure Gold",       hex: "#FFD700", rarity: "???" },
  { name: "Platinum",        hex: "#E5E4E2", rarity: "???" },
  { name: "Obsidian",        hex: "#0A0A0A", rarity: "???" },
  { name: "Discord Blurple", hex: "#5865F2", rarity: "???" },
  { name: "Discord Dark",    hex: "#1C1D22", rarity: "???" },
  { name: "Discord Sidebar", hex: "#2B2D31", rarity: "???" },
  { name: "Rose Gold",       hex: "#B76E79", rarity: "???" },
  { name: "Bidoof Gold",     hex: "#F5C842", rarity: "???" },
];

function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
function rollRarity(guaranteed) {
  if (guaranteed === "epic")      return weightedRandom(["epic","legendary","???"],  [70, 25, 5]);
  if (guaranteed === "legendary") return weightedRandom(["legendary","???"],          [90, 10]);
  const keys = Object.keys(RARITY);
  return weightedRandom(keys, keys.map((k) => RARITY[k].weight));
}
function randomColorByRarity(r) {
  const pool = COLORS.filter((c) => c.rarity === r);
  return pool[Math.floor(Math.random() * pool.length)];
}
function hexToInt(hex) { return parseInt(hex.replace("#", ""), 16); }

// ─────────────────────────────────────────────────────────────
//  ROLE HELPERS
// ─────────────────────────────────────────────────────────────
function isColorRoleName(name) {
  return Object.values(RARITY).some((cfg) => name.startsWith(cfg.emoji + " "));
}
function roleToColor(name) {
  for (const [rarity, cfg] of Object.entries(RARITY)) {
    if (name.startsWith(cfg.emoji + " "))
      return { colorName: name.slice(cfg.emoji.length + 1), rarity };
  }
  return null;
}
async function getOrCreateRole(guild, name, hex) {
  return (
    guild.roles.cache.find((r) => r.name === name) ??
    guild.roles.create({ name, color: hexToInt(hex), reason: "BidoofColor" })
  );
}
/** Remove all BidoofColor roles from a member and return the removed roles. */
async function removeOldColorRoles(member) {
  const old = member.roles.cache.filter((r) => isColorRoleName(r.name));
  if (old.size > 0) await member.roles.remove(old);
  return old;
}
/** Delete any BidoofColor roles that now have zero members. */
async function cleanupEmptyRoles(guild, roles) {
  for (const [, role] of roles) {
    try {
      // Fetch fresh member count
      const fresh = await guild.roles.fetch(role.id).catch(() => null);
      if (fresh && fresh.members.size === 0) {
        await fresh.delete("BidoofColor: no members left").catch(() => {});
      }
    } catch { /* already deleted */ }
  }
}

// ─────────────────────────────────────────────────────────────
//  BATTLE TRACKING
// ─────────────────────────────────────────────────────────────
// channelId → Set<messageId>  (messages collected during an active battle)
const activeBattles  = new Map();
// Set<battleKey>  (battles already rewarded to prevent double-paying)
const rewardedBattles = new Set();

// ─────────────────────────────────────────────────────────────
//  GYM TYPES
// ─────────────────────────────────────────────────────────────
const GYM_TYPES = [
  "Fire","Water","Grass","Electric","Psychic",
  "Ghost","Dragon","Dark","Fighting","Normal",
  "Ice","Ground","Flying","Rock","Bug","Poison","Steel","Fairy",
];

// ─────────────────────────────────────────────────────────────
//  COMMANDS
// ─────────────────────────────────────────────────────────────
const commands = [

  // ───────────────────────────────────────────────────────────
  //  /random
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("random")
      .setDescription("Roll a random colour! Costs 1 Bidoof Token.")
      .addStringOption((o) =>
        o.setName("mode").setDescription("Roll mode").setRequired(false)
          .addChoices(
            { name: "Standard (1 token)",              value: "standard"   },
            { name: "Guaranteed Epic (25 tokens)",     value: "epic"       },
            { name: "Guaranteed Legendary (50 tokens)",value: "legendary"  },
          )),
    async execute(i) {
      await i.deferReply();
      const mode = i.options.getString("mode") ?? "standard";
      const cost = mode === "epic" ? 25 : mode === "legendary" ? 50 : 1;

      if (!spendTokens(i.user.id, cost))
        return i.editReply(`❌ Need **${cost}** tokens but you have **${getUser(i.user.id).tokens}**. Use \`/daily\` to earn more.`);

      const rarity = rollRarity(mode !== "standard" ? mode : undefined);
      const color  = randomColorByRarity(rarity);
      const cfg    = RARITY[rarity];

      const embed = new EmbedBuilder()
        .setTitle(`${cfg.emoji} You rolled a colour!`)
        .setDescription(`**${color.name}**\n\`${color.hex}\`\n\nRarity: ${cfg.emoji} **${cfg.label}**`)
        .setColor(hexToInt(color.hex))
        .setFooter({ text: `Cost: ${cost} token${cost !== 1 ? "s" : ""} • /save <slot> to keep it` })
        .setTimestamp();

      if (i.guild) {
        try {
          const roleName = `${cfg.emoji} ${color.name}`;
          const role     = await getOrCreateRole(i.guild, roleName, color.hex);
          const member   = await i.guild.members.fetch(i.user.id);
          const old      = await removeOldColorRoles(member);
          await member.roles.add(role);
          await cleanupEmptyRoles(i.guild, old);
          embed.addFields({ name: "Role Applied", value: `<@&${role.id}>`, inline: true });
        } catch {
          embed.addFields({ name: "⚠️ Role", value: "Missing permissions", inline: true });
        }
      }
      embed.addFields({ name: "Balance", value: `${getUser(i.user.id).tokens} 🪙`, inline: true });
      await i.editReply({ embeds: [embed] });
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /inventory
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("inventory")
      .setDescription("View your saved colour slots and token balance.")
      .addUserOption((o) =>
        o.setName("user").setDescription("[Admin] Check another user").setRequired(false)),
    async execute(i) {
      await i.deferReply();
      const targetUser = i.options.getUser("user");
      if (targetUser && !i.memberPermissions?.has(PermissionFlagsBits.Administrator))
        return i.editReply("❌ Only admins can view other users' inventories.");

      const subject = targetUser ?? i.user;
      const u       = getUser(subject.id);
      const inv     = getInventory(subject.id);

      const embed = new EmbedBuilder()
        .setTitle(`🎨 ${subject.username}'s Inventory`)
        .setColor(0x5865f2)
        .setThumbnail(subject.displayAvatarURL())
        .setTimestamp()
        .addFields(
          { name: "💰 Tokens", value: `**${u.tokens}** 🪙`, inline: true },
          { name: "📦 Slots",  value: `**${inv.length}** / **${u.slots}** used`, inline: true },
        );

      if (u.lastDaily) {
        const hl = Math.max(0, 12 - (Date.now() - new Date(u.lastDaily).getTime()) / 3_600_000);
        const h  = Math.floor(hl), m = Math.floor((hl - h) * 60);
        embed.addFields({ name: "⏰ Daily", value: hl > 0 ? `${h}h ${m}m` : "Ready! `/daily`", inline: true });
      } else {
        embed.addFields({ name: "⏰ Daily", value: "Ready! Use `/daily`", inline: true });
      }

      if (inv.length === 0) {
        embed.setDescription("No colours saved yet. Use `/random` then `/save <slot>`.");
      } else {
        for (const s of inv) {
          const c = RARITY[s.rarity] ?? { emoji: "❓", label: s.rarity };
          embed.addFields({
            name:   `Slot ${s.slot}: ${c.emoji} ${s.color_name}`,
            value:  `\`${s.color_hex}\` — ${c.label}`,
            inline: true,
          });
        }
      }
      await i.editReply({ embeds: [embed] });
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /save
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("save")
      .setDescription("Save your currently equipped colour to an inventory slot.")
      .addIntegerOption((o) =>
        o.setName("slot").setDescription("Slot number (1–99)").setRequired(true).setMinValue(1).setMaxValue(99)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const slot = i.options.getInteger("slot", true);
      const max  = getMaxSlots(i.user.id);
      if (slot > max)
        return i.editReply(`❌ You only have **${max}** slot(s). Use \`/buy slot\` to unlock more.`);

      const member     = await i.guild.members.fetch(i.user.id);
      const colourRole = member.roles.cache.find((r) => isColorRoleName(r.name));
      if (!colourRole)
        return i.editReply("❌ No colour role equipped! Use `/random` first.");

      const info = roleToColor(colourRole.name);
      const hex  = "#" + colourRole.color.toString(16).padStart(6, "0");
      saveToSlot(i.user.id, slot, info.colorName, hex, info.rarity);

      const cfg = RARITY[info.rarity] ?? { emoji: "❓", label: info.rarity };
      await i.editReply({ embeds: [
        new EmbedBuilder()
          .setTitle("✅ Colour Saved!")
          .setDescription(`**${info.colorName}** → Slot **${slot}**\n\`${hex}\` — ${cfg.emoji} ${cfg.label}`)
          .setColor(hexToInt(hex))
          .setTimestamp(),
      ]});
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /equip
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("equip")
      .setDescription("Equip a saved colour from your inventory.")
      .addIntegerOption((o) =>
        o.setName("slot").setDescription("Slot to equip (1–99)").setRequired(true).setMinValue(1).setMaxValue(99)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const slot  = i.options.getInteger("slot", true);
      const inv   = getInventory(i.user.id);
      const entry = inv.find((s) => s.slot === slot);

      if (!entry) {
        const used = inv.map((s) => s.slot).join(", ") || "none";
        return i.editReply(`❌ Slot **${slot}** is empty! Your saved slots: **${used}**`);
      }

      const cfg = RARITY[entry.rarity] ?? { emoji: "❓", label: entry.rarity };
      try {
        const role   = await getOrCreateRole(i.guild, `${cfg.emoji} ${entry.color_name}`, entry.color_hex);
        const member = await i.guild.members.fetch(i.user.id);
        const old    = await removeOldColorRoles(member);
        await member.roles.add(role);
        await cleanupEmptyRoles(i.guild, old);
        await i.editReply({ embeds: [
          new EmbedBuilder()
            .setTitle("✅ Colour Equipped!")
            .setDescription(`Slot ${slot}: ${cfg.emoji} **${entry.color_name}**\n\`${entry.color_hex}\` — ${cfg.label}`)
            .setColor(hexToInt(entry.color_hex))
            .setTimestamp(),
        ]});
      } catch {
        await i.editReply("❌ Could not assign role — check bot permissions and role hierarchy.");
      }
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /daily
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("daily")
      .setDescription("Claim your free Bidoof Token every 12 hours."),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const result = claimDaily(i.user.id);
      if (!result.success) {
        const h = Math.floor(result.hoursLeft), m = Math.floor((result.hoursLeft - h) * 60);
        return i.editReply(`⏰ Already claimed! Come back in **${h}h ${m}m**.`);
      }
      await i.editReply({ embeds: [
        new EmbedBuilder()
          .setTitle("🪙 Daily Token Claimed!")
          .setDescription(`+1 token! Balance: **${result.newBalance}** 🪙`)
          .setColor(0xf5c842)
          .setFooter({ text: "Come back in 12 hours!" })
          .setTimestamp(),
      ]});
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /give  (admin)
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("give")
      .setDescription("[Admin] Give Bidoof Tokens to a user.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1).setMaxValue(9999)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const target = i.options.getUser("user", true);
      const amount = i.options.getInteger("amount", true);
      const bal    = addTokens(target.id, amount);
      await i.editReply({ embeds: [
        new EmbedBuilder()
          .setTitle("🪙 Tokens Given!")
          .setDescription(`Gave **${amount}** token${amount !== 1 ? "s" : ""} to <@${target.id}>.\nNew balance: **${bal}** 🪙`)
          .setColor(0xf5c842)
          .setTimestamp(),
      ]});
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /store
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("store")
      .setDescription("View the Bidoof Token store."),
    async execute(i) {
      await i.deferReply();
      const u        = getUser(i.user.id);
      const nextCost = u.slots < 99 ? slotCost(u.slots) : null;
      await i.editReply({ embeds: [
        new EmbedBuilder()
          .setTitle("🛒 Bidoof Token Store")
          .setColor(0xf5c842)
          .setDescription(`Balance: **${u.tokens}** 🪙 | Slots: **${u.slots}** / 99`)
          .addFields(
            { name: "🎲 Standard Roll — 1 token",                value: "`/random`",                                         inline: false },
            { name: "🟣 Guaranteed Epic Roll — 25 tokens",       value: "`/random mode:Guaranteed Epic`",                    inline: false },
            { name: "🟡 Guaranteed Legendary Roll — 50 tokens",  value: "`/random mode:Guaranteed Legendary`",               inline: false },
            { name: "📦 Extra Inventory Slot",                   value: nextCost ? `${nextCost} tokens → \`/buy slot\`` : "Max slots reached!", inline: false },
            { name: "✏️ Nickname Change — 10 tokens",            value: "`/buy name_change user:@user nickname:NewName`",    inline: false },
            { name: "📊 Slot Prices", value: "Slot 2: 5 | Slot 3: 10 | +5 each after", inline: false },
          )
          .setFooter({ text: "Free token every 12 hours with /daily" })
          .setTimestamp(),
      ]});
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /buy
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("buy")
      .setDescription("Purchase items from the store.")
      .addSubcommand((s) => s
        .setName("slot")
        .setDescription("Buy an extra inventory slot"))
      .addSubcommand((s) => s
        .setName("name_change")
        .setDescription("Change a member's nickname (10 tokens)")
        .addUserOption((o) => o.setName("user").setDescription("Member to rename").setRequired(true))
        .addStringOption((o) => o.setName("nickname").setDescription("New nickname (blank to reset)").setRequired(false))),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const sub = i.options.getSubcommand();

      if (sub === "slot") {
        const result = upgradeSlot(i.user.id);
        if (!result.success) return i.editReply(`❌ ${result.reason}`);
        const tokens = getUser(i.user.id).tokens;
        await i.editReply({ embeds: [
          new EmbedBuilder()
            .setTitle("📦 Slot Unlocked!")
            .setDescription(`You now have **${result.newSlots}** slots!\nCost: **${result.cost}** 🪙 | Remaining: **${tokens}** 🪙`)
            .setColor(0x57f287)
            .setFooter({ text: result.newSlots < 99 ? `Next slot: ${slotCost(result.newSlots)} tokens` : "Max slots!" })
            .setTimestamp(),
        ]});
      }

      if (sub === "name_change") {
        const COST = 10;
        if (!i.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames))
          return i.editReply("❌ I don't have the **Manage Nicknames** permission in this server.");

        const target   = i.options.getUser("user", true);
        const nickname = i.options.getString("nickname") ?? null;

        if (!spendTokens(i.user.id, COST))
          return i.editReply(`❌ Need **${COST}** tokens but you have **${getUser(i.user.id).tokens}**.`);

        try {
          const member = await i.guild.members.fetch(target.id);
          if (!member.manageable) {
            addTokens(i.user.id, COST); // refund
            return i.editReply("❌ Can't change that user's nickname — their role is higher than mine.");
          }
          await member.setNickname(nickname, `BidoofColor: purchased by ${i.user.tag}`);
          await i.editReply({ embeds: [
            new EmbedBuilder()
              .setTitle("✏️ Nickname Changed!")
              .setDescription(`<@${target.id}>'s nickname → **${nickname ?? "(reset)"}**\nRemaining balance: **${getUser(i.user.id).tokens}** 🪙`)
              .setColor(0x57f287)
              .setTimestamp(),
          ]});
        } catch (err) {
          addTokens(i.user.id, COST); // refund
          await i.editReply(`❌ Failed: ${err.message}`);
        }
      }
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /casino
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("casino")
      .setDescription("Bet Bidoof Tokens on a coin flip!")
      .addIntegerOption((o) => o.setName("bet").setDescription("Tokens to bet").setRequired(true).setMinValue(1))
      .addStringOption((o) =>
        o.setName("side").setDescription("Heads or Tails?").setRequired(true)
          .addChoices({ name: "Heads", value: "heads" }, { name: "Tails", value: "tails" })),
    async execute(i) {
      await i.deferReply();
      const bet  = i.options.getInteger("bet", true);
      const side = i.options.getString("side", true);
      const user = getUser(i.user.id);
      if (bet > user.tokens)
        return i.editReply(`❌ You only have **${user.tokens}** 🪙 — can't bet **${bet}**.`);

      const flip = Math.random() < 0.5 ? "heads" : "tails";
      const won  = flip === side;
      if (won) addTokens(i.user.id, bet); else spendTokens(i.user.id, bet);
      const newBal    = getUser(i.user.id).tokens;
      const coinEmoji = flip === "heads" ? "🪙 Heads" : "🌑 Tails";

      await i.editReply({ embeds: [
        new EmbedBuilder()
          .setTitle(won ? "🎉 You Won!" : "💸 You Lost!")
          .setDescription(`You called **${side}** — it landed **${coinEmoji}**!\n${won ? `+` : `-`}**${bet}** 🪙 | Balance: **${newBal}** 🪙`)
          .setColor(won ? 0x57f287 : 0xed4245)
          .setTimestamp(),
      ]});
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /list
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("list")
      .setDescription("Browse all available colors grouped by rarity.")
      .addStringOption((o) =>
        o.setName("rarity").setDescription("Filter by rarity (default: all)").setRequired(false)
          .addChoices(
            { name: "Common",    value: "common"    },
            { name: "Uncommon",  value: "uncommon"  },
            { name: "Rare",      value: "rare"      },
            { name: "Epic",      value: "epic"      },
            { name: "Legendary", value: "legendary" },
            { name: "???",       value: "???"       },
          )),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const filter = i.options.getString("rarity");
      const tiers  = filter ? [filter] : Object.keys(RARITY);
      const embeds = tiers.map((tier) => {
        const cfg  = RARITY[tier];
        const pool = COLORS.filter((c) => c.rarity === tier);
        return new EmbedBuilder()
          .setTitle(`${cfg.emoji} ${cfg.label} — ${pool.length} colors`)
          .setDescription(pool.map((c) => `**${c.name}** \`${c.hex}\``).join("\n") || "None.")
          .setColor(cfg.color);
      });
      // Discord allows max 10 embeds per message
      await i.editReply({ embeds: embeds.slice(0, 10) });
    },
  },

  // ═══════════════════════════════════════════════════════════
  //  GYM BADGE SYSTEM
  // ═══════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────
  //  /set_gym_leader  (admin)
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("set_gym_leader")
      .setDescription("[Admin] Assign a user as Gym Leader for a Pokémon type.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o.setName("type").setDescription("Pokémon type").setRequired(true)
          .addChoices(...GYM_TYPES.map((t) => ({ name: t, value: t }))))
      .addUserOption((o) => o.setName("user").setDescription("The new Gym Leader").setRequired(true)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const type    = i.options.getString("type", true);
      const user    = i.options.getUser("user",   true);
      const cfg     = loadConfig();

      // Remove this user from any previous gym leader position
      for (const [t, uid] of Object.entries(cfg.gymLeaders)) {
        if (uid === user.id) delete cfg.gymLeaders[t];
      }
      cfg.gymLeaders[type] = user.id;
      saveConfig(cfg);

      await i.editReply({ embeds: [
        new EmbedBuilder()
          .setTitle("🏟️ Gym Leader Assigned!")
          .setDescription(`<@${user.id}> is now the **${type}** Gym Leader.`)
          .setColor(0x57f287)
          .setTimestamp(),
      ]});
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /give_badge  (gym leaders)
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("give_badge")
      .setDescription("Give your Gym Badge to a user (Gym Leaders only).")
      .addUserOption((o) => o.setName("user").setDescription("Who receives the badge").setRequired(true)),
    async execute(i) {
      await i.deferReply();
      const cfg  = loadConfig();

      // Identify which gym type this person leads
      const type = Object.entries(cfg.gymLeaders).find(([, uid]) => uid === i.user.id)?.[0];
      if (!type)
        return i.editReply({ content: "❌ You are not a Gym Leader.", ephemeral: true });

      const target    = i.options.getUser("user", true);
      const targetData = getUser(target.id);

      if (targetData.badges.includes(type))
        return i.editReply({ content: `❌ <@${target.id}> already has the **${type}** Badge.`, ephemeral: true });

      targetData.badges.push(type);
      updateUser(target.id, { badges: targetData.badges });

      const badge = cfg.gymBadges[type];
      const embed = new EmbedBuilder()
        .setTitle(`🏅 ${badge?.name ?? type + " Badge"} Awarded!`)
        .setDescription(`<@${target.id}> has earned the **${badge?.name ?? type + " Badge"}**!\n*Presented by <@${i.user.id}> — ${type} Gym Leader*`)
        .setColor(0xf5c842)
        .setTimestamp();

      if (badge?.imageUrl) embed.setImage(badge.imageUrl);

      await i.editReply({ embeds: [embed] });
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /remove_badge  (gym leaders)
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("remove_badge")
      .setDescription("Revoke your Gym Badge from a user (Gym Leaders only).")
      .addUserOption((o) => o.setName("user").setDescription("Whose badge to remove").setRequired(true)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const cfg  = loadConfig();
      const type = Object.entries(cfg.gymLeaders).find(([, uid]) => uid === i.user.id)?.[0];
      if (!type) return i.editReply("❌ You are not a Gym Leader.");

      const target     = i.options.getUser("user", true);
      const targetData = getUser(target.id);

      if (!targetData.badges.includes(type))
        return i.editReply(`❌ <@${target.id}> does not have the **${type}** Badge.`);

      targetData.badges = targetData.badges.filter((b) => b !== type);
      updateUser(target.id, { badges: targetData.badges });

      await i.editReply({ embeds: [
        new EmbedBuilder()
          .setTitle("🏅 Badge Revoked")
          .setDescription(`Removed the **${type}** Badge from <@${target.id}>.`)
          .setColor(0xed4245)
          .setTimestamp(),
      ]});
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /badges
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("badges")
      .setDescription("View Gym Badges owned by yourself or another user.")
      .addUserOption((o) =>
        o.setName("user").setDescription("User to inspect (default: you)").setRequired(false)),
    async execute(i) {
      await i.deferReply();
      const target = i.options.getUser("user") ?? i.user;
      const u      = getUser(target.id);
      const cfg    = loadConfig();

      if (!u.badges || u.badges.length === 0) {
        return i.editReply({ embeds: [
          new EmbedBuilder()
            .setTitle(`🏅 ${target.username}'s Gym Badges`)
            .setDescription("No badges yet! Defeat a Gym Leader to earn one.")
            .setColor(0x5865f2)
            .setTimestamp(),
        ]});
      }

      // One embed per badge so the image renders large
      const badgeEmbeds = u.badges.map((type) => {
        const badge = cfg.gymBadges[type];
        const e = new EmbedBuilder()
          .setTitle(`${badge?.name ?? type + " Badge"}`)
          .setDescription(`**Type:** ${type}`)
          .setColor(0xf5c842);
        if (badge?.imageUrl) e.setImage(badge.imageUrl);
        return e;
      });

      // Header embed
      const header = new EmbedBuilder()
        .setTitle(`🏅 ${target.username}'s Gym Badges`)
        .setDescription(`**${u.badges.length}** badge${u.badges.length !== 1 ? "s" : ""} collected: ${u.badges.join(", ")}`)
        .setColor(0x5865f2)
        .setThumbnail(target.displayAvatarURL())
        .setTimestamp();

      await i.editReply({ embeds: [header, ...badgeEmbeds].slice(0, 10) });
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /set_badge_image  (admin)
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("set_badge_image")
      .setDescription("[Admin] Upload a badge image for a gym type.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption((o) =>
        o.setName("type").setDescription("Gym type").setRequired(true)
          .addChoices(...GYM_TYPES.map((t) => ({ name: t, value: t }))))
      .addStringOption((o) =>
        o.setName("name").setDescription("Badge name (e.g. Volcano Badge)").setRequired(true))
      .addAttachmentOption((o) =>
        o.setName("image").setDescription("Badge image (PNG/JPG/GIF)").setRequired(true)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const type  = i.options.getString("type", true);
      const name  = i.options.getString("name", true);
      const image = i.options.getAttachment("image", true);

      if (!image.contentType?.startsWith("image/"))
        return i.editReply("❌ Please upload an image file (PNG, JPG, or GIF).");

      const cfg = loadConfig();
      cfg.gymBadges[type] = { name, imageUrl: image.url };
      saveConfig(cfg);

      await i.editReply({ embeds: [
        new EmbedBuilder()
          .setTitle(`✅ Badge Configured: ${type}`)
          .setDescription(`**${name}** has been set as the **${type}** Gym Badge.`)
          .setImage(image.url)
          .setColor(0x57f287)
          .setTimestamp(),
      ]});
    },
  },

  // ═══════════════════════════════════════════════════════════
  //  BATTLE CHANNEL CONFIG  (admin)
  // ═══════════════════════════════════════════════════════════

  // ───────────────────────────────────────────────────────────
  //  /set_battle_channel
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("set_battle_channel")
      .setDescription("[Admin] Add a channel for Pokétwo gym battle tracking.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Battle channel").setRequired(true)
          .addChannelTypes(ChannelType.GuildText)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const ch  = i.options.getChannel("channel", true);
      const cfg = loadConfig();
      if (!cfg.battleChannels.includes(ch.id)) {
        cfg.battleChannels.push(ch.id);
        saveConfig(cfg);
      }
      await i.editReply(`✅ <#${ch.id}> is now a tracked battle channel.`);
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /remove_battle_channel
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("remove_battle_channel")
      .setDescription("[Admin] Remove a channel from battle tracking.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel to remove").setRequired(true)
          .addChannelTypes(ChannelType.GuildText)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const ch  = i.options.getChannel("channel", true);
      const cfg = loadConfig();
      cfg.battleChannels = cfg.battleChannels.filter((id) => id !== ch.id);
      saveConfig(cfg);
      await i.editReply(`✅ <#${ch.id}> removed from battle tracking.`);
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /set_results_channel
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("set_results_channel")
      .setDescription("[Admin] Set the channel where battle results are posted.")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Results channel").setRequired(true)
          .addChannelTypes(ChannelType.GuildText)),
    async execute(i) {
      await i.deferReply({ ephemeral: true });
      const ch  = i.options.getChannel("channel", true);
      const cfg = loadConfig();
      cfg.resultsChannel = ch.id;
      saveConfig(cfg);
      await i.editReply(`✅ Battle results will be posted in <#${ch.id}>.`);
    },
  },

  // ───────────────────────────────────────────────────────────
  //  /help
  // ───────────────────────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show all BidoofColor bot commands."),
    async execute(i) {
      await i.reply({ ephemeral: true, embeds: [
        new EmbedBuilder()
          .setTitle("🎨 BidoofColor Bot — Help")
          .setColor(0x5865f2)
          .setDescription("Roll colour roles, collect Gym Badges, and bet tokens! You start with **3 Bidoof Tokens** 🪙.")
          .addFields(
            { name: "🎲 Colours",  value: "`/random` `/save` `/equip` `/inventory` `/list`", inline: false },
            { name: "⭐ Rarities", value: "⚪60% Common · 🟢25% Uncommon · 🔵10% Rare\n🟣4% Epic · 🟡0.8% Legendary · 🌈0.2% ???", inline: false },
            { name: "🪙 Economy",  value: "`/daily` `/store` `/buy slot` `/buy name_change` `/casino` `/give`", inline: false },
            { name: "🏅 Gym",      value: "`/badges` · Gym Leaders: `/give_badge` `/remove_badge`", inline: false },
            { name: "🔑 Admin",    value: "`/set_gym_leader` `/set_badge_image`\n`/set_battle_channel` `/remove_battle_channel` `/set_results_channel`", inline: false },
          )
          .setFooter({ text: "BidoofColor Bot v2 · collect rare colours & gym badges!" })
          .setTimestamp(),
      ]});
    },
  },
];

// ─────────────────────────────────────────────────────────────
//  DISCORD CLIENT
// ─────────────────────────────────────────────────────────────
const commandMap = new Collection();
for (const cmd of commands) commandMap.set(cmd.data.name, cmd);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,  // ← must be enabled in Dev Portal
  ],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Logged in as ${c.user.tag}`);
  try {
    await new REST().setToken(TOKEN).put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands.map((c) => c.data.toJSON()) },
    );
    console.log(`✅ ${commands.length} slash commands registered globally.`);
  } catch (err) {
    console.error("❌ Failed to register commands:", err);
  }
});

// ── Slash command dispatcher ──
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commandMap.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(`[/${interaction.commandName}]`, err);
    const msg = { content: "❌ Something went wrong. Please try again.", ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else                                             await interaction.reply(msg).catch(() => {});
  }
});

// ─────────────────────────────────────────────────────────────
//  POKÉTWO BATTLE INTEGRATION
// ─────────────────────────────────────────────────────────────
//
//  How it works:
//  1. Any message from Pokétwo in a configured battle channel is collected.
//  2. When a battle-result message is detected (embed contains "won the
//     battle" or "has won"), the bot:
//       a) Posts a summary in the results channel (if configured).
//       b) Awards +1 Bidoof Token to the winner (resolved via mention).
//       c) Bulk-deletes all collected battle messages from the channel.
//  3. Each battle result is keyed so it can only be rewarded once.
// ─────────────────────────────────────────────────────────────

client.on(Events.MessageCreate, async (message) => {
  if (message.author.id !== POKETWO_ID) return;

  const cfg = loadConfig();
  if (!cfg.battleChannels.includes(message.channelId)) return;

  // ── Collect every Pokétwo message for cleanup later ──
  if (!activeBattles.has(message.channelId)) activeBattles.set(message.channelId, new Set());
  activeBattles.get(message.channelId).add(message.id);

  // ── Check if this is a battle result ──
  const embed = message.embeds?.[0];
  if (!embed) return;

  const allText = [
    embed.title        ?? "",
    embed.description  ?? "",
    ...(embed.fields?.map((f) => f.name + " " + f.value) ?? []),
  ].join(" ");

  const isResult =
    /won the battle/i.test(allText) ||
    /has won/i.test(allText);

  if (!isResult) return;

  // ── Deduplicate: only process each result once ──
  const battleKey = `${message.channelId}:${message.id}`;
  if (rewardedBattles.has(battleKey)) return;
  rewardedBattles.add(battleKey);

  // ── Parse winner & loser ──
  // Pokétwo format: "**WinnerName** won the battle against **LoserName**!"
  // or mention-based: "<@123> won the battle!"
  const desc = embed.description ?? embed.title ?? "";

  let winnerId   = null;
  let winnerName = "Unknown";
  let loserName  = "Unknown";

  // Try to find a user mention for the winner (most reliable)
  const mentionMatch = desc.match(/<@!?(\d+)>/);
  if (mentionMatch) {
    winnerId = mentionMatch[1];
  }

  // Bold-name pattern for display
  const boldMatch = desc.match(/\*\*(.+?)\*\*.*won.*\*\*(.+?)\*\*/i);
  if (boldMatch) {
    winnerName = boldMatch[1];
    loserName  = boldMatch[2];
  } else {
    const singleMatch = desc.match(/\*\*(.+?)\*\*.*(?:won the battle|has won)/i);
    if (singleMatch) winnerName = singleMatch[1];
  }

  // ── Award token to winner ──
  let winnerMember = null;
  if (winnerId) {
    try { winnerMember = await message.guild.members.fetch(winnerId); } catch { /* not found */ }
  }
  if (!winnerMember) {
    // Fall back to name search
    try {
      const results = await message.guild.members.fetch({ query: winnerName, limit: 1 });
      winnerMember  = results.first() ?? null;
    } catch { /* ignore */ }
  }

  if (winnerMember) {
    addTokens(winnerMember.id, 1);
    if (!winnerName || winnerName === "Unknown") {
      winnerName = winnerMember.displayName;
    }
  }

  // ── Save battle to history ──
  cfg.battleHistory.push({
    key:         battleKey,
    winnerId:    winnerMember?.id ?? null,
    winnerName,
    loserName,
    channelId:   message.channelId,
    timestamp:   new Date().toISOString(),
  });
  if (cfg.battleHistory.length > 500) cfg.battleHistory = cfg.battleHistory.slice(-500);
  saveConfig(cfg);

  // ── Post result to results channel ──
  if (cfg.resultsChannel) {
    try {
      const resultsCh = await client.channels.fetch(cfg.resultsChannel);
      const resultEmbed = new EmbedBuilder()
        .setTitle("⚔️ Pokétwo Gym Battle Result")
        .addFields(
          { name: "🏆 Winner", value: winnerMember ? `<@${winnerMember.id}>` : winnerName,  inline: true },
          { name: "💀 Loser",  value: loserName,                                             inline: true },
          { name: "📍 Battle Channel", value: `<#${message.channelId}>`,                    inline: false },
        )
        .setColor(0x57f287)
        .setFooter({ text: winnerMember ? `+1 Bidoof Token awarded to winner!` : "Result recorded." })
        .setTimestamp();

      await resultsCh.send({ embeds: [resultEmbed] });
    } catch (err) {
      console.error("[Results Channel]", err.message);
    }
  }

  // ── Clean up battle messages ──
  const msgIds = [...(activeBattles.get(message.channelId) ?? [])];
  activeBattles.delete(message.channelId);

  if (msgIds.length > 0) {
    try {
      const ch = message.channel;
      // bulkDelete only works for messages < 14 days old; true = filter old ones automatically
      for (let n = 0; n < msgIds.length; n += 100) {
        await ch.bulkDelete(msgIds.slice(n, n + 100), true).catch(() => {});
      }
    } catch (err) {
      console.error("[Battle Cleanup]", err.message);
    }
  }
});

// ── Start ──
client.login(TOKEN);
