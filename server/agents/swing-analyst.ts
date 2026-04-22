// Swing-trade analyst agent.
// Pulls: 90-day price history, basic technicals (SMA, momentum, range position,
// realized volatility), news sentiment, RAG chunks, then asks an LLM for a
// structured swing recommendation (entry/stop/target/verdict) scoped to a
// 2–8 week horizon.
import { GoogleGenerativeAI } from "@google/generative-ai";
import { swingRecommendationSchema, type SwingRecommendation } from "../schemas/swing-schemas.js";
import { getRelevantContext } from "../rag-service.js";

const EODHD_API_TOKEN = process.env.EODHD_API_TOKEN || "";
const EODHD_BASE_URL = "https://eodhd.com/api";

// ─── Technical indicators (simple, self-contained) ───

export interface PriceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface Technicals {
  currentPrice: number;
  asOf: string;
  sma20: number | null;
  sma50: number | null;
  distanceFromSma50Pct: number | null;
  momentum20dPct: number | null;
  realizedVol20dPct: number | null;
  range52w: { high: number; low: number } | null;
  rangePositionPct: number | null;   // 0=at 52w low, 100=at 52w high
  avgVolume20d: number | null;
  recentVolumeMultiple: number | null; // last close volume ÷ 20d avg
}

export function computeTechnicals(bars: PriceBar[]): Technicals | null {
  if (bars.length === 0) return null;
  // EODHD returns oldest-first if period=d without explicit order; routes.ts
  // fetches with order=d (desc). We handle both by sorting ascending here.
  const asc = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const last = asc[asc.length - 1];

  const closes = asc.map((b) => b.close);
  const lastClose = last.close;

  const sma = (n: number): number | null => {
    if (closes.length < n) return null;
    const slice = closes.slice(-n);
    return slice.reduce((s, v) => s + v, 0) / n;
  };

  const sma20 = sma(20);
  const sma50 = sma(50);

  const momentum20dPct =
    closes.length >= 21
      ? ((lastClose - closes[closes.length - 21]) / closes[closes.length - 21]) * 100
      : null;

  // Realized volatility over last 20 daily returns (std dev, annualized ×√252)
  let realizedVol20dPct: number | null = null;
  if (closes.length >= 21) {
    const rets: number[] = [];
    for (let i = closes.length - 20; i < closes.length; i++) {
      rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const mean = rets.reduce((s, v) => s + v, 0) / rets.length;
    const variance = rets.reduce((s, v) => s + (v - mean) ** 2, 0) / rets.length;
    realizedVol20dPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
  }

  // 52-week (≈252 bars) range
  const last252 = closes.slice(-252);
  const range52w = last252.length > 0
    ? { high: Math.max(...last252), low: Math.min(...last252) }
    : null;
  const rangePositionPct = range52w && range52w.high !== range52w.low
    ? ((lastClose - range52w.low) / (range52w.high - range52w.low)) * 100
    : null;

  const volumes = asc.map((b) => b.volume ?? 0).filter((v) => v > 0);
  const last20Vols = volumes.slice(-20);
  const avgVolume20d =
    last20Vols.length >= 10
      ? last20Vols.reduce((s, v) => s + v, 0) / last20Vols.length
      : null;
  const recentVolumeMultiple =
    avgVolume20d && last.volume ? last.volume / avgVolume20d : null;

  return {
    currentPrice: lastClose,
    asOf: last.date,
    sma20,
    sma50,
    distanceFromSma50Pct: sma50 ? ((lastClose - sma50) / sma50) * 100 : null,
    momentum20dPct,
    realizedVol20dPct,
    range52w,
    rangePositionPct,
    avgVolume20d,
    recentVolumeMultiple,
  };
}

// ─── Price history fetch ───

export async function fetchPriceHistory(symbol: string, days = 300): Promise<PriceBar[]> {
  if (!EODHD_API_TOKEN) {
    throw new Error("EODHD_API_TOKEN not configured");
  }
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromStr = from.toISOString().slice(0, 10);
  const url = `${EODHD_BASE_URL}/eod/${symbol}.EGX?api_token=${EODHD_API_TOKEN}&from=${fromStr}&fmt=json&period=d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    throw new Error(`EODHD history failed ${res.status}`);
  }
  const raw = (await res.json()) as any[];
  return raw
    .map((r) => ({
      date: r.date,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.adjusted_close ?? r.close),
      volume: r.volume != null ? Number(r.volume) : null,
    }))
    .filter((b) => isFinite(b.close) && b.close > 0);
}

// ─── Prompt construction ───

function buildSwingPrompt(args: {
  symbol: string;
  tech: Technicals;
  ragContext: string;
  newsSentimentSummary: string | null;
  strategyPrompt: string | null;
}): string {
  const { symbol, tech, ragContext, newsSentimentSummary, strategyPrompt } = args;

  const fmt = (n: number | null, d = 2) =>
    n === null ? "N/A" : n.toFixed(d);

  return `You are a disciplined swing-trade analyst for the Egyptian Exchange (EGX). Horizon: 2–8 weeks.

SYMBOL: ${symbol}

TECHNICALS (as of ${tech.asOf}):
- Current price: EGP ${fmt(tech.currentPrice)}
- 20-day SMA: ${fmt(tech.sma20)}   50-day SMA: ${fmt(tech.sma50)}
- Distance from 50d SMA: ${fmt(tech.distanceFromSma50Pct)}%
- 20-day momentum: ${fmt(tech.momentum20dPct)}%
- 20-day realized vol (annualized): ${fmt(tech.realizedVol20dPct)}%
- 52-week range: ${tech.range52w ? `${fmt(tech.range52w.low)} – ${fmt(tech.range52w.high)}` : "N/A"}
- Range position: ${fmt(tech.rangePositionPct, 1)}% (0=52w low, 100=52w high)
- Recent volume vs 20d avg: ${fmt(tech.recentVolumeMultiple, 2)}×

NEWS SENTIMENT:
${newsSentimentSummary ?? "No recent news sentiment data available."}

${ragContext}

${strategyPrompt ? `CURRENT STRATEGY (from meta-agent learning loop):\n${strategyPrompt}\n` : ""}

YOUR TASK:
Produce a single swing-trade recommendation for a 2–8 week horizon. Ground every
claim in the technicals above, the news sentiment, or specific excerpts from the
financial reports. DO NOT invent numbers.

VERDICT — choose exactly one:
- BUY_NOW: enter within 1–3 trading days
- CAN_WAIT: attractive setup, but wait for a specific trigger (name it)
- AVOID: skip; setup is weak, deteriorating, or too volatile for the horizon

If BUY_NOW or CAN_WAIT, you MUST produce:
- entryRange { low, high } — price band to enter (reason-backed, not arbitrary)
- stopLoss — invalidation price. Sized to realized vol (typically 1.5×–2× 20d vol or below a clear support)
- targetPrice — first profit target. Reward/risk must be ≥ 1.5 (target-entry ≥ 1.5 × (entry-stop))
- timeframeWeeks — integer 2–8

For AVOID, set entryRange/stopLoss/targetPrice to null and timeframeWeeks to 2.

Cite sources when possible in the "citations" array: source = filename from the
RAG excerpts, or "price-history", or "news-sentiment".

LENGTH LIMITS — OBEY EXACTLY (token budget is tight):
- technicalSignals: maximum 4 items, each ≤ 140 characters
- fundamentalCatalysts: maximum 4 items, each ≤ 140 characters
- risks: maximum 3 items, each ≤ 140 characters
- citations: maximum 4 items, snippet ≤ 180 characters
- reasoning: 200–400 characters, single paragraph
- No nested lists, no markdown, no prose outside JSON.

RESPOND WITH VALID JSON ONLY:
{
  "verdict": "BUY_NOW" | "CAN_WAIT" | "AVOID",
  "confidence": "High" | "Medium" | "Low",
  "entryRange": { "low": <number>, "high": <number> } | null,
  "stopLoss": <number> | null,
  "targetPrice": <number> | null,
  "timeframeWeeks": <integer 2-8>,
  "technicalSignals": [ "<concise signal>", ... up to 4 ],
  "fundamentalCatalysts": [ "<concise catalyst>", ... up to 4 ],
  "risks": [ "<concise risk>", ... up to 3 ],
  "citations": [ { "source": "<filename or tag>", "snippet": "<≤180 chars>" }, ... up to 4 ],
  "reasoning": "<200-400 char synthesis>"
}`.trim();
}

// ─── Main entrypoint ───

const ANALYST_MODEL = "gemini-2.5-flash";

export async function runSwingAnalyst(args: {
  symbol: string;
  newsSentimentSummary?: string | null;
  strategyPrompt?: string | null;
  signal?: AbortSignal;
}): Promise<{
  recommendation: SwingRecommendation;
  technicals: Technicals;
  ragUsed: boolean;
  model: string;
} | null> {
  const { symbol, newsSentimentSummary = null, strategyPrompt = null, signal } = args;

  // 1. Price history + technicals
  const bars = await fetchPriceHistory(symbol, 300);
  const tech = computeTechnicals(bars);
  if (!tech) {
    console.warn(`[swing-analyst] ${symbol} — no price bars`);
    return null;
  }
  if (signal?.aborted) return null;

  // 2. RAG context scoped to swing trading (momentum + catalysts + risks)
  const ragQuery = `${symbol} recent results momentum catalysts risks guidance`;
  const chunks = await getRelevantContext(symbol, ragQuery, 6).catch((e) => {
    console.warn(`[swing-analyst] ${symbol} — RAG lookup failed:`, e);
    return [];
  });
  const ragContext =
    chunks.length > 0
      ? `\n\nRELEVANT EXCERPTS FROM ${symbol} FINANCIAL REPORTS:\n${chunks
          .map((c, i) => `--- Excerpt ${i + 1} ---\n${c}`)
          .join("\n\n")}`
      : "";

  if (signal?.aborted) return null;

  // 3. Call the analyst LLM
  const prompt = buildSwingPrompt({
    symbol,
    tech,
    ragContext,
    newsSentimentSummary,
    strategyPrompt,
  });

  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: ANALYST_MODEL,
    generationConfig: { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: "application/json" },
  });

  let rawText = "";
  try {
    const result = await model.generateContent(prompt);
    rawText = result.response.text().trim();
  } catch (e) {
    console.error(`[swing-analyst] ${symbol} — Gemini call failed:`, e);
    return null;
  }

  // Strip any accidental markdown fences
  rawText = rawText.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    console.error(`[swing-analyst] ${symbol} — JSON parse failed. Raw:\n${rawText.slice(0, 500)}`);
    return null;
  }

  const validation = swingRecommendationSchema.safeParse(parsed);
  if (!validation.success) {
    console.error(`[swing-analyst] ${symbol} — schema validation failed:`, validation.error.flatten());
    return null;
  }

  return {
    recommendation: validation.data,
    technicals: tech,
    ragUsed: chunks.length > 0,
    model: ANALYST_MODEL,
  };
}
