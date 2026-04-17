// DB operations for the Thndr email-import pipeline.
import Database from 'better-sqlite3';
import * as path from 'path';
import type { ParsedThndrTransaction, ResolutionSource, ThndrTransactionRow, TxnStatus } from './types.js';

const DB_PATH = process.env.MEMORY_DB_PATH
  ? process.env.MEMORY_DB_PATH
  : path.join(process.cwd(), 'server', 'data', 'equra-memory.db');

class ThndrService {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    if (DB_PATH !== ':memory:') {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
    }
  }

  /**
   * Insert a parsed transaction. Idempotent on transaction_no: if the same
   * transaction number already exists, nothing is inserted and null is returned.
   */
  saveIfNew(
    parsed: ParsedThndrTransaction,
    resolved: { symbol: string | null; source: ResolutionSource },
    force = false
  ): number | null {
    const existing = this.db
      .prepare('SELECT id FROM thndr_transactions WHERE transaction_no = ?')
      .get(parsed.transactionNo) as { id: number } | undefined;
    if (existing && !force) return null;
    if (existing && force) {
      this.db.prepare('DELETE FROM thndr_transactions WHERE id = ?').run(existing.id);
    }

    const result = this.db
      .prepare(
        `INSERT INTO thndr_transactions
         (invoice_date, transaction_no, security_name, isin, resolved_symbol, resolution_source,
          transaction_type, quantity, price, value, fees, grand_total, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        parsed.invoiceDate,
        parsed.transactionNo,
        parsed.securityName,
        parsed.isin ?? null,
        resolved.symbol,
        resolved.source,
        parsed.transactionType,
        parsed.quantity,
        parsed.price,
        parsed.value,
        parsed.fees,
        parsed.grandTotal
      );
    return result.lastInsertRowid as number;
  }

  listPending(limit = 50): ThndrTransactionRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM thndr_transactions
         WHERE status = 'pending'
         ORDER BY received_at DESC
         LIMIT ?`
      )
      .all(limit) as any[];
    return rows.map(rowToModel);
  }

  setStatus(id: number, status: TxnStatus): boolean {
    const stmt = status === 'imported'
      ? this.db.prepare('UPDATE thndr_transactions SET status = ?, imported_at = unixepoch() WHERE id = ?')
      : this.db.prepare('UPDATE thndr_transactions SET status = ? WHERE id = ?');
    const res = stmt.run(status, id);
    return res.changes > 0;
  }

  getById(id: number): ThndrTransactionRow | null {
    const row = this.db
      .prepare('SELECT * FROM thndr_transactions WHERE id = ?')
      .get(id) as any | undefined;
    return row ? rowToModel(row) : null;
  }
}

function rowToModel(row: any): ThndrTransactionRow {
  return {
    id: row.id,
    receivedAt: row.received_at,
    invoiceDate: row.invoice_date,
    transactionNo: row.transaction_no,
    securityName: row.security_name,
    isin: row.isin ?? undefined,
    resolvedSymbol: row.resolved_symbol,
    resolutionSource: row.resolution_source as ResolutionSource,
    transactionType: row.transaction_type,
    quantity: row.quantity,
    price: row.price,
    value: row.value,
    fees: row.fees,
    grandTotal: row.grand_total,
    status: row.status as TxnStatus,
    importedAt: row.imported_at,
  };
}

export const thndrService = new ThndrService();
