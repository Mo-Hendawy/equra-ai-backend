// Resolves a Thndr security identifier to the EGX ticker we use internally.
// Strategy:
//   1. If ISIN is present and known, use it (instant, free).
//   2. Else try fuzzy matching against EGX_COMPANY_SYMBOL_MAP keys (free, reliable for small typos).
//   3. Else ask Gemini to produce the most likely EGX ticker. Returns null if Gemini errors
//      or is unavailable so the caller can show the transaction as "unresolved".
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ResolutionSource } from './types.js';

// Sparse ISIN -> EGX ticker map. Start with the ones we know and grow over time.
// (ISIN is a 12-char international security identifier; EGX-listed securities begin with "EG".)
const ISIN_TO_TICKER: Record<string, string> = {
  EGS512O1C012: 'ISPH',     // Ibnsina Pharma
};

// Tokens we strip before fuzzy-matching a security name.
const NAME_NOISE = new Set([
  'co', 'company', 'corp', 'corporation', 'for', 'the', 'and', 'of',
  '-', '&', 's.a.e.', 'sae', 'egypt', 'egyptian', 'holding', 'holdings',
]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t && !NAME_NOISE.has(t));
}

/**
 * Token A matches token B if they are equal OR one is a substring of the other
 * (min length 3). This handles cases like "Ibn sina" ~ "Ibnsina" where a single
 * concatenated token in the known name corresponds to two tokens in the needle.
 */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return a.includes(b) || b.includes(a);
}

function tokenOverlap(needle: string[], candidate: string[]): number {
  if (needle.length === 0) return 0;
  let hits = 0;
  for (const t of needle) {
    if (candidate.some(c => tokenMatches(t, c))) hits++;
  }
  return hits / needle.length;
}

export interface SymbolMap {
  [companyName: string]: string; // ticker
}

export interface ResolveArgs {
  securityName: string;
  isin?: string;
  /** The backend's existing EGX_COMPANY_SYMBOL_MAP (name -> ticker). */
  knownMap: SymbolMap;
  /** Known EGX tickers so we can accept a plain-ticker response from Gemini. */
  knownTickers: string[];
}

export interface ResolveResult {
  ticker: string | null;
  source: ResolutionSource;
}

/** Try ISIN -> fuzzy name -> Gemini in order. */
export async function resolveSymbol(args: ResolveArgs): Promise<ResolveResult> {
  // 1. ISIN
  if (args.isin) {
    const hit = ISIN_TO_TICKER[args.isin];
    if (hit) return { ticker: hit, source: 'isin' };
  }

  // 2. Fuzzy name match against known map
  const needle = tokens(args.securityName);
  let best: { ticker: string; score: number } | null = null;
  for (const [name, ticker] of Object.entries(args.knownMap)) {
    const score = tokenOverlap(needle, tokens(name));
    if (score > (best?.score ?? 0)) best = { ticker, score };
  }
  if (best && best.score >= 0.5) {
    return { ticker: best.ticker, source: 'name-match' };
  }

  // 3. Gemini fallback
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ticker: null, source: null };
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You map Egyptian Exchange (EGX) security names to their EGX ticker symbols.
Known tickers: ${args.knownTickers.join(', ')}.
Security name from a Thndr invoice: "${args.securityName}"${args.isin ? `\nISIN: ${args.isin}` : ''}
Respond with ONLY the EGX ticker from the known list, or "UNKNOWN" if none fit. No explanation.`;
    const res = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
    });
    const out = res.response.text().trim().toUpperCase();
    const candidate = out.split(/\s+/)[0];
    if (candidate && candidate !== 'UNKNOWN' && args.knownTickers.includes(candidate)) {
      return { ticker: candidate, source: 'gemini' };
    }
    return { ticker: null, source: null };
  } catch (e) {
    console.warn('[thndr/symbol-resolver] Gemini fallback failed:', (e as Error).message);
    return { ticker: null, source: null };
  }
}
