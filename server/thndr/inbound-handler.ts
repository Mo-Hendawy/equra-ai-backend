// Accepts a Postmark-format inbound webhook, extracts the PDF attachment,
// parses it into transactions, resolves symbols, persists, and fires a push.
import { parseThndrPdf } from './pdf-parser.js';
import { extractFromImage } from './vision-extractor.js';
import { resolveSymbol, type SymbolMap } from './symbol-resolver.js';
import { thndrService } from './thndr-service.js';
import { dispatchPush } from '../calendar/push-dispatcher.js';
import type { ParsedThndrTransaction, PostmarkInbound, ThndrTransactionRow } from './types.js';

export interface InboundResult {
  receivedCount: number;
  savedCount: number;
  duplicateCount: number;
  transactions: ThndrTransactionRow[];
  errors: string[];
}

/**
 * Shared post-parse pipeline: resolve symbols, persist new rows,
 * fire push notification. Used by both the email webhook and the direct upload endpoint.
 */
export async function persistAndNotify(
  parsed: ParsedThndrTransaction[],
  symbolMap: SymbolMap,
  force = false
): Promise<InboundResult> {
  const result: InboundResult = {
    receivedCount: parsed.length,
    savedCount: 0,
    duplicateCount: 0,
    transactions: [],
    errors: [],
  };
  if (parsed.length === 0) return result;

  const knownTickers = Object.values(symbolMap);

  for (const txn of parsed) {
    try {
      const resolved = await resolveSymbol({
        securityName: txn.securityName,
        isin: txn.isin,
        knownMap: symbolMap,
        knownTickers,
      });
      const newId = thndrService.saveIfNew(txn, { symbol: resolved.ticker, source: resolved.source }, force);
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

/**
 * Handle a direct-upload (base64 file). Routes to the PDF parser or Gemini Vision
 * extractor based on MIME type. Returns the same shape as the email webhook.
 */
export async function handleUpload(args: {
  base64: string;
  contentType: string;
  symbolMap: SymbolMap;
  force?: boolean;
}): Promise<InboundResult> {
  const { base64, contentType, symbolMap, force = false } = args;
  const result: InboundResult = {
    receivedCount: 0, savedCount: 0, duplicateCount: 0, transactions: [], errors: [],
  };
  if (!base64 || typeof base64 !== 'string') {
    result.errors.push('Missing base64 payload');
    return result;
  }
  const isPdf = contentType?.includes('pdf');
  const isImage = contentType?.startsWith('image/');
  let parsed: ParsedThndrTransaction[];
  try {
    if (isPdf) {
      parsed = await parseThndrPdf(Buffer.from(base64, 'base64'));
    } else if (isImage) {
      parsed = await extractFromImage(base64, contentType);
    } else {
      result.errors.push(`Unsupported content type: ${contentType}. Use application/pdf or image/*.`);
      return result;
    }
  } catch (e) {
    result.errors.push(`Parse failed: ${(e as Error).message}`);
    return result;
  }
  return persistAndNotify(parsed, symbolMap, force);
}

export async function handleInbound(
  payload: PostmarkInbound,
  symbolMap: SymbolMap
): Promise<InboundResult> {
  const pdfAtt = (payload.Attachments ?? []).find(
    a => (a.ContentType || '').includes('pdf') || a.Name?.toLowerCase().endsWith('.pdf')
  );
  if (!pdfAtt) {
    return {
      receivedCount: 0, savedCount: 0, duplicateCount: 0, transactions: [],
      errors: ['No PDF attachment found on inbound email'],
    };
  }

  let parsed;
  try {
    parsed = await parseThndrPdf(Buffer.from(pdfAtt.Content, 'base64'));
  } catch (e) {
    return {
      receivedCount: 0, savedCount: 0, duplicateCount: 0, transactions: [],
      errors: [`PDF parse failed: ${(e as Error).message}`],
    };
  }
  return persistAndNotify(parsed, symbolMap);
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
