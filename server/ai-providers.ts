import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ─── Provider Config (lazy - reads env vars fresh each time) ───

function getGeminiClient() {
  const key = process.env.GEMINI_API_KEY || "";
  return key ? new GoogleGenerativeAI(key) : null;
}

function getOpenRouterClient() {
  const key = process.env.OPENROUTER_API_KEY || "";
  return key
    ? new OpenAI({
        apiKey: key,
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": "https://equra.ai",
          "X-Title": "Equra AI",
        },
      })
    : null;
}

function getGroqClient() {
  const key = process.env.GROQ_API_KEY || "";
  return key ? new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" }) : null;
}

function getCerebrasClient() {
  const key = process.env.CEREBRAS_API_KEY || "";
  return key ? new OpenAI({ apiKey: key, baseURL: "https://api.cerebras.ai/v1" }) : null;
}

export function isProviderConfigured(provider: ProviderName): boolean {
  return isProviderAvailable(provider);
}

function isProviderAvailable(provider: ProviderName): boolean {
  switch (provider) {
    case "gemini": return !!(process.env.GEMINI_API_KEY);
    case "deepseek": return !!(process.env.OPENROUTER_API_KEY);
    case "kimi": return !!(process.env.OPENROUTER_API_KEY);
    case "groq": return !!(process.env.GROQ_API_KEY);
    case "cerebras": return !!(process.env.CEREBRAS_API_KEY);
    default: return false;
  }
}

console.log(`AI Providers at startup: Gemini=${!!process.env.GEMINI_API_KEY}, OpenRouter=${!!process.env.OPENROUTER_API_KEY}, Groq=${!!process.env.GROQ_API_KEY}, Cerebras=${!!process.env.CEREBRAS_API_KEY}`);

export type ProviderName = "gemini" | "deepseek" | "kimi" | "groq" | "cerebras";

interface ProviderConfig {
  name: string;
  model: string;
  available: boolean;
}

export const PROVIDERS: Record<ProviderName, Omit<ProviderConfig, "available"> & { name: string; model: string }> = {
  gemini: { name: "Gemini 2.5 Flash", model: "gemini-2.5-flash" },
  deepseek: { name: "DeepSeek V3 (OpenRouter)", model: "deepseek/deepseek-chat-v3-0324:free" },
  kimi: { name: "Kimi K2 (OpenRouter)", model: "moonshotai/kimi-k2:free" },
  groq: { name: "Llama 4 Scout (Groq)", model: "meta-llama/llama-4-scout-17b-16e-instruct" },
  cerebras: { name: "Llama 3.3 70B (Cerebras)", model: "llama-3.3-70b-versatile" },
};

// ─── Helper: clean JSON from LLM response ───

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  // Remove thinking tags if present (DeepSeek sometimes adds these)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.substring(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.substring(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.substring(0, cleaned.length - 3);
  return cleaned.trim();
}

// ─── Core: call a specific provider ───

async function callGemini(prompt: string): Promise<string> {
  const client = getGeminiClient();
  if (!client) throw new Error("Gemini API key not configured");
  const model = client.getGenerativeModel({
    model: PROVIDERS.gemini.model,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function callOpenAICompatible(
  client: OpenAI,
  model: string,
  prompt: string
): Promise<string> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: "You are an expert financial advisor specializing in the Egyptian Exchange (EGX). Always respond with valid JSON only, no markdown." },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    max_tokens: 4096,
  });
  return response.choices[0]?.message?.content || "";
}

// ─── Retry wrapper ───

async function callWithRetry(fn: () => Promise<string>, maxRetries = 3): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const status = error?.status || error?.statusCode;
      const isRetryable = (status === 429 || status === 503) && status !== 402;
      console.warn(`Attempt ${attempt + 1}/${maxRetries} failed: ${status || error.message}`);
      if (isRetryable && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt + 1) * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
  throw new Error("All retries exhausted");
}

// ─── Public API: call a provider by name ───

export async function callProvider(provider: ProviderName, prompt: string): Promise<string> {
  switch (provider) {
    case "gemini":
      return callWithRetry(() => callGemini(prompt));
    case "deepseek": {
      const client = getOpenRouterClient();
      if (!client) throw new Error("OpenRouter API key not configured");
      return callWithRetry(() => callOpenAICompatible(client, PROVIDERS.deepseek.model, prompt));
    }
    case "kimi": {
      const client = getOpenRouterClient();
      if (!client) throw new Error("OpenRouter API key not configured");
      return callWithRetry(() => callOpenAICompatible(client, PROVIDERS.kimi.model, prompt));
    }
    case "groq": {
      const client = getGroqClient();
      if (!client) throw new Error("Groq API key not configured");
      return callWithRetry(() => callOpenAICompatible(client, PROVIDERS.groq.model, prompt));
    }
    case "cerebras": {
      const client = getCerebrasClient();
      if (!client) throw new Error("Cerebras API key not configured");
      return callWithRetry(() => callOpenAICompatible(client, PROVIDERS.cerebras.model, prompt));
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ─── Prompts (shared across all providers) ───

export function buildPortfolioAnalysisPrompt(data: any): string {
  return `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). Analyze this investment portfolio.

PORTFOLIO DATA:
${JSON.stringify(data, null, 2)}

Provide a comprehensive portfolio analysis covering:
1. Overall health assessment
2. Strengths of this portfolio
3. Weaknesses and risks
4. Diversification quality (sector concentration, single stock risk)
5. Specific actionable recommendations
6. Top performers and underperformers

RESPONSE FORMAT (JSON):
{
  "overallHealth": "Strong" | "Good" | "Fair" | "Weak",
  "summary": "<2-3 sentence portfolio summary>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>", "<weakness 3>"],
  "recommendations": ["<specific actionable recommendation 1>", "<recommendation 2>", "<recommendation 3>"],
  "diversificationScore": "Well Diversified" | "Moderately Diversified" | "Concentrated",
  "riskLevel": "Low" | "Medium" | "High",
  "sectorBreakdown": "<brief sector concentration analysis>",
  "topPerformers": ["<stock symbol and why>", "<stock symbol and why>"],
  "underperformers": ["<stock symbol and why>", "<stock symbol and why>"]
}

Be specific with numbers. Reference actual stocks and values from the portfolio.
Respond ONLY with valid JSON, no markdown.`;
}

export function buildDeployCapitalPrompt(data: any, marketPrices?: Record<string, number>): string {
  const marketPricesSection = marketPrices && Object.keys(marketPrices).length > 0
    ? `\n\nCURRENT REAL-TIME EGX MARKET PRICES (as of today, use ONLY these prices - do NOT use prices from your training data):\n${Object.entries(marketPrices).map(([sym, price]) => `${sym}: ${price.toFixed(2)} EGP`).join("\n")}\n`
    : "";

  return `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). A client wants to deploy ${data.amountToDeployEGP} EGP into their portfolio.

CURRENT PORTFOLIO:
${JSON.stringify(data.portfolio, null, 2)}
${marketPricesSection}
AMOUNT TO DEPLOY: ${data.amountToDeployEGP} EGP

Recommend how to allocate this capital. Options:
- Increase existing positions (stocks already in portfolio)
- Add new EGX stocks not currently in portfolio
- Mix of both

Consider:
- Current portfolio balance and diversification
- Which positions are underweight
- Which sectors need more exposure
- Valuation opportunities in current market
- Risk management

CRITICAL: You MUST use the CURRENT REAL-TIME MARKET PRICES provided above for all price references and buy zone calculations. Do NOT rely on your training data for stock prices as they are severely outdated.

RESPONSE FORMAT (JSON):
{
  "strategy": "<brief 1-2 sentence strategy summary>",
  "allocations": [
    {
      "symbol": "<EGX stock symbol>",
      "nameEn": "<company name>",
      "amountEGP": <number>,
      "percentage": <number 0-100>,
      "reason": "<why this stock and this amount>",
      "isNewPosition": <true if not in current portfolio, false if increasing existing>,
      "buyZone": { "low": <ideal entry price low end based on current real-time price>, "high": <ideal entry price high end based on current real-time price> }
    }
  ],
  "reasoning": "<detailed paragraph explaining the overall allocation strategy>",
  "riskNote": "<brief risk disclaimer or caution>"
}

IMPORTANT:
- Allocations must sum to ${data.amountToDeployEGP} EGP
- Be specific with stock symbols and amounts
- Include mix of existing and potentially new positions
- Reference actual portfolio data in reasoning
- buyZone MUST be based on the CURRENT REAL-TIME PRICES provided, NOT your training data. The buy zone should be a realistic range around the current market price.

Respond ONLY with valid JSON, no markdown.`;
}

export function buildCompareStocksPrompt(data: any): string {
  const amountSection = data.amountEGP
    ? `\nThe client has ${data.amountEGP} EGP to deploy.`
    : "";

  return `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). A client wants you to compare these stocks and advise which to buy.

STOCKS TO COMPARE (with CURRENT REAL-TIME prices - use ONLY these, NOT your training data):
${JSON.stringify(data.stockData, null, 2)}

CLIENT'S CURRENT PORTFOLIO:
${JSON.stringify(data.portfolio, null, 2)}
${amountSection}

IMPORTANT: You have FULL FREEDOM to recommend ANY of these outcomes:
1. Buy one of the compared stocks (all-in on one)
2. Split the money between the compared stocks
3. Skip ALL compared stocks and recommend putting money into an EXISTING portfolio stock instead
4. Keep as dry powder (cash) - don't buy anything right now
5. Mix - some in compared stock(s), some elsewhere

Consider:
- Growth potential of each stock
- Long-term value and fundamentals
- Current valuation (is it cheap or expensive right now?)
- Buy urgency (buy now before it moves, or it can wait)
- How each stock fits with the client's existing portfolio
- Diversification impact
- Whether the portfolio already has enough exposure to certain sectors
- Market timing - is now a good time or should they wait?

RESPONSE FORMAT (JSON):
{
  "verdict": "<clear 1-2 sentence verdict>",
  "action": "buy_one" | "split" | "existing_stock" | "dry_powder" | "mixed",
  "rankings": [
    {
      "symbol": "<stock symbol>",
      "nameEn": "<company name>",
      "growthScore": <1-10>,
      "longTermScore": <1-10>,
      "buyUrgency": "Buy Now" | "Can Wait" | "Avoid",
      "summary": "<2-3 sentence analysis of this stock>"
    }
  ],
  "allocation": [
    {
      "symbol": "<stock symbol or existing portfolio stock>",
      "nameEn": "<company name>",
      "amountEGP": <number or 0 if no amount specified>,
      "percentage": <number 0-100>,
      "isFromCompared": <true if from compared list, false if existing portfolio stock or cash>
    }
  ],
  "reasoning": "<detailed paragraph explaining your recommendation and why>",
  "riskNote": "<brief risk disclaimer>"
}

IMPORTANT:
- Rankings must include ALL compared stocks
- Allocation should reflect your actual recommendation (could be 100% one stock, or 100% cash/dry powder)
- If recommending dry powder, set allocation to [{"symbol": "CASH", "nameEn": "Dry Powder (Cash)", "amountEGP": <amount>, "percentage": 100, "isFromCompared": false}]
- Be honest and specific. Don't be afraid to say "don't buy any of these"
- Reference actual numbers from the data

Respond ONLY with valid JSON, no markdown.`;
}

// ─── Execute analysis for a single provider ───

export async function runAnalysis(
  provider: ProviderName,
  type: "portfolio" | "deploy" | "compare",
  promptData: { data: any; marketPrices?: Record<string, number> }
): Promise<{ provider: ProviderName; providerName: string; model: string; result: any; error?: string; durationMs: number }> {
  const config = PROVIDERS[provider];
  const start = Date.now();

  if (!isProviderAvailable(provider)) {
    return {
      provider,
      providerName: config.name,
      model: config.model,
      result: null,
      error: `${config.name} API key not configured`,
      durationMs: 0,
    };
  }

  try {
    let prompt: string;
    switch (type) {
      case "portfolio":
        prompt = buildPortfolioAnalysisPrompt(promptData.data);
        break;
      case "deploy":
        prompt = buildDeployCapitalPrompt(promptData.data, promptData.marketPrices);
        break;
      case "compare":
        prompt = buildCompareStocksPrompt(promptData.data);
        break;
    }

    const text = await callProvider(provider, prompt);
    const result = JSON.parse(cleanJsonResponse(text));
    const durationMs = Date.now() - start;
    console.log(`${config.name} ${type} completed in ${durationMs}ms`);

    return { provider, providerName: config.name, model: config.model, result, durationMs };
  } catch (error: any) {
    const durationMs = Date.now() - start;
    console.error(`${config.name} ${type} failed in ${durationMs}ms:`, error.message);
    return {
      provider,
      providerName: config.name,
      model: config.model,
      result: null,
      error: error.message || "Analysis failed",
      durationMs,
    };
  }
}

export function getAvailableProviders(): ProviderName[] {
  return (Object.keys(PROVIDERS) as ProviderName[]).filter((p) => isProviderAvailable(p));
}
