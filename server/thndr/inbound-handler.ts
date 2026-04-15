// Accepts a Postmark-format inbound webhook, extracts the PDF attachment,
// parses it into transactions, resolves symbols, persists, and fires a push.
import { parseThndrPdf } from './pdf-parser.js';
import { resolveSymbol, type SymbolMap } from './symbol-resolver.js';
import { thndrService } from './thndr-service.js';
import { dispatchPush } from '../calendar/push-dispatcher.js';
import type { PostmarkInbound, ThndrTransactionRow } from './types.js';

export interface InboundResult {
  receivedCount: number;
  savedCount: number;
  duplicateCount: number;
  transactions: ThndrTransactionRow[];
  errors: string[];
}

export async function handleInbound(
  payload: PostmarkInbound,
  symbolMap: SymbolMap
): Promise<InboundResult> {
  const result: InboundResult = {
    receivedCount: 0,
    savedCount: 0,
    duplicateCount: 0,
    transactions: [],
    errors: [],
  };

  const pdfAtt = (payload.Attachments ?? []).find(
    a => (a.ContentType || '').includes('pdf') || a.Name?.toLowerCase().endsWith('.pdf')
  );
  if (!pdfAtt) {
    result.errors.push('No PDF attachment found on inbound email');
    return result;
  }

  let parsed;
  try {
    const pdfBuffer = Buffer.from(pdfAtt.Content, 'base64');
    parsed = await parseThndrPdf(pdfBuffer);
  } catch (e) {
    result.errors.push(`PDF parse failed: ${(e as Error).message}`);
    return result;
  }

  result.receivedCount = parsed.length;
  if (parsed.length === 0) {
    result.errors.push('PDF parsed but no transactions found');
    return result;
  }

  const knownTickers = Object.values(symbolMap);

  for (const txn of parsed) {
    try {
      const resolved = await resolveSymbol({
        securityName: txn.securityName,
        isin: txn.isin,
        knownMap: symbolMap,
        knownTickers,
      });
      const newId = thndrService.saveIfNew(txn, { symbol: resolved.ticker, source: resolved.source });
      if (newId === null) {
        result.duplicateCount++;
      } else {
        result.savedCount++;
        const row = thndrService.getById(newId);
        if (row) result.transactions.push(row);
      }
    } catch (e) {
      result.errors.push(`${txn.transactionNo}: ${(e as Error).message}`);
    }
  }

  // Fire push notification for any newly-saved transactions
  if (result.transactions.length > 0) {
    const { title, body } = summarizePush(result.transactions);
    try {
      await dispatchPush({
        title,
        body,
        data: { route: 'ThndrImports' },
      });
    } catch (e) {
      result.errors.push(`Push dispatch failed: ${(e as Error).message}`);
    }
  }

  return result;
}

function summarizePush(txns: ThndrTransactionRow[]): { title: string; body: string } {
  if (txns.length === 1) {
    const t = txns[0];
    const ticker = t.resolvedSymbol ?? t.securityName;
    const verb = t.transactionType === 'buy' ? 'Buy' : 'Sell';
    return {
      title: 'Thndr trade imported',
      body: `${verb} ${ticker} ${t.quantity.toLocaleString()} @ ${t.price} EGP — tap to review`,
    };
  }
  return {
    title: 'Thndr trades imported',
    body: `${txns.length} new trades from Thndr — tap to review`,
  };
}
