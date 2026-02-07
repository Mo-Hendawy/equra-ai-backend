import { GoogleGenerativeAI } from "@google/generative-ai";
import { getCached, setCache, getStaleCache } from "./api-cache";
import * as dotenv from "dotenv";
import * as path from "path";

// Ensure .env is loaded
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Get API key from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

console.log(`Gemini API Key loaded: ${GEMINI_API_KEY ? 'YES (length: ' + GEMINI_API_KEY.length + ')' : 'NO - Key is empty!'}`);

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

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

    // Use Gemini 2.5 Flash-Lite for free tier (available in your API key)
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite",
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096, // Increased for detailed analysis
      }
    });

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
    
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Parse the JSON response
    let analysisData: GeminiAnalysis;
    try {
      // Remove markdown code blocks if present (```json ... ```)
      let cleanedText = text.trim();
      if (cleanedText.startsWith('```json')) {
        cleanedText = cleanedText.substring(7); // Remove ```json
      } else if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.substring(3); // Remove ```
      }
      if (cleanedText.endsWith('```')) {
        cleanedText = cleanedText.substring(0, cleanedText.length - 3); // Remove trailing ```
      }
      cleanedText = cleanedText.trim();
      
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
