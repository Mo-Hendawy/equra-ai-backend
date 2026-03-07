import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import * as path from "path";
import { getStockAnalysisContext, getMultiStockContext } from "./rag-service";
import {
  validateAnalysis,
  logValidationFailure,
  type SchemaType,
} from "./schemas/analysis-schemas";

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

function getHuggingFaceClient() {
  const key = process.env.HUGGINGFACE_API_KEY || "";
  // We use OpenAI SDK to connect to HF serverless endpoints
  return key ? new OpenAI({ apiKey: key, baseURL: "https://router.huggingface.co/v1" }) : null;
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
    case "huggingface": return !!(process.env.HUGGINGFACE_API_KEY);
    case "huggingface-qwen": return !!(process.env.HUGGINGFACE_API_KEY);
    case "huggingface-mistral": return !!(process.env.HUGGINGFACE_API_KEY);
    default: return false;
  }
}

console.log(`AI Providers at startup: Gemini=${!!process.env.GEMINI_API_KEY}, OpenRouter=${!!process.env.OPENROUTER_API_KEY}, Groq=${!!process.env.GROQ_API_KEY}, Cerebras=${!!process.env.CEREBRAS_API_KEY}`);

export type ProviderName = "gemini" | "deepseek" | "kimi" | "groq" | "cerebras" | "huggingface" | "huggingface-qwen" | "huggingface-mistral";

interface ProviderConfig {
  name: string;
  model: string;
  available: boolean;
}

export const PROVIDERS: Record<ProviderName, Omit<ProviderConfig, "available"> & { name: string; model: string }> = {
  gemini: { name: "Gemini 2.5 Flash", model: "gemini-2.5-flash" },
  deepseek: { name: "DeepSeek V3.2 (OpenRouter)", model: "deepseek/deepseek-v3.2" },
  kimi: { name: "Kimi K2.5 (OpenRouter)", model: "moonshotai/kimi-k2.5" },
  groq: { name: "Llama 4 Scout (Groq)", model: "meta-llama/llama-4-scout-17b-16e-instruct" },
  cerebras: { name: "GPT-OSS 120B (Cerebras)", model: "gpt-oss-120b" },
  huggingface: { name: "HuggingFace Llama 3.2", model: "meta-llama/Llama-3.2-3B-Instruct" },
  "huggingface-qwen": { name: "HuggingFace Qwen 2.5", model: "Qwen/Qwen2.5-72B-Instruct" },
  "huggingface-mistral": { name: "HuggingFace Mistral 7B", model: "mistralai/Mistral-7B-Instruct-v0.3" },
};

// ─── Helper: clean JSON from LLM response ───

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    if (cleaned.startsWith("```json")) cleaned = cleaned.substring(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.substring(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.substring(0, cleaned.length - 3);
    cleaned = cleaned.trim();
  }
  // Extract the JSON object/array even if there's surrounding text
  const jsonStart = cleaned.indexOf("{");
  const jsonArrStart = cleaned.indexOf("[");
  const start = jsonStart >= 0 && (jsonArrStart < 0 || jsonStart < jsonArrStart) ? jsonStart : jsonArrStart;
  if (start > 0) cleaned = cleaned.substring(start);

  // Try to fix truncated JSON by closing open braces/brackets
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    let fixed = cleaned;
    let openBraces = 0, openBrackets = 0;
    let inString = false, escape = false;
    for (const ch of fixed) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") openBraces++;
      else if (ch === "}") openBraces--;
      else if (ch === "[") openBrackets++;
      else if (ch === "]") openBrackets--;
    }
    if (inString) fixed += '"';
    // Remove trailing comma before closing
    fixed = fixed.replace(/,\s*$/, "");
    while (openBrackets > 0) { fixed += "]"; openBrackets--; }
    while (openBraces > 0) { fixed += "}"; openBraces--; }
    return fixed;
  }
}

// ─── Core: call a specific provider ───

async function callGemini(prompt: string): Promise<string> {
  const client = getGeminiClient();
  if (!client) throw new Error("Gemini API key not configured");
  const model = client.getGenerativeModel({
    model: PROVIDERS.gemini.model,
    generationConfig: { temperature: 0.7, maxOutputTokens: 16384 },
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
    max_tokens: 8192,
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
    case "huggingface": {
      const client = getHuggingFaceClient();
      if (!client) throw new Error("HuggingFace API key not configured");
      return callWithRetry(() => callOpenAICompatible(client, PROVIDERS.huggingface.model, prompt));
    }
    case "huggingface-qwen": {
      const client = getHuggingFaceClient();
      if (!client) throw new Error("HuggingFace API key not configured");
      return callWithRetry(() => callOpenAICompatible(client, PROVIDERS["huggingface-qwen"].model, prompt));
    }
    case "huggingface-mistral": {
      const client = getHuggingFaceClient();
      if (!client) throw new Error("HuggingFace API key not configured");
      return callWithRetry(() => callOpenAICompatible(client, PROVIDERS["huggingface-mistral"].model, prompt));
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ─── Prompts (shared across all providers) ───

export function buildPortfolioAnalysisPrompt(data: any, ragContext = ""): string {
  return `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). Analyze this investment portfolio.

PORTFOLIO DATA:
${JSON.stringify(data, null, 2)}
${ragContext}

Provide a comprehensive portfolio analysis covering:
1. Overall health assessment
2. Strengths of this portfolio
3. Weaknesses and risks
4. Diversification quality (sector concentration, single stock risk)
5. Specific actionable recommendations
6. Top performers and underperformers
7. If SENTIMENT data is provided (raw FinBERT scores per headline), incorporate it.
${ragContext ? "\nIMPORTANT: Use the financial report data above to enrich your analysis with real company fundamentals, revenue trends, and earnings data where available." : ""}

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

export function buildDeployCapitalPrompt(data: any, marketPrices?: Record<string, number>, ragContext = ""): string {
  const marketPricesSection = marketPrices && Object.keys(marketPrices).length > 0
    ? `\n\nCURRENT REAL-TIME EGX MARKET PRICES (as of today, use ONLY these prices - do NOT use prices from your training data):\n${Object.entries(marketPrices).map(([sym, price]) => `${sym}: ${price.toFixed(2)} EGP`).join("\n")}\n`
    : "";

  return `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). A client wants to deploy ${data.amountToDeployEGP} EGP into their portfolio.

CURRENT PORTFOLIO:
${JSON.stringify(data.portfolio, null, 2)}
${marketPricesSection}
${ragContext}
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
- If SENTIMENT data is in the portfolio (raw FinBERT scores per headline), factor it in

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
${ragContext ? "- Use the financial report data to identify which stocks have strong fundamentals for allocation." : ""}

Respond ONLY with valid JSON, no markdown.`;
}

export function buildCompareStocksPrompt(data: any, ragContext = ""): string {
  const amountSection = data.amountEGP
    ? `\nThe client has ${data.amountEGP} EGP to deploy.`
    : "";
  const sentimentSection = data.sentimentBySymbol && Object.keys(data.sentimentBySymbol).length > 0
    ? `\n\nMARKET SENTIMENT (raw FinBERT response per headline - scores for positive/negative/neutral):\n${JSON.stringify(data.sentimentBySymbol, null, 2)}`
    : "";

  return `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). A client wants you to compare these stocks and advise which to buy.

STOCKS TO COMPARE (with CURRENT REAL-TIME prices - use ONLY these, NOT your training data):
${JSON.stringify(data.stockData, null, 2)}

CLIENT'S CURRENT PORTFOLIO:
${JSON.stringify(data.portfolio, null, 2)}
${amountSection}
${sentimentSection}
${ragContext}

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
- If SENTIMENT data (sentimentBySymbol: raw FinBERT scores per headline per stock) is provided, factor it in

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
${ragContext ? "- Use the financial report data provided to compare real company fundamentals, revenue, and earnings." : ""}

Respond ONLY with valid JSON, no markdown.`;
}

// ─── Stock Analysis Prompt (single stock) ───

export function buildStockAnalysisPrompt(stockData: any, ragContext = ""): string {
  return `You are an expert stock analyst specializing in the Egyptian Exchange (EGX). Provide a comprehensive investment analysis report.

STOCK DATA:
${JSON.stringify(stockData, null, 2)}
${ragContext}

ANALYSIS REQUIREMENTS:

1. **Market Overview**: Current status with 52-week range (if available), trading volume, P/E ratio, recent performance

2. **Fair Value Analysis**: 
   - Calculate using multiple methods (P/E based, P/B, Graham Formula, Analyst Average if applicable)
   - Provide Conservative, Target, and Optimistic fair values
   - Explain if stock is trading at discount/premium and why

3. **Entry Zones**: Define clear price zones:
   - Strong Buy Zone: Significant discount (typically 20-30% below fair value)
   - Buy Zone: Moderate discount (10-20% below fair value)
   - Hold Zone: Around fair value (±10%)
   - Sell Zone: Premium (10-20% above fair value)
   - Strong Sell Zone: Significant premium (>20% above fair value)
   - For each zone, explain the reasoning

4. **Price Targets**: Conservative, Moderate, and Optimistic targets with timeframes

5. **Risk Assessment**: Based on Sharpe/Sortino ratios, volatility, and fundamentals

6. **Detailed Analysis**: Long-form explanation covering:
   - Valuation rationale
   - Why current price represents opportunity/risk
   - Key metrics interpretation
   - Market conditions impact
   - What levels to watch for entry/exit

IMPORTANT CONTEXT:
- Egyptian Exchange (EGX) - emerging market with higher volatility
- Currency: EGP (Egyptian Pound)
- If fundamentals missing, use technical analysis and price trends
- Be specific with numbers and reasoning
- Make the analysis detailed and actionable

RESPONSE FORMAT (JSON):
{
  "fairValueEstimate": <number or null>,
  "fairValueRange": {"min": <number>, "max": <number>},
  "strongBuyZone": {"min": 0, "max": <number>},
  "buyZone": {"min": <number>, "max": <number>},
  "holdZone": {"min": <number>, "max": <number>},
  "sellZone": {"min": <number>, "max": <number>},
  "strongSellZone": {"min": <number>, "max": <number>},
  "firstTarget": <number>,
  "secondTarget": <number>,
  "thirdTarget": <number>,
  "recommendation": "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell",
  "confidence": "High" | "Medium" | "Low",
  "reasoning": "<DETAILED multi-paragraph analysis covering market overview, fair value rationale, entry zones explanation, risk factors, and actionable recommendations. Make this at least 300-500 words with specific numbers and detailed reasoning>",
  "riskLevel": "Low" | "Medium" | "High",
  "keyPoints": [
    "<Detailed point about current market position with numbers>",
    "<Detailed point about valuation with specific fair value breakdown>",
    "<Detailed point about entry zones with price levels>",
    "<Detailed point about risk factors and metrics>",
    "<Detailed point about what to watch for and action items>"
  ],
  "analysisMethod": "<Detailed description of all valuation methods used and how you arrived at the conclusion>",
  "valuationStatus": "Undervalued" | "Fair" | "Overvalued",
  "simpleExplanation": [
    "<Simple bullet 1: Explain valuation in plain language with numbers>",
    "<Simple bullet 2: Explain risk/return or dividend (MUST include dividend if yield exists)>",
    "<Simple bullet 3: Explain price position or opportunity>"
  ],
  "riskSignals": [
    "<Risk warning 1 if any, e.g., 'High PE ratio'>",
    "<Risk warning 2 if any>",
    "<Risk warning 3 if any>"
  ]
}

Make the reasoning field VERY DETAILED - include:
- Market Overview paragraph
- Fair Value Analysis paragraph with multiple methods
- Entry Zones paragraph explaining each level
- Risk Assessment paragraph
- Conclusion with actionable recommendations

IMPORTANT for simpleExplanation:
- Keep each bullet short and clear (max 25 words)
- No finance jargon
- If dividend yield exists, ALWAYS include it in one bullet
- Use actual numbers from the data

IMPORTANT for riskSignals:
- List actual warning signs from the data (high PE, low dividend, overvaluation, etc.)
- Keep phrases short (max 10 words each)
- If no significant risks, return empty array []

Respond ONLY with valid JSON, no markdown formatting or additional text.`;
}

// ─── Helper: extract stock symbols from portfolio data ───

function extractSymbols(data: any): string[] {
  if (!data) return [];
  if (Array.isArray(data)) {
    return data.map((item: any) => item.symbol || item.Symbol).filter(Boolean);
  }
  if (data.stocks && Array.isArray(data.stocks)) {
    return data.stocks.map((s: any) => s.symbol || s.Symbol).filter(Boolean);
  }
  if (data.holdings && Array.isArray(data.holdings)) {
    return data.holdings.map((h: any) => h.symbol || h.Symbol).filter(Boolean);
  }
  return [];
}

// ─── Trusted providers for stock analysis ───

export const TRUSTED_PROVIDERS: ProviderName[] = ["gemini", "deepseek", "groq", "huggingface", "huggingface-qwen", "huggingface-mistral"];

// ─── Execute analysis for a single provider ───

export async function runAnalysis(
  provider: ProviderName,
  type: "portfolio" | "deploy" | "compare" | "stock",
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

  let prompt: string;
  let ragUsed = false;
  switch (type) {
    case "portfolio": {
      const symbols = extractSymbols(promptData.data);
      const { context, symbolsWithData } = symbols.length > 0
        ? await getMultiStockContext(symbols) : { context: "", symbolsWithData: [] };
      ragUsed = symbolsWithData.length > 0;
      prompt = buildPortfolioAnalysisPrompt(promptData.data, context);
      break;
    }
    case "deploy": {
      const symbols = extractSymbols(promptData.data?.portfolio);
      const { context, symbolsWithData } = symbols.length > 0
        ? await getMultiStockContext(symbols) : { context: "", symbolsWithData: [] };
      ragUsed = symbolsWithData.length > 0;
      prompt = buildDeployCapitalPrompt(promptData.data, promptData.marketPrices, context);
      break;
    }
    case "compare": {
      const compareSymbols = (promptData.data?.stockData || []).map((s: any) => s.symbol).filter(Boolean);
      const portfolioSymbols = extractSymbols(promptData.data?.portfolio);
      const allSymbols = [...new Set([...compareSymbols, ...portfolioSymbols])];
      const { context, symbolsWithData } = allSymbols.length > 0
        ? await getMultiStockContext(allSymbols) : { context: "", symbolsWithData: [] };
      ragUsed = symbolsWithData.length > 0;
      prompt = buildCompareStocksPrompt(promptData.data, context);
      break;
    }
    case "stock": {
      const symbol = promptData.data?.symbol;
      const ragContext = symbol ? await getStockAnalysisContext(symbol) : "";
      ragUsed = ragContext.length > 0;
      prompt = buildStockAnalysisPrompt(promptData.data, ragContext);
      break;
    }
  }

  try {
    let result: any;
    const MAX_JSON_RETRIES = 2;
    for (let jsonAttempt = 0; jsonAttempt < MAX_JSON_RETRIES; jsonAttempt++) {
      const text = await callProvider(provider, prompt);
      try {
        const parsed = JSON.parse(cleanJsonResponse(text));

        // Schema validation
        const schemaType: SchemaType = type;
        const validated = validateAnalysis(schemaType, parsed);

        if (!validated.success) {
          logValidationFailure(schemaType, `${config.name}-${type}`, validated);
          if (jsonAttempt === MAX_JSON_RETRIES - 1) {
            return {
              provider,
              providerName: config.name,
              model: config.model,
              result: null,
              error: `Analysis failed: Schema validation failed (${validated.errors.slice(0, 3).join("; ")})`,
              durationMs: Date.now() - start,
            };
          }
          console.log(`${config.name} retrying due to schema validation failure...`);
          continue;
        }

        result = validated.data;
        break;
      } catch (parseError: any) {
        console.error(`${config.name} ${type} JSON parse failed (attempt ${jsonAttempt + 1}/${MAX_JSON_RETRIES}):`, parseError.message);
        if (jsonAttempt === MAX_JSON_RETRIES - 1) {
          return {
            provider,
            providerName: config.name,
            model: config.model,
            result: null,
            error: "Analysis failed: Invalid JSON response from model",
            durationMs: Date.now() - start,
          };
        }
        console.log(`${config.name} retrying due to JSON parse failure...`);
      }
    }

    const durationMs = Date.now() - start;
    console.log(`${config.name} ${type} completed in ${durationMs}ms`);

    const out: { provider: ProviderName; providerName: string; model: string; result: any; error?: string; durationMs: number; ragUsed?: boolean } = {
      provider,
      providerName: config.name,
      model: config.model,
      result,
      durationMs,
    };
    out.ragUsed = ragUsed;
    return out;
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
