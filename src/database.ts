import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { config } from "./config";

const dir = path.dirname(config.databasePath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT UNIQUE NOT NULL,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  chain TEXT NOT NULL,
  source_post_id TEXT NOT NULL,
  source_username TEXT NOT NULL,
  ticker TEXT,
  name TEXT,
  decimals INTEGER,
  result TEXT,
  reason TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(address, chain)
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  chain TEXT NOT NULL,
  ticker TEXT,
  source_post_id TEXT,
  source_username TEXT,
  status TEXT NOT NULL,
  buy_amount_eth REAL,
  tx_hash TEXT,
  error_message TEXT,
  dry_run INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn("tokens", "name", "TEXT");
ensureColumn("tokens", "decimals", "INTEGER");
ensureColumn("tokens", "result", "TEXT");
ensureColumn("tokens", "reason", "TEXT");
ensureColumn("trades", "buy_amount_eth", "REAL");

export function isPostProcessed(postId: string): boolean {
  return !!db.prepare("SELECT 1 FROM posts WHERE post_id = ?").get(postId);
}

export function markPostProcessed(postId: string, username: string, text: string): void {
  db.prepare("INSERT OR IGNORE INTO posts (post_id, username, text) VALUES (?, ?, ?)").run(postId, username, text);
}

export function getLastPostId(): string | null {
  const row = db.prepare("SELECT value FROM bot_state WHERE key = 'last_post_id'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

export function setLastPostId(postId: string): void {
  db.prepare("INSERT INTO bot_state (key, value) VALUES ('last_post_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(postId);
}

export function isCAProcessed(address: string, chain = "base"): boolean {
  return !!db.prepare("SELECT 1 FROM tokens WHERE lower(address) = lower(?) AND chain = ?").get(address, chain);
}

export function saveDetection(params: {
  address: string;
  chain: string;
  sourcePostId: string;
  sourceUsername: string;
  ticker?: string;
  name?: string;
  decimals?: number;
  result: "match" | "mismatch" | "error";
  reason?: string;
}): void {
  db.prepare(`INSERT OR IGNORE INTO tokens
    (address, chain, source_post_id, source_username, ticker, name, decimals, result, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(params.address, params.chain, params.sourcePostId, params.sourceUsername, params.ticker ?? null,
      params.name ?? null, params.decimals ?? null, params.result, params.reason ?? null);
}

export function createTrade(params: {
  address: string;
  chain: string;
  ticker?: string;
  sourcePostId?: string;
  sourceUsername?: string;
  status: "pending" | "success" | "failed" | "rejected" | "simulated";
  buyAmountEth?: number;
  dryRun: boolean;
  errorMessage?: string;
}): number {
  const info = db.prepare(`INSERT INTO trades
    (address, chain, ticker, source_post_id, source_username, status, buy_amount_eth, dry_run, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(params.address, params.chain, params.ticker ?? null, params.sourcePostId ?? null, params.sourceUsername ?? null,
      params.status, params.buyAmountEth ?? null, params.dryRun ? 1 : 0, params.errorMessage ?? null);
  return Number(info.lastInsertRowid);
}

export function updateTrade(id: number, updates: Partial<{ status: string; txHash: string; errorMessage: string }>): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined) { fields.push("status = ?"); values.push(updates.status); }
  if (updates.txHash !== undefined) { fields.push("tx_hash = ?"); values.push(updates.txHash); }
  if (updates.errorMessage !== undefined) { fields.push("error_message = ?"); values.push(updates.errorMessage); }
  fields.push("updated_at = datetime('now')");
  values.push(id);
  db.prepare(`UPDATE trades SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function getStats() {
  const detectedCAs = Number((db.prepare("SELECT COUNT(*) c FROM tokens").get() as { c: number }).c);
  const successfulBuys = Number((db.prepare("SELECT COUNT(*) c FROM trades WHERE status IN ('success','simulated')").get() as { c: number }).c);
  const failedBuys = Number((db.prepare("SELECT COUNT(*) c FROM trades WHERE status = 'failed'").get() as { c: number }).c);
  const rejectedBuys = Number((db.prepare("SELECT COUNT(*) c FROM trades WHERE status = 'rejected'").get() as { c: number }).c);
  return { detectedCAs, successfulBuys, failedBuys, rejectedBuys };
}
