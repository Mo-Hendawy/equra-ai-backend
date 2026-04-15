// Types for the Thndr email-import pipeline.

export type TransactionType = 'buy' | 'sell';
export type ResolutionSource = 'isin' | 'name-match' | 'gemini' | null;
export type TxnStatus = 'pending' | 'imported' | 'dismissed';

/** One parsed transaction row extracted from a Thndr invoice PDF. */
export interface ParsedThndrTransaction {
  invoiceDate: string;          // "DD/MM/YYYY"
  transactionNo: string;        // e.g. "N000238603014"
  securityName: string;         // raw name as printed
  isin?: string;                // e.g. "EGS512O1C012"
  transactionType: TransactionType;
  quantity: number;
  price: number;
  value: number;
  fees: number;
  grandTotal: number;
}

/** After symbol resolution, the DB row we persist. */
export interface ThndrTransactionRow extends ParsedThndrTransaction {
  id: number;
  receivedAt: number;
  resolvedSymbol: string | null;
  resolutionSource: ResolutionSource;
  status: TxnStatus;
  importedAt: number | null;
}

/** Postmark inbound webhook (only the fields we need). */
export interface PostmarkInbound {
  From?: string;
  Subject?: string;
  Date?: string;
  Attachments?: PostmarkAttachment[];
}

export interface PostmarkAttachment {
  Name: string;
  Content: string;      // base64
  ContentType: string;
  ContentLength: number;
}
