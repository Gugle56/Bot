import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "users.json");

type InventoryItem = {
  slot: number;
  color_name: string;
  color_hex: string;
  rarity: string;
  saved_at: string;
};

type UserData = {
  discord_id: string;
  tokens: number;
  last_daily: string | null;
  max_slots: number;
  inventory: InventoryItem[];
};

type Database = Record<string, UserData>;

function ensureDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, "{}");
  }
}

function loadDB(): Database {
  ensureDatabase();

  return JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Database;
}

function saveDB(db: Database) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export async function ensureUser(discordId: string): Promise<void> {
  const db = loadDB();

  if (!db[discordId]) {
    db[discordId] = {
      discord_id: discordId,
      tokens: 3,
      last_daily: null,
      max_slots: 1,
      inventory: [],
    };

    saveDB(db);
  }
}

export async function getUser(discordId: string) {
  await ensureUser(discordId);

  const db = loadDB();

  return db[discordId];
}

export async function getTokens(discordId: string): Promise<number> {
  const user = await getUser(discordId);

  return user.tokens;
}

export async function spendTokens(
  discordId: string,
  amount: number,
): Promise<boolean> {
  const db = loadDB();

  const user = db[discordId];

  if (!user || user.tokens < amount) {
    return false;
  }

  user.tokens -= amount;

  saveDB(db);

  return true;
}

export async function addTokens(
  discordId: string,
  amount: number,
): Promise<number> {
  await ensureUser(discordId);

  const db = loadDB();

  db[discordId].tokens += amount;

  saveDB(db);

  return db[discordId].tokens;
}

export async function claimDaily(discordId: string): Promise<{
  success: boolean;
  hoursLeft?: number;
  newBalance?: number;
}> {
  await ensureUser(discordId);

  const db = loadDB();

  const user = db[discordId];

  if (user.last_daily) {
    const diff = Date.now() - new Date(user.last_daily).getTime();

    const hoursLeft = 12 - diff / 3_600_000;

    if (hoursLeft > 0) {
      return {
        success: false,
        hoursLeft,
      };
    }
  }

  user.tokens += 1;
  user.last_daily = new Date().toISOString();

  saveDB(db);

  return {
    success: true,
    newBalance: user.tokens,
  };
}

export async function getInventory(discordId: string) {
  await ensureUser(discordId);

  const db = loadDB();

  return db[discordId].inventory.sort((a, b) => a.slot - b.slot);
}

export async function saveToSlot(
  discordId: string,
  slot: number,
  colorName: string,
  colorHex: string,
  rarity: string,
): Promise<void> {
  await ensureUser(discordId);

  const db = loadDB();

  const user = db[discordId];

  const existing = user.inventory.find((i) => i.slot === slot);

  if (existing) {
    existing.color_name = colorName;
    existing.color_hex = colorHex;
    existing.rarity = rarity;
    existing.saved_at = new Date().toISOString();
  } else {
    user.inventory.push({
      slot,
      color_name: colorName,
      color_hex: colorHex,
      rarity,
      saved_at: new Date().toISOString(),
    });
  }

  saveDB(db);
}

export async function getMaxSlots(discordId: string): Promise<number> {
  const user = await getUser(discordId);

  return user.max_slots;
}

export async function upgradeSlot(discordId: string): Promise<{
  success: boolean;
  newSlots?: number;
  cost?: number;
  currentTokens?: number;
  reason?: string;
}> {
  await ensureUser(discordId);

  const db = loadDB();

  const user = db[discordId];

  const currentSlots = user.max_slots;

  if (currentSlots >= 99) {
    return {
      success: false,
      reason: "You already have the maximum 99 slots!",
    };
  }

  const cost = slotCost(currentSlots);

  if (user.tokens < cost) {
    return {
      success: false,
      cost,
      currentTokens: user.tokens,
      reason: `Not enough Bidoof Tokens! You need ${cost} but have ${user.tokens}.`,
    };
  }

  user.tokens -= cost;
  user.max_slots += 1;

  saveDB(db);

  return {
    success: true,
    newSlots: user.max_slots,
    cost,
  };
}

export function slotCost(currentSlots: number): number {
  return currentSlots * 5;
    }
