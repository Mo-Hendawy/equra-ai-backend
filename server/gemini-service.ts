import { GoogleGenerativeAI } from "@google/generative-ai";
import { getCached, setCache, getStaleCache } from "./api-cache";
import * as dotenv from "dotenv";
import * as path from "path";

// Ensure .env is loaded
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Get API key from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

console.log(`Gemini API Key loaded: ${GEMINI_API_KEY ? 'YES (length: ' + GEMINI_API_KEY.length + ')' : 'NO - Key is empty!'}`);

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const GEMINI_MODEL = "gemini-2.5-flash-lite";

async function callGeminiWithRetry(
  prompt: string,
  opts: { temperature?: number; maxOutputTokens?: number } = {}
): Promise<string> {
  const { temperature = 0.7, maxOutputTokens = 4096 } = opts;
  const maxRetries = 5;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const model = genAI!.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig: { temperature, maxOutputTokens },
      });
      const result = await model.generateContent(prompt);
      return result.response.text();
    } catch (error: any) {
      const status = error?.status;
      const isRetryable = status === 429 || status === 503;
      console.warn(`Gemini attempt ${attempt + 1}/${maxRetries} failed: ${status || error.message}`);
      if (isRetryable && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s, 16s, 32s
        console.log(`Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error; // non-retryable or all retries exhausted — throw to caller
    }
  }
  throw new Error("Gemini failed after all retries");
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.substring(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3);
  return cleaned.trim();
}

export interface ExtractedTransaction {
  type: "buy" | "sell";
  shares: number;
  price: number;
  date: string;
  time: string;
  status: "Fulfilled" | "Cancelled";
}

export interface StockDataForAI {
  symbol: string;
  companyName?: string;
  sector?: string;
  currentPrice: number;
  volume?: number | null;
  
  // Fundamentals
  eps?: number | null;
  peRatio?: number | null;
  bookValue?: number | null;
  priceToBook?: number | null;
  dividendYield?: number | null;
  
  // Technical
  fiftyTwoWeekHigh?: number | null;
  fiftyTwoWeekLow?: number | null;
  fiftyDayAvg?: number | null;
  twoHundredDayAvg?: number | null;
  
  // Risk metrics
  sharpeRatio?: number | null;
  sortinoRatio?: number | null;
  
  // Historical context
  historicalPrices?: number[];
  priceChange30d?: number | null;
  priceChange90d?: number | null;
  
  // Data sources
  priceSource?: string;
  fundamentalsSource?: string;
}

export interface GeminiAnalysis {
  fairValueEstimate: number | null;
  fairValueRange: { min: number; max: number } | null;
  
  strongBuyZone: { min: number; max: number } | null;
  buyZone: { min: number; max: number } | null;
  holdZone: { min: number; max: number } | null;
  sellZone: { min: number; max: number } | null;
  strongSellZone: { min: number; max: number } | null;
  
  firstTarget: number | null;
  secondTarget: number | null;
  thirdTarget: number | null;
  
  recommendation: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
  confidence: "High" | "Medium" | "Low";
  reasoning: string;
  riskLevel: "Low" | "Medium" | "High";
  keyPoints: string[];
  
  analysisMethod: string;
  
  // Simplified analysis fields
  valuationStatus: "Undervalued" | "Fair" | "Overvalued";
  simpleExplanation: string[];
  riskSignals: string[];
}

export async function analyzeStockWithGemini(stockData: StockDataForAI, skipCache: boolean = false): Promise<GeminiAnalysis | null> {
  try {
    // Check cache first (24 hour cache) unless refresh requested
    if (!skipCache) {
      const cached = await getCached<GeminiAnalysis>(`gemini_analysis_${stockData.symbol}`);
      if (cached) {
        console.log(`Using cached Gemini analysis for ${stockData.symbol}`);
        return cached;
      }
    } else {
      console.log(`Skipping cache for ${stockData.symbol} (refresh requested)`);
    }

    if (!genAI || !GEMINI_API_KEY) {
      console.warn("Gemini API key not configured, using fallback analysis");
      return null;
    }

    const prompt = `You are an expert stock analyst specializing in the Egyptian Exchange (EGX). Provide a comprehensive investment analysis report.

STOCK DATA:
${JSON.stringify(stockData, null, 2)}

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

    console.log(`Requesting Gemini analysis for ${stockData.symbol}...`);
    
    const text = await callGeminiWithRetry(prompt);

    // Parse the JSON response
    let analysisData: GeminiAnalysis;
    try {
      const cleanedText = cleanJsonResponse(text);
      analysisData = JSON.parse(cleanedText);
      
      // Validate required fields
      if (!analysisData.recommendation || !analysisData.reasoning) {
        throw new Error("Missing required fields in Gemini response");
      }

      console.log(`Gemini analysis completed for ${stockData.symbol}: ${analysisData.recommendation}`);
      
      // Cache the successful analysis
      await setCache(`gemini_analysis_${stockData.symbol}`, analysisData);
      
      return analysisData;
    } catch (parseError) {
      console.error("Failed to parse Gemini response:", parseError);
      console.log("Raw response:", text);
      
      // Try stale cache on parse error
      const stale = await getStaleCache<GeminiAnalysis>(`gemini_analysis_${stockData.symbol}`);
      return stale;
    }
  } catch (error) {
    console.error(`Gemini analysis error for ${stockData.symbol}:`, error);
    
    // Try stale cache on error
    const stale = await getStaleCache<GeminiAnalysis>(`gemini_analysis_${stockData.symbol}`);
    return stale;
  }
}

// Fallback analysis when Gemini is not available or fails
export function createFallbackAnalysis(
  symbol: string,
  currentPrice: number,
  eps: number | null,
  peRatio: number | null,
  bookValue: number | null,
  dividendYield: number | null,
  sharpeRatio: number | null,
  sortinoRatio: number | null
): GeminiAnalysis {
  // Simple formula-based analysis as fallback
  let fairValue: number | null = null;
  let zones = null;
  let targets = null;
  
  if (eps && peRatio && bookValue) {
    // Fair value using P/E method and Graham formula
    const industryPE = 15; // Average P/E for established companies
    const fairValuePE = eps * industryPE;
    const fairValueGraham = Math.sqrt(22.5 * eps * bookValue);
    fairValue = (fairValuePE + fairValueGraham) / 2;
    
    // Calculate zones
    zones = {
      strongBuyZone: { min: 0, max: fairValue * 0.7 },
      buyZone: { min: fairValue * 0.7, max: fairValue * 0.85 },
      holdZone: { min: fairValue * 0.85, max: fairValue * 1.15 },
      sellZone: { min: fairValue * 1.15, max: fairValue * 1.3 },
      strongSellZone: { min: fairValue * 1.3, max: fairValue * 2 },
    };
    
    // Calculate targets
    targets = {
      firstTarget: fairValue,
      secondTarget: fairValue * 1.15,
      thirdTarget: fairValue * 1.3,
    };
  }
  
  // Determine recommendation
  let recommendation: GeminiAnalysis["recommendation"] = "Hold";
  let valuationStatus: "Undervalued" | "Fair" | "Overvalued" = "Fair";
  
  if (fairValue) {
    if (currentPrice < fairValue * 0.7) recommendation = "Strong Buy";
    else if (currentPrice < fairValue * 0.85) recommendation = "Buy";
    else if (currentPrice < fairValue * 1.15) recommendation = "Hold";
    else if (currentPrice < fairValue * 1.3) recommendation = "Sell";
    else recommendation = "Strong Sell";
    
    const ratio = currentPrice / fairValue;
    if (ratio < 0.85) valuationStatus = "Undervalued";
    else if (ratio > 1.15) valuationStatus = "Overvalued";
    else valuationStatus = "Fair";
  } else if (sharpeRatio && sharpeRatio > 1) {
    recommendation = "Buy";
  }
  
  const simpleExplanation: string[] = [];
  if (fairValue) {
    const diff = ((currentPrice / fairValue - 1) * 100).toFixed(0);
    simpleExplanation.push(`Stock trading ${Math.abs(Number(diff))}% ${currentPrice > fairValue ? 'above' : 'below'} fair value of ${fairValue.toFixed(2)} EGP`);
  }
  if (dividendYield) {
    simpleExplanation.push(`Dividend yield: ${dividendYield.toFixed(2)}%`);
  }
  if (sharpeRatio) {
    simpleExplanation.push(`Risk-adjusted return (Sharpe): ${sharpeRatio.toFixed(2)}`);
  }
  if (simpleExplanation.length === 0) {
    simpleExplanation.push("Limited data available for analysis");
  }
  
  const riskSignals: string[] = [];
  if (peRatio && peRatio > 30) riskSignals.push("High P/E ratio");
  if (sharpeRatio && sharpeRatio < 0) riskSignals.push("Negative risk-adjusted returns");
  if (valuationStatus === "Overvalued") riskSignals.push("Trading above fair value");
  if (!dividendYield || dividendYield < 1) riskSignals.push("Low or no dividend");
  
  return {
    fairValueEstimate: fairValue,
    fairValueRange: fairValue ? { min: fairValue * 0.9, max: fairValue * 1.1 } : null,
    strongBuyZone: zones?.strongBuyZone || null,
    buyZone: zones?.buyZone || null,
    holdZone: zones?.holdZone || null,
    sellZone: zones?.sellZone || null,
    strongSellZone: zones?.strongSellZone || null,
    firstTarget: targets?.firstTarget || null,
    secondTarget: targets?.secondTarget || null,
    thirdTarget: targets?.thirdTarget || null,
    recommendation,
    confidence: fairValue ? "Medium" : "Low",
    reasoning: fairValue 
      ? `Based on fundamental analysis with fair value of ${fairValue.toFixed(2)} EGP. Stock is trading at ${((currentPrice / fairValue - 1) * 100).toFixed(1)}% ${currentPrice > fairValue ? 'above' : 'below'} fair value.`
      : "Limited fundamental data available. Recommendation based on risk-adjusted returns and price trends.",
    riskLevel: sharpeRatio && sharpeRatio > 1.5 ? "Low" : sharpeRatio && sharpeRatio > 0.5 ? "Medium" : "High",
    keyPoints: [
      fairValue ? `Fair value: ${fairValue.toFixed(2)} EGP` : "Fair value not calculable",
      sharpeRatio ? `Sharpe ratio: ${sharpeRatio.toFixed(2)}` : "Risk metrics unavailable",
      peRatio ? `P/E: ${peRatio.toFixed(2)}` : "P/E ratio not available"
    ],
    analysisMethod: "Formula-based (fallback)",
    valuationStatus,
    simpleExplanation,
    riskSignals,
  };
}

// Portfolio Analysis with Gemini
export interface PortfolioAnalysisRequest {
  holdings: {
    symbol: string;
    nameEn: string;
    sector: string;
    shares: number;
    averageCost: number;
    currentPrice: number;
    role: string;
    marketValue: number;
    totalCost: number;
    profitLoss: number;
    profitLossPercent: number;
    weight: number;
    eps?: number;
    peRatio?: number;
    bookValue?: number;
    dividendYield?: number;
  }[];
  totalValue: number;
  totalCost: number;
  totalPL: number;
  totalPLPercent: number;
}

export interface PortfolioAnalysisResult {
  overallHealth: "Strong" | "Good" | "Fair" | "Weak";
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  diversificationScore: "Well Diversified" | "Moderately Diversified" | "Concentrated";
  riskLevel: "Low" | "Medium" | "High";
  sectorBreakdown: string;
  topPerformers: string[];
  underperformers: string[];
}

export async function analyzePortfolioWithGemini(data: PortfolioAnalysisRequest): Promise<PortfolioAnalysisResult | null> {
  if (!genAI || !GEMINI_API_KEY) {
    console.warn("Gemini API key not configured");
    return null;
  }

  try {
    const prompt = `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). Analyze this investment portfolio.

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

    const text = await callGeminiWithRetry(prompt);
    return JSON.parse(cleanJsonResponse(text));
  } catch (error) {
    console.error("Portfolio analysis error:", error);
    return null;
  }
}

// Deploy Capital Recommendation with Gemini
export interface DeployCapitalRequest {
  portfolio: PortfolioAnalysisRequest;
  amountToDeployEGP: number;
}

export interface DeployCapitalResult {
  strategy: string;
  allocations: {
    symbol: string;
    nameEn: string;
    amountEGP: number;
    percentage: number;
    reason: string;
    isNewPosition: boolean;
    buyZone: { low: number; high: number };
  }[];
  reasoning: string;
  riskNote: string;
}

export async function deployCapitalWithGemini(data: DeployCapitalRequest, marketPrices?: Record<string, number>): Promise<DeployCapitalResult | null> {
  if (!genAI || !GEMINI_API_KEY) {
    console.warn("Gemini API key not configured");
    return null;
  }

  try {
    const marketPricesSection = marketPrices && Object.keys(marketPrices).length > 0
      ? `\n\nCURRENT REAL-TIME EGX MARKET PRICES (as of today, use ONLY these prices - do NOT use prices from your training data):\n${Object.entries(marketPrices).map(([sym, price]) => `${sym}: ${price.toFixed(2)} EGP`).join("\n")}\n`
      : "";

    const prompt = `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). A client wants to deploy ${data.amountToDeployEGP} EGP into their portfolio.

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

    const text = await callGeminiWithRetry(prompt);
    return JSON.parse(cleanJsonResponse(text));
  } catch (error) {
    console.error("Deploy capital analysis error:", error);
    return null;
  }
}

// Compare Stocks with Gemini
export interface CompareStocksRequest {
  symbols: string[];
  stockData: {
    symbol: string;
    nameEn: string;
    currentPrice: number;
    peRatio?: number | null;
    eps?: number | null;
    dividendYield?: number | null;
    bookValue?: number | null;
    sector?: string;
  }[];
  portfolio: PortfolioAnalysisRequest;
  amountEGP?: number;
}

export interface CompareStocksResult {
  verdict: string;
  action: "buy_one" | "split" | "existing_stock" | "dry_powder" | "mixed";
  rankings: {
    symbol: string;
    nameEn: string;
    growthScore: number;
    longTermScore: number;
    buyUrgency: "Buy Now" | "Can Wait" | "Avoid";
    summary: string;
  }[];
  allocation?: {
    symbol: string;
    nameEn: string;
    amountEGP: number;
    percentage: number;
    isFromCompared: boolean;
  }[];
  reasoning: string;
  riskNote: string;
}

export async function compareStocksWithGemini(data: CompareStocksRequest): Promise<CompareStocksResult | null> {
  if (!genAI || !GEMINI_API_KEY) {
    console.warn("Gemini API key not configured");
    return null;
  }

  try {
    const amountSection = data.amountEGP
      ? `\nThe client has ${data.amountEGP} EGP to deploy.`
      : "";

    const prompt = `You are an expert financial advisor specializing in the Egyptian Exchange (EGX). A client wants you to compare these stocks and advise which to buy.

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
  "verdict": "<clear 1-2 sentence verdict, e.g. 'Buy MICH now, SWDY can wait. Consider adding to existing EGAL position instead of ORAS.'>",
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

    const text = await callGeminiWithRetry(prompt);
    return JSON.parse(cleanJsonResponse(text));
  } catch (error) {
    console.error("Compare stocks error:", error);
    return null;
  }
}
