import pg from "pg";
// eslint-disable-next-line @typescript-eslint/no-unused-vars

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query(sql: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function ensureUser(discordId: string): Promise<void> {
  await query(
    `INSERT INTO users (discord_id, tokens, last_daily)
     VALUES ($1, 3, NULL)
     ON CONFLICT (discord_id) DO NOTHING`,
    [discordId],
  );
  await query(
    `INSERT INTO user_slots (discord_id, max_slots)
     VALUES ($1, 1)
     ON CONFLICT (discord_id) DO NOTHING`,
    [discordId],
  );
}

export async function getUser(discordId: string) {
  await ensureUser(discordId);
  const res = await query(
    `SELECT u.discord_id, u.tokens, u.last_daily, us.max_slots
     FROM users u
     JOIN user_slots us ON u.discord_id = us.discord_id
     WHERE u.discord_id = $1`,
    [discordId],
  );
  return res.rows[0] as {
    discord_id: string;
    tokens: number;
    last_daily: Date | null;
    max_slots: number;
  };
}

export async function getTokens(discordId: string): Promise<number> {
  const user = await getUser(discordId);
  return user.tokens;
}

export async function spendTokens(
  discordId: string,
  amount: number,
): Promise<boolean> {
  const res = await query(
    `UPDATE users SET tokens = tokens - $2
     WHERE discord_id = $1 AND tokens >= $2
     RETURNING tokens`,
    [discordId, amount],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function addTokens(
  discordId: string,
  amount: number,
): Promise<number> {
  const res = await query(
    `UPDATE users SET tokens = tokens + $2
     WHERE discord_id = $1
     RETURNING tokens`,
    [discordId, amount],
  );
  return res.rows[0].tokens as number;
}

export async function claimDaily(discordId: string): Promise<{
  success: boolean;
  hoursLeft?: number;
  newBalance?: number;
}> {
  await ensureUser(discordId);
  const user = await getUser(discordId);
  if (user.last_daily) {
    const diff = Date.now() - new Date(user.last_daily).getTime();
    const hoursLeft = 12 - diff / 3_600_000;
    if (hoursLeft > 0) return { success: false, hoursLeft };
  }
  const res = await query(
    `UPDATE users SET tokens = tokens + 1, last_daily = NOW()
     WHERE discord_id = $1
     RETURNING tokens`,
    [discordId],
  );
  return { success: true, newBalance: res.rows[0].tokens };
}

export async function getInventory(discordId: string) {
  const res = await query(
    `SELECT slot, color_name, color_hex, rarity, saved_at
     FROM inventory
     WHERE discord_id = $1
     ORDER BY slot ASC`,
    [discordId],
  );
  return res.rows as {
    slot: number;
    color_name: string;
    color_hex: string;
    rarity: string;
    saved_at: Date;
  }[];
}

export async function saveToSlot(
  discordId: string,
  slot: number,
  colorName: string,
  colorHex: string,
  rarity: string,
): Promise<void> {
  await query(
    `INSERT INTO inventory (discord_id, slot, color_name, color_hex, rarity)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_id, slot) DO UPDATE
     SET color_name = $3, color_hex = $4, rarity = $5, saved_at = NOW()`,
    [discordId, slot, colorName, colorHex, rarity],
  );
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
  const user = await getUser(discordId);
  const currentSlots = user.max_slots;
  if (currentSlots >= 99) {
    return { success: false, reason: "You already have the maximum 99 slots!" };
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
  const spent = await spendTokens(discordId, cost);
  if (!spent) {
    return { success: false, reason: "Failed to spend tokens." };
  }
  const res = await query(
    `UPDATE user_slots SET max_slots = max_slots + 1
     WHERE discord_id = $1
     RETURNING max_slots`,
    [discordId],
  );
  return { success: true, newSlots: res.rows[0].max_slots, cost };
}

export function slotCost(currentSlots: number): number {
  return (currentSlots) * 5;
}
