// Extract Thndr invoice transactions from an image (screenshot) via Gemini Vision.
// The caller passes a base64 image + mime type; we return the same shape
// parseThndrPdf produces so downstream code (resolver + service) is unchanged.
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ParsedThndrTransaction } from './types.js';

const EXTRACTION_PROMPT = `You extract structured data from Thndr (Egyptian brokerage) trade invoices.
Return ONLY valid JSON with this exact shape (no markdown, no explanation):

{
  "invoiceDate": "DD/MM/YYYY",
  "transactions": [
    {
      "transactionNo": "string (Transaction No. from the invoice — may be like N000238603014 or a UUID)",
      "securityName": "string (Security Name, e.g. 'Ibn sina farma')",
      "isin": "string or null (Symbol Code — 12-char ISIN like EGS512O1C012, or null if code is lowercase like 'thndrsavings')",
      "transactionType": "buy" | "sell",
      "quantity": number,
      "price": number,
      "value": number,
      "fees": number,
      "grandTotal": number
    }
  ]
}

Rules:
- One invoice may contain multiple transactions — include them all.
- Numbers are numeric (no commas, no EGP suffix). E.g. 103,800.00 EGP → 103800.
- transactionType lowercase.
- If a field is unreadable, use null for strings or 0 for numbers.
- Do NOT invent data. If you cannot read a field, return null/0.`;

export async function extractFromImage(
  base64Image: string,
  mimeType: string
): Promise<ParsedThndrTransaction[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured — required for image-upload path');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent({
    contents: [
      {
        role: 'user',
        parts: [
          { text: EXTRACTION_PROMPT },
          { inlineData: { mimeType, data: base64Image } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
    },
  });

  const text = result.response.text().trim();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }

  const invoiceDate = String(parsed.invoiceDate ?? '');
  const rows = Array.isArray(parsed.transactions) ? parsed.transactions : [];

  return rows
    .map((r: any): ParsedThndrTransaction | null => {
      if (!r || typeof r !== 'object') return null;
      if (!r.transactionNo || !r.securityName) return null;
      const type = String(r.transactionType ?? '').toLowerCase();
      if (type !== 'buy' && type !== 'sell') return null;
      return {
        invoiceDate,
        transactionNo: String(r.transactionNo),
        securityName: String(r.securityName),
        isin: r.isin ? String(r.isin) : undefined,
        transactionType: type,
        quantity: Number(r.quantity) || 0,
        price: Number(r.price) || 0,
        value: Number(r.value) || 0,
        fees: Number(r.fees) || 0,
        grandTotal: Number(r.grandTotal) || 0,
      };
    })
    .filter((x: ParsedThndrTransaction | null): x is ParsedThndrTransaction => x !== null);
}
