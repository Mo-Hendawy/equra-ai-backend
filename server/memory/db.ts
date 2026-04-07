import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as path from 'path';
import * as schema from './schema.js';

const DB_PATH = path.join(process.cwd(), 'server', 'data', 'equra-memory.db');

// WAL must be set on the raw Database instance before drizzle wraps it.
// Setting via migration SQL does NOT reliably persist (drizzle-orm issue #4968).
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');   // 5s wait before SQLITE_BUSY error
sqlite.pragma('synchronous = normal'); // safe + faster than FULL

// Auto-create tables if they don't exist (no drizzle-kit migration needed on deploy)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    recommendation TEXT NOT NULL,
    confidence TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    inputs_hash TEXT NOT NULL,
    fair_value REAL,
    price_at_rec REAL,
    invalidation_reason TEXT,
    critic_weakness TEXT,
    critic_severity TEXT,
    critic_blocking TEXT,
    outcome_5d REAL,
    outcome_30d REAL,
    outcome_90d REAL,
    scored_5d_at INTEGER,
    scored_30d_at INTEGER,
    scored_90d_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    lesson TEXT NOT NULL,
    context TEXT NOT NULL,
    valid_until INTEGER,
    macro_regime TEXT,
    decision_id INTEGER REFERENCES decisions(id),
    lance_episode_id TEXT
  );
  CREATE TABLE IF NOT EXISTS strategy_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version INTEGER NOT NULL,
    prompt_text TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    performance_score REAL,
    is_active INTEGER NOT NULL DEFAULT 0
  );
`);

export const db = drizzle({ client: sqlite, schema });
export { sqlite };
