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

export const db = drizzle({ client: sqlite, schema });
export { sqlite };
