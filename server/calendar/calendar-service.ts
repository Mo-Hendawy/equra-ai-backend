// SQLite operations for the dividend calendar feature.
// Reuses the equra-memory.db file created by MemoryService (tables defined there too).
import Database from 'better-sqlite3';
import * as path from 'path';
import { createHash } from 'crypto';
import type {
  ChangedEvent,
  ClapsEvent,
  NotificationHistoryItem,
  PushToken,
} from './calendar-types.js';
import { extractSymbol } from './calendar-api.js';

const DB_PATH = process.env.MEMORY_DB_PATH
  ? process.env.MEMORY_DB_PATH
  : path.join(process.cwd(), 'server', 'data', 'equra-memory.db');

function makeSnapshotHash(e: ClapsEvent): string {
  const payload = `${e.id}|${e.title}|${e.start_date}|${e.end_date}|${e.modified_utc}`;
  return createHash('sha1').update(payload).digest('hex');
}

class CalendarService {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    if (DB_PATH !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
    }
  }

  /**
   * Compare incoming events against stored snapshots. Returns the diff and
   * upserts the new snapshot in a single transaction.
   */
  diffAndUpsert(events: ClapsEvent[]): { newEvents: ChangedEvent[]; updatedEvents: ChangedEvent[] } {
    const existingRows = this.db
      .prepare('SELECT event_id, snapshot_hash FROM calendar_events')
      .all() as Array<{ event_id: number; snapshot_hash: string }>;
    const existing = new Map(existingRows.map((r) => [r.event_id, r.snapshot_hash]));

    const newEvents: ChangedEvent[] = [];
    const updatedEvents: ChangedEvent[] = [];

    const upsert = this.db.prepare(`
      INSERT INTO calendar_events (event_id, title, start_date, end_date, modified_utc, tag_symbol, url, snapshot_hash, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(event_id) DO UPDATE SET
        title = excluded.title,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        modified_utc = excluded.modified_utc,
        tag_symbol = excluded.tag_symbol,
        url = excluded.url,
        snapshot_hash = excluded.snapshot_hash,
        last_seen_at = unixepoch()
    `);

    const txn = this.db.transaction((evts: ClapsEvent[]) => {
      for (const e of evts) {
        const symbol = extractSymbol(e);
        const hash = makeSnapshotHash(e);
        const prev = existing.get(e.id);
        if (prev === undefined) {
          newEvents.push({ id: e.id, title: e.title, start_date: e.start_date, symbol, type: 'new' });
        } else if (prev !== hash) {
          updatedEvents.push({ id: e.id, title: e.title, start_date: e.start_date, symbol, type: 'updated' });
        }
        upsert.run(e.id, e.title, e.start_date, e.end_date, e.modified_utc, symbol, e.url, hash);
      }
    });
    txn(events);
    return { newEvents, updatedEvents };
  }

  /** Register or refresh a device push token. */
  upsertPushToken(token: string, platform: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO push_tokens (token, platform, created_at, last_seen_at)
      VALUES (?, ?, unixepoch(), unixepoch())
      ON CONFLICT(token) DO UPDATE SET last_seen_at = unixepoch()
    `);
    stmt.run(token, platform);
  }

  /** Returns all known push tokens. */
  listPushTokens(): PushToken[] {
    const rows = this.db.prepare('SELECT token, platform FROM push_tokens').all() as Array<{ token: string; platform: string }>;
    return rows.map((r) => ({ token: r.token, platform: r.platform as PushToken['platform'] }));
  }

  /** Remove tokens that Expo flagged as DeviceNotRegistered. */
  removePushTokens(tokens: string[]): void {
    if (!tokens.length) return;
    const stmt = this.db.prepare('DELETE FROM push_tokens WHERE token = ?');
    const txn = this.db.transaction((ts: string[]) => {
      for (const t of ts) stmt.run(t);
    });
    txn(tokens);
  }

  /** Persist a sent notification batch for the history feed. */
  saveNotification(args: {
    title: string;
    body: string;
    newEvents: ChangedEvent[];
    updatedEvents: ChangedEvent[];
    recipientsCount: number;
  }): number {
    const events = [...args.newEvents, ...args.updatedEvents];
    const stmt = this.db.prepare(`
      INSERT INTO calendar_notifications (sent_at, title, body, new_count, updated_count, event_ids, recipients_count)
      VALUES (unixepoch(), ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(args.title, args.body, args.newEvents.length, args.updatedEvents.length, JSON.stringify(events), args.recipientsCount);
    return result.lastInsertRowid as number;
  }

  /** Latest N notifications, newest first. */
  listNotifications(limit = 10): NotificationHistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, sent_at, title, body, new_count, updated_count, event_ids
         FROM calendar_notifications
         ORDER BY sent_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: number;
      sent_at: number;
      title: string;
      body: string;
      new_count: number;
      updated_count: number;
      event_ids: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      sent_at: r.sent_at,
      title: r.title,
      body: r.body,
      new_count: r.new_count,
      updated_count: r.updated_count,
      events: JSON.parse(r.event_ids) as ChangedEvent[],
    }));
  }
}

export const calendarService = new CalendarService();
