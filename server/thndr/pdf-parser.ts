// Parse a Thndr invoice PDF into structured transactions.
// Layout is standardized (the invoice footer explicitly says so).
// One PDF can contain multiple transactions (one per security).
import { PDFParse } from 'pdf-parse';
import type { ParsedThndrTransaction, TransactionType } from './types.js';

// The invoice text (after pdf-parse) is line-oriented. We split on the
// "Total Fees" row which terminates each transaction block.
//
// A single transaction block looks roughly like:
//
//   Ibn sina farma EGS512O1C012 Buy 10.39 EGP
//   Transaction No. Quantity Price Value
//   N000238603014 10,000 10.38 EGP 103,800.00 EGP
//   Total Quantity Average Price Total Cost
//   10,000 10.38 EGP 103,800.00 EGP
//   Fees ... Amount ... Total Fees 136.94 EGP Grand Total 103,936.94 EGP
//
// We extract via a combination of line-based scans and regex hunts so the
// parser tolerates small layout drift across invoices.

function parseNum(raw: string): number {
  return Number(raw.replace(/[,\s]/g, ''));
}

function extractDate(text: string): string {
  const m = text.match(/(\d{2}\/\d{2}\/\d{4})/);
  return m ? m[1] : '';
}

/** Split a full-document text into per-transaction blocks. */
function splitTransactionBlocks(text: string): string[] {
  // "Grand Total" is printed once per transaction at the end of each block.
  // We split after each Grand Total line to get one block per txn.
  const parts: string[] = [];
  const re = /([\s\S]*?Grand Total\s+[\d.,]+\s*EGP)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) parts.push(m[1]);
  return parts;
}

function parseBlock(block: string, invoiceDate: string): ParsedThndrTransaction | null {
  // Transaction No. — starts with N followed by digits OR a UUID
  const txnNoMatch = block.match(/(N\d{10,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!txnNoMatch) return null;
  const transactionNo = txnNoMatch[1];

  // Security header line: "<Name> <SymbolCode> <Buy|Sell|buy|sell> <avgCost> EGP"
  // Name may contain spaces. SymbolCode is uppercase+digits OR lowercase (e.g. "thndrsavings")
  const headerRe = /^(.+?)\s+([A-Z]{2,}[A-Z0-9]{5,}|[a-z]{3,})\s+(Buy|Sell|buy|sell)\s+([\d.]+)\s+EGP/m;
  const headerMatch = block.match(headerRe);
  if (!headerMatch) return null;
  const [, securityNameRaw, symbolCode, typeRaw] = headerMatch;
  const securityName = securityNameRaw.trim();
  const isin = /^[A-Z]{2,}[A-Z0-9]{5,}$/.test(symbolCode) ? symbolCode : undefined;
  const transactionType = typeRaw.toLowerCase() as TransactionType;

  // Quantity / Price / Value line — right after "Transaction No.":
  // "<txnNo> <qty> <price> EGP <value> EGP"
  // Quantity can have commas (10,000). Prices are decimal.
  const afterTxnNo = block.substring(block.indexOf(transactionNo) + transactionNo.length);
  const qtyPriceValRe = /([\d,]+)\s+([\d.]+)\s+EGP\s+([\d,.]+)\s+EGP/;
  const qpvMatch = afterTxnNo.match(qtyPriceValRe);
  if (!qpvMatch) return null;
  const quantity = parseNum(qpvMatch[1]);
  const price = parseNum(qpvMatch[2]);
  const value = parseNum(qpvMatch[3]);

  // Fees + Grand Total
  const feesMatch = block.match(/Total Fees\s+([\d,.]+)\s+EGP/);
  const grandMatch = block.match(/Grand Total\s+([\d,.]+)\s+EGP/);
  const fees = feesMatch ? parseNum(feesMatch[1]) : 0;
  const grandTotal = grandMatch ? parseNum(grandMatch[1]) : value + fees;

  return {
    invoiceDate,
    transactionNo,
    securityName,
    isin,
    transactionType,
    quantity,
    price,
    value,
    fees,
    grandTotal,
  };
}

/** Parse a Thndr invoice PDF (Buffer) into one or more transactions. */
export async function parseThndrPdf(pdfBuffer: Buffer): Promise<ParsedThndrTransaction[]> {
  const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) });
  const result = await parser.getText();
  await parser.destroy();
  const text = result.text ?? '';
  const invoiceDate = extractDate(text);
  const blocks = splitTransactionBlocks(text);
  const out: ParsedThndrTransaction[] = [];
  for (const block of blocks) {
    const parsed = parseBlock(block, invoiceDate);
    if (parsed) out.push(parsed);
  }
  return out;
}
