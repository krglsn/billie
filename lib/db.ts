/**
 * Billie internal state (domains + invoices).
 * Unset/empty BILLIE_DB_PATH → in-memory SQLite (no files; lost on process restart).
 * Set BILLIE_DB_PATH → SQLite file at that path.
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var __billieDb: Database.Database | undefined;
}

const MEMORY_PATH = ":memory:";

function resolveDbPath(): string {
  const fromEnv = process.env.BILLIE_DB_PATH?.trim();
  if (!fromEnv) return MEMORY_PATH;
  if (fromEnv === MEMORY_PATH) return MEMORY_PATH;
  return path.isAbsolute(fromEnv)
    ? fromEnv
    : path.join(process.cwd(), fromEnv);
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS linked_domains (
      name TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      parent_name TEXT NOT NULL,
      agent_address TEXT NOT NULL UNIQUE,
      human_id TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      ens_owner TEXT NOT NULL,
      protocol TEXT NOT NULL,
      token_id TEXT NOT NULL,
      resolver TEXT NOT NULL,
      subregistry TEXT NOT NULL,
      linked_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_linked_domains_human
      ON linked_domains (human_id);

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL,
      full_name TEXT NOT NULL UNIQUE,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL,
      token TEXT NOT NULL,
      payment_address TEXT NOT NULL,
      root_domain TEXT NOT NULL,
      agent_address TEXT NOT NULL,
      human_id TEXT NOT NULL,
      status TEXT NOT NULL,
      attestation_json TEXT NOT NULL,
      texts_json TEXT NOT NULL,
      chain_id TEXT NOT NULL,
      tx_json TEXT NOT NULL,
      stub_calldata INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tx_hash TEXT,
      texts_tx_hash TEXT,
      texts_written INTEGER,
      texts_error TEXT,
      error TEXT,
      error_code TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_agent
      ON invoices (agent_address);
  `);
}

export function getDb(): Database.Database {
  if (globalThis.__billieDb) {
    return globalThis.__billieDb;
  }

  const dbPath = resolveDbPath();
  const inMemory = dbPath === MEMORY_PATH;
  if (!inMemory) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  if (inMemory) {
    db.pragma("journal_mode = MEMORY");
  } else {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  migrate(db);

  globalThis.__billieDb = db;
  return db;
}
