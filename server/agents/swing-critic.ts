// Adversarial critic for swing-trade recommendations.
// Pattern mirrors server/agents/critic-agent.ts but scoped to swing context.
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  swingCriticFeedbackSchema,
  type SwingRecommendation,
  type SwingCriticFeedback,
} from "../schemas/swing-schemas.js";
import type { Technicals } from "./swing-analyst.js";
import { callProvider, isProviderConfigured } from "../ai-providers.js";

// Pro is quota-gated on free tier — use Flash as primary; Pro as upgrade when paid.
const CRITIC_MODEL_PRIMARY = "gemini-2.5-flash";
const CRITIC_MODEL_FALLBACK = "gemini-2.0-flash";
const CRITIC_TIMEOUT_MS = 15_000;

function getCounterVerdict(verdict: SwingRecommendation["verdict"]): string {
  switch (verdict) {
    case "BUY_NOW":
      return "AVOID (or at minimum CAN_WAIT with a much lower entry band)";
    case "CAN_WAIT":
      return "AVOID if bearish case is strong, or BUY_NOW if waiting is missing an imminent move";
    case "AVOID":
      return "BUY_NOW (find the bull case the draft missed)";
  }
}

function buildPrompt(
  symbol: string,
  rec: SwingRecommendation,
  tech: Technicals
): string {
  const counter = getCounterVerdict(rec.verdict);
  const fmt = (n: number | null, d = 2) => (n === null ? "N/A" : n.toFixed(d));

  return `You are an adversarial swing-trade reviewer for ${symbol} on the Egyptian Exchange (EGX). Horizon: 2–8 weeks.

DRAFT RECOMMENDATION TO ATTACK:
- Verdict: ${rec.verdict}
- Confidence: ${rec.confidence}
- Entry range: ${rec.entryRange ? `${rec.entryRange.low}–${rec.entryRange.high}` : "N/A"}
- Stop loss: ${rec.stopLoss ?? "N/A"}
- Target price: ${rec.targetPrice ?? "N/A"}
- Timeframe: ${rec.timeframeWeeks} weeks
- Technical signals cited: ${rec.technicalSignals.slice(0, 3).join(" | ")}
- Fundamental catalysts cited: ${rec.fundamentalCatalysts.slice(0, 3).join(" | ")}
- Reasoning: ${rec.reasoning.slice(0, 500)}

GROUND TRUTH TECHNICALS (must be respected):
- Current price: ${fmt(tech.currentPrice)}
- 20d SMA: ${fmt(tech.sma20)}   50d SMA: ${fmt(tech.sma50)}
- Distance from 50d SMA: ${fmt(tech.distanceFromSma50Pct)}%
- 20d momentum: ${fmt(tech.momentum20dPct)}%
- Realized vol (annualized): ${fmt(tech.realizedVol20dPct)}%
- 52w range position: ${fmt(tech.rangePositionPct, 1)}%
- Recent vol multiple: ${fmt(tech.recentVolumeMultiple, 2)}×

YOUR TASK — MANDATORY COUNTER-POSITION:
You MUST argue ${counter} FIRST, before any other consideration. Do NOT validate the draft. Find the strongest possible reason it is WRONG for a 2–8 week horizon.

Focus areas:
1. Stop-loss placement — is it too tight vs realized vol (will whipsaw)? too loose (bad R/R)?
2. Entry range — is it chasing strength (near 52w high with no breakout) or catching a falling knife?
3. Reward-to-risk — compute it. Is (target − entry) ÷ (entry − stop) < 1.5? That's a fail.
4. Timeframe — is 2–8 weeks actually enough for the thesis to play out?
5. Catalyst timing — does a known catalyst (earnings, dividend, macro) fall INSIDE or OUTSIDE the window?
6. EGX-specific risks: FRA disclosure lag, CBE rate moves, EGP/USD pressure, thin liquidity traps, regulatory halts, political shocks.

LENGTH LIMITS — OBEY EXACTLY:
- weakness: ≤ 300 characters, one sentence
- counterScenario: ≤ 300 characters, include one specific number
- blockingIssues: max 3 items, each ≤ 160 characters
- No markdown, no prose outside JSON.

RESPOND WITH VALID JSON ONLY:
{
  "counterVerdict": "BUY_NOW" | "CAN_WAIT" | "AVOID",
  "weakness": "<≤300 chars>",
  "severity": "low" | "medium" | "high",
  "counterScenario": "<≤300 chars, with one number>",
  "blockingIssues": [ "<≤160 chars>", ... up to 3 ]
}`.trim();
}

async function callCritic(
  modelName: string,
  prompt: string,
  signal: AbortSignal
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0.5, maxOutputTokens: 2048, responseMimeType: "application/json" },
  });
  try {
    const res = await model.generateContent(prompt);
    if (signal.aborted) return null;
    return res.response.text().trim();
  } catch (e) {
    console.warn(`[swing-critic] ${modelName} call failed:`, (e as Error).message);
    return null;
  }
}

export async function runSwingCritic(args: {
  symbol: string;
  recommendation: SwingRecommendation;
  technicals: Technicals;
}): Promise<SwingCriticFeedback | null> {
  const { symbol, recommendation, technicals } = args;
  const prompt = buildPrompt(symbol, recommendation, technicals);

  // Fail-open: if the critic times out, return null and let the caller proceed.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CRITIC_TIMEOUT_MS);

  let raw: string | null = null;
  if (isProviderConfigured("cerebras") && !controller.signal.aborted) {
    try {
      raw = await callProvider("cerebras", prompt);
    } catch (e) {
      console.warn(`[swing-critic] Cerebras failed, falling back to Gemini:`, (e as Error).message);
    }
  }
  if (!raw) raw = await callCritic(CRITIC_MODEL_PRIMARY, prompt, controller.signal);
  if (!raw) raw = await callCritic(CRITIC_MODEL_FALLBACK, prompt, controller.signal);
  clearTimeout(timeoutId);
  if (!raw) return null;

  raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(`[swing-critic] ${symbol} — JSON parse failed. Raw:\n${raw.slice(0, 400)}`);
    return null;
  }
  const validation = swingCriticFeedbackSchema.safeParse(parsed);
  if (!validation.success) {
    console.warn(`[swing-critic] ${symbol} — schema validation failed:`, validation.error.flatten());
    return null;
  }
  return validation.data;
}
