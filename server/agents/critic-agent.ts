import OpenAI from "openai";
import { criticFeedbackSchema, type CriticFeedback } from "../schemas/analysis-schemas.js";
import type { GeminiAnalysis, StockDataForAI } from "../gemini-service.js";

const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const CRITIC_TIMEOUT_MS = 10_000;  // CRIT-05: fail-open if exceeded

// Forced counter-position mapping (CRIT-03)
function getCounterPosition(recommendation: GeminiAnalysis["recommendation"]): string {
  switch (recommendation) {
    case "Strong Buy":
    case "Buy":
      return "SELL (or Strong Sell)";
    case "Strong Sell":
    case "Sell":
      return "BUY (or Strong Buy)";
    case "Hold":
      return "either STRONG BUY or STRONG SELL — pick whichever is the stronger case";
  }
}

function buildCriticPrompt(analysis: GeminiAnalysis, stockData: StockDataForAI): string {
  const counterPosition = getCounterPosition(analysis.recommendation);

  return `You are an adversarial financial analyst reviewing a stock recommendation for ${stockData.symbol} on the Egyptian Exchange (EGX).

DRAFT RECOMMENDATION TO ATTACK:
- Recommendation: ${analysis.recommendation}
- Confidence: ${analysis.confidence}
- Valuation: ${analysis.valuationStatus}
- Fair Value Estimate: ${analysis.fairValueEstimate ?? "N/A"} EGP
- Current Price: ${stockData.currentPrice} EGP
- Reasoning: ${analysis.reasoning.slice(0, 800)}
- Key Points: ${(analysis.keyPoints || []).slice(0, 3).join("; ")}

YOUR TASK — MANDATORY COUNTER-POSITION:
You MUST argue ${counterPosition} FIRST, before any other consideration.
Do NOT validate the draft recommendation. Your job is to find the strongest possible reason it is WRONG.

Find:
1. The single biggest weakness in the analysis (what did it miss or overweight?)
2. A concrete counter-scenario (what specific market/macro/company event makes ${counterPosition} the right call?)
3. Blocking issues — specific data points, risks, or conditions that should BLOCK shipping this recommendation as-is

EGX-specific risks to consider: FRA disclosure lag (stale earnings), CBE rate sensitivity for banks, thin liquidity traps, EGP/USD pressure, regulatory halts, political/macro shocks.

RESPOND WITH VALID JSON ONLY (no markdown, no explanation outside JSON):
{
  "counterRecommendation": "${counterPosition.includes("SELL") ? "Sell" : counterPosition.includes("BUY") ? "Buy" : "Strong Sell"}",
  "weakness": "<single biggest flaw in the analysis, specific and concrete>",
  "severity": "low" | "medium" | "high",
  "counterScenario": "<specific scenario that makes the counter-recommendation correct, with numbers if possible>",
  "blockingIssues": [
    "<specific issue 1 that should block this recommendation>",
    "<specific issue 2>"
  ]
}

severity guide:
- high: a fundamental error or a blocking risk that invalidates the recommendation
- medium: a meaningful concern that should temper confidence
- low: a minor caveat that does not change the overall direction

IMPORTANT: blockingIssues must have at least 1 item. An empty array means you found nothing — that is not acceptable.`;
}

export class CriticAgent {
  private getGroqClient(): OpenAI | null {
    const key = process.env.GROQ_API_KEY;
    return key
      ? new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" })
      : null;
  }

  async critique(
    analysis: GeminiAnalysis,
    stockData: StockDataForAI
  ): Promise<CriticFeedback | null> {
    const client = this.getGroqClient();
    if (!client) {
      console.warn("CriticAgent: GROQ_API_KEY not configured — skipping critique (CRIT-05 fail-open)");
      return null;
    }

    const prompt = buildCriticPrompt(analysis, stockData);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CRITIC_TIMEOUT_MS);

    try {
      const response = await client.chat.completions.create(
        {
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content: "You are an adversarial financial analyst. You argue the OPPOSITE position to any recommendation you receive. Respond only with valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.7,      // CRIT-02: divergent from Gemini's 0.2
          max_tokens: 1024,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      const raw = response.choices[0]?.message?.content ?? "";
      const cleaned = cleanJson(raw);
      const parsed = JSON.parse(cleaned);
      const validated = criticFeedbackSchema.safeParse(parsed);

      if (!validated.success) {
        console.warn("CriticAgent: Zod validation failed — skipping critique", validated.error.errors);
        return null;
      }

      console.log(`CriticAgent: critique complete — severity=${validated.data.severity}, counter=${validated.data.counterRecommendation}`);
      return validated.data;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === "AbortError" || err?.message?.includes("abort")) {
        console.warn("CriticAgent: Groq timeout after 10s — shipping without critique (CRIT-05 fail-open)");
      } else {
        console.warn("CriticAgent: Groq call failed — shipping without critique (CRIT-05 fail-open)", err?.message);
      }
      return null;
    }
  }
}

function cleanJson(text: string): string {
  let s = text.trim().replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = s.indexOf("{");
  if (start > 0) s = s.substring(start);
  const end = s.lastIndexOf("}");
  if (end > 0 && end < s.length - 1) s = s.substring(0, end + 1);
  return s;
}

export const criticAgent = new CriticAgent();
