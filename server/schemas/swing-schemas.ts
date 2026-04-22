import { z } from "zod";

// ─── Swing Trade Schemas ───
// Output shape for the swing-analyst agent. Swing = 2–8 week trade horizon,
// blended technical + fundamental, explicit entry/stop/target.

const verdictSchema = z.string().transform((s) => {
  const v = (s || "").toLowerCase().replace(/[\s_-]/g, "");
  if (v.includes("buynow") || v === "buy") return "BUY_NOW";
  if (v.includes("avoid") || v === "sell" || v === "no") return "AVOID";
  if (v.includes("wait") || v === "hold" || v === "watch") return "CAN_WAIT";
  return "CAN_WAIT";
});

const confidenceSchema = z.string().transform((s) => {
  const v = (s || "").toLowerCase();
  if (v.includes("high")) return "High";
  if (v.includes("low")) return "Low";
  return "Medium";
});

const rangeSchema = z.object({
  low: z.number(),
  high: z.number(),
});

const citationSchema = z.object({
  source: z.string(),             // filename or "price-history" or "news-sentiment"
  snippet: z.string().max(240),
});

export const swingRecommendationSchema = z.object({
  verdict: verdictSchema,
  confidence: confidenceSchema,
  entryRange: rangeSchema.nullable(),
  stopLoss: z.number().nullable(),
  targetPrice: z.number().nullable(),
  timeframeWeeks: z.number().int().min(1).max(24),
  technicalSignals: z.array(z.string().max(240)).max(6),
  fundamentalCatalysts: z.array(z.string().max(240)).max(6),
  risks: z.array(z.string().max(240)).max(6),
  citations: z.array(citationSchema).max(10).default([]),
  reasoning: z.string().max(1500),
});

export type SwingRecommendation = z.infer<typeof swingRecommendationSchema>;

// ─── Critic output for swing recommendations ───

const counterVerdictSchema = z.string().transform((s) => {
  const v = (s || "").toLowerCase().replace(/[\s_-]/g, "");
  if (v.includes("buynow") || v === "buy") return "BUY_NOW";
  if (v.includes("avoid") || v === "sell") return "AVOID";
  return "CAN_WAIT";
});

const severitySchema = z.string().transform((s) => {
  const v = (s || "").toLowerCase();
  if (v.includes("high")) return "high";
  if (v.includes("low")) return "low";
  return "medium";
});

export const swingCriticFeedbackSchema = z.object({
  counterVerdict: counterVerdictSchema,
  weakness: z.string().max(500),
  severity: severitySchema,
  counterScenario: z.string().max(500),
  blockingIssues: z.array(z.string().max(300)).max(5),
});

export type SwingCriticFeedback = z.infer<typeof swingCriticFeedbackSchema>;

// ─── Final decision after critic integration ───

export interface SwingDecision {
  symbol: string;
  finalVerdict: SwingRecommendation["verdict"];
  adjustedConfidence: SwingRecommendation["confidence"];
  recommendation: SwingRecommendation;
  criticFeedback: SwingCriticFeedback | null;
  priceAsOf: string;          // ISO timestamp
  provider: string;           // which AI model produced this
  decisionId: number | null;  // memory-service id for outcome tracking
}

// Confidence discount rules — mirror the existing stock-analysis critic pattern:
// If critic disagrees at high severity → drop confidence one step.
export function applySwingConfidenceDiscount(
  rec: SwingRecommendation,
  critic: SwingCriticFeedback | null
): SwingRecommendation["confidence"] {
  if (!critic) return rec.confidence;
  const disagrees = critic.counterVerdict !== rec.verdict;
  if (!disagrees) return rec.confidence;
  if (critic.severity === "high") {
    if (rec.confidence === "High") return "Medium";
    if (rec.confidence === "Medium") return "Low";
    return "Low";
  }
  if (critic.severity === "medium") {
    if (rec.confidence === "High") return "Medium";
    return rec.confidence;
  }
  return rec.confidence;
}
