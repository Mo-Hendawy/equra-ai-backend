import type { Express } from "express";
import { createServer, type Server } from "node:http";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "node:crypto";
import { getCached, setCache, getStaleCache, getCacheEntry } from "./api-cache";
import { memoryService } from "./memory/memory-service.js";
import { analyzeStockWithGemini, createFallbackAnalysis, analyzePortfolioWithGemini, deployCapitalWithGemini, compareStocksWithGemini, compareAnalysisNarrative, type StockDataForAI, type PortfolioAnalysisRequest, type DeployCapitalRequest, type CompareStocksRequest } from "./gemini-service";
import { extractTransactionsFromImage, extractDividendFromImage } from "./vision-service";
import { runAnalysis, getAvailableProviders, PROVIDERS, TRUSTED_PROVIDERS, type ProviderName, isProviderConfigured } from "./ai-providers";
import { createManusAnalysis, getManusAnalysisResult, getManusTaskStatus, ManusAnalysisRequest, registerManusWebhook } from "./manus-service";
import { manusWebhookHandler } from "./manus-webhook-handler";
import { deriveStockSummary } from "./utils/summary";
import { criticAgent } from "./agents/critic-agent.js";
import { orchestrator } from "./agents/orchestrator.js";
import type { DataAgentInput, PipelineResult } from "./agents/types.js";
import { applyConfidenceDiscount, type CriticFeedback } from "./schemas/analysis-schemas.js";

const EODHD_API_TOKEN = process.env.EODHD_API_TOKEN || "";
const EODHD_BASE_URL = "https://eodhd.com/api";

const EGX_COMPANY_SYMBOL_MAP: Record<string, string> = {
  "Abou Kir Fertilizers": "ABUK",
  "Commercial International Bank": "COMI",
  "Telecom Egypt": "ETEL",
  "ELSWEDY ELECTRIC": "SWDY",
  "Eastern Company": "EAST",
  "Palm Hills Development Company": "PHDC",
  "Orascom Construction PLC": "ORAS",
  "Orascom Development Egypt": "ORHD",
  "Sidi Kerir Petrochemicals - SIDPEC": "SKPC",
  "Alexandria Pharmaceuticals": "AXPH",
  "Misr Chemical Industries": "MICH",
  "Fawry For Banking Technology And Electronic Payment": "FWRY",
  "Housing & Development Bank": "HDBK",
  "CI Capital Holding For Financial Investments": "CICH",
  "B Investments Holding": "BINV",
  "Cleopatra Hospital Company": "CLHO",
  "Egypt Aluminum": "EGAL",
  "Misr Duty Free Shops": "MTIE",
  "Misr Hotels": "MHOT",
  "Six of October Development & Investment (SODIC)": "OCDI",
  "Madinet Masr For Housing and Development": "MASR",
  "Beltone Holding": "BTFH",
  "Glaxo Smith Kline": "GLAX",
  "East Delta Flour Mills": "EDFM",
  "Upper Egypt Flour Mills": "UEFM",
  "Al Baraka Bank Egypt": "SAUD",
  "Societe Arabe Internationale De Banque S.A.E.": "SAIB",
  "Suez Canal Bank S.A.E": "CANA",
  "Engineering Industries (ICON)": "ICON",
  "Naeem Holding": "NAHO",
  "Maridive & oil services": "MOIL",
  "MM Group For Industry And International Trade": "MTIE",
  "International Company For Fertilizers & Chemicals": "IFCH",
  "October Pharma": "OCPH",
  "Delta Insurance": "DEIN",
  "El Shams Housing & Urbanization": "ELSH",
  "United Housing & Development": "UEGC",
  "Dice Sport & Casual Wear": "DSCW",
  "Raya Customer Experience": "RAEC",
  "QALA For Financial Investments": "QFIN",
  "Valmore Holding-EGP": "VALM",
  "A Capital Holding": "ACAP",
  "Arabia Investments Holding": "AIND",
  "Tanmiya for Real Estate Investment": "TMEI",
  "Obour Land for Food Industries": "OLFI",
  // Additional symbols from mobile EGX_STOCKS (for summary endpoint)
  "Arab Pharmaceuticals": "ADCI",
  "Abu Dhabi Islamic Bank Egypt": "ADIB",
  "Bank of Alexandria": "ALEX",
  "QNB Alahli": "QNBA",
  "Societe Arabe Internationale de Banque": "SAIB",
  "The United Bank": "UBEE",
  "U Consumer Finance": "VALU",
  "EFG Hermes Holding": "HRHO",
  "SODIC": "SODIC",
  "Bonyan for Development and Trade": "BONY",
  "Juhayna Food Industries": "JUFO",
  "Cairo Poultry": "POUL",
  "Misr Fertilizers Production Company": "MFPC",
  "Edita Food Industries": "EFID",
  "Credit Agricole Egypt": "CIEB",
  "Ibnsina Pharma": "ISPH",
};

// Reverse mapping for company names
export const EGX_COMPANY_SYMBOL_MAP_REVERSE: Record<string, string> = Object.entries(EGX_COMPANY_SYMBOL_MAP).reduce((acc, [name, symbol]) => {
  acc[symbol] = name;
  return acc;
}, {} as Record<string, string>);

interface EGXFinancialData {
  peRatio: number | null;
  dividendYield: number | null;
}

// Official EGX P/E and Dividend Yield data from https://www.egx.com.eg/en/MarketPECompanies.aspx
// Last updated: January 2026
const EGX_PE_DATA: Record<string, EGXFinancialData & { eps?: number }> = {
  // Banks (user-provided data since not in specialized activities list)
  "COMI": { peRatio: 7.52, dividendYield: 2.032, eps: 16.36 },
  "CIEB": { peRatio: null, dividendYield: null }, // Credit Agricole Egypt
  "ISPH": { peRatio: null, dividendYield: null }, // Ibnsina Pharma
  
  // From EGX Official Website - PE/DY for Companies Eligible for Specialized Activities
  "REMA": { peRatio: 21.84, dividendYield: 0 },  // The Arab Ceramic CO.- Ceramica Remas
  "ALEX": { peRatio: 215.48, dividendYield: 0 }, // Alexandria New Medical Center
  "ELWA": { peRatio: 111.50, dividendYield: 0 }, // El Kahera El Watania Investment
  "DEIN": { peRatio: 3.09, dividendYield: 0 },   // Delta Insurance
  "ELSH": { peRatio: 10.35, dividendYield: 0.69 }, // El Shams Housing & Urbanization
  "UEGC": { peRatio: 19.08, dividendYield: 0 },  // United Housing & Development
  "ORHD": { peRatio: 7.51, dividendYield: 1.68 }, // Orascom Development Egypt
  "CUFE": { peRatio: 41.90, dividendYield: 0 },  // Copper For Commercial Investment
  "MASR": { peRatio: 3.13, dividendYield: 5.79 }, // Madinet Masr For Housing and Development
  "OCDI": { peRatio: 8.93, dividendYield: 0 },   // Six of October Development & Investment (SODIC)
  "AMOC": { peRatio: 9.13, dividendYield: 3.02 }, // Arab Moltaka Investments Co
  "OSOO": { peRatio: 70.25, dividendYield: 0 },  // Osool ESB Securities Brokerage
  "MHOT": { peRatio: 7.02, dividendYield: 6.09 }, // Misr Hotels
  "CESI": { peRatio: 54.00, dividendYield: 0 },  // Cairo Educational Services
  "MMGR": { peRatio: 12.39, dividendYield: 0 },  // MM Group For Industry And International Trade
  "MTIE": { peRatio: 7.86, dividendYield: 9.92 }, // Misr Duty Free Shops
  "ICON": { peRatio: 3.49, dividendYield: 4.10 }, // Engineering Industries (ICON)
  "MOIL": { peRatio: 9.53, dividendYield: 0 },   // Maridive & oil services
  "ETEL": { peRatio: 11.47, dividendYield: 2.21 }, // Telecom Egypt
  "RAEC": { peRatio: 4.70, dividendYield: 0 },   // Raya Customer Experience
  "ORAS": { peRatio: 9.72, dividendYield: 3.02 }, // Orascom Construction PLC
  "BINV": { peRatio: 4.88, dividendYield: 3.38 }, // B Investments Holding
  "SAIB": { peRatio: 2.03, dividendYield: 24.57 }, // Societe Arabe Internationale De Banque S.A.E.
  "SAUD": { peRatio: 3.81, dividendYield: 5.40 }, // Al Baraka Bank Egypt
  "EGAL": { peRatio: 10.45, dividendYield: 3.10 }, // Egypt Aluminum
  "QFIN": { peRatio: 1.32, dividendYield: 0 },   // QALA For Financial Investments
  "CLHO": { peRatio: 22.58, dividendYield: 0 },  // Cleopatra Hospital Company
  "VALM": { peRatio: 3.09, dividendYield: 7.78 }, // Valmore Holding-EGP
  "TMEI": { peRatio: 15.72, dividendYield: 0 },  // Tanmiya for Real Estate Investment
  "FWRY": { peRatio: 30.19, dividendYield: 0 },  // Fawry For Banking Technology
  "EMES": { peRatio: 172.62, dividendYield: 0 }, // The Egyptian Modern Education Systems
  "ACAP": { peRatio: 34.14, dividendYield: 0 },  // A Capital Holding
  "IFCH": { peRatio: 7.99, dividendYield: 0 },   // International Company For Fertilizers & Chemicals
  "WKOL": { peRatio: 36.01, dividendYield: 5.44 }, // Wadi Kom Ombo Land Reclamation
  "IAPC": { peRatio: 19.34, dividendYield: 0 },  // International Agricultural Products
  "ELSA": { peRatio: 11.97, dividendYield: 0 },  // Elsaeed Contracting
  "CANA": { peRatio: 4.69, dividendYield: 0 },   // Suez Canal Bank S.A.E
  "HDBK": { peRatio: 3.92, dividendYield: 5.44 }, // Housing & Development Bank
  "ATQA": { peRatio: 19.57, dividendYield: 0 },  // Misr National Steel - Ataqa
  "NAHO": { peRatio: 11.35, dividendYield: 0 },  // Naeem Holding
  "PHDC": { peRatio: 7.14, dividendYield: 0 },   // Palm Hills Development Company
  "SKPC": { peRatio: 6.43, dividendYield: 6.94 }, // Sidi Kerir Petrochemicals - SIDPEC
  "SWDY": { peRatio: 8.86, dividendYield: 1.28 }, // ELSWEDY ELECTRIC
  "EAST": { peRatio: 27.54, dividendYield: 7.70 }, // Eastern Company
  "ABUK": { peRatio: 6.99, dividendYield: 11.58 }, // Abou Kir Fertilizers
  "GLAX": { peRatio: 28.05, dividendYield: 1.71 }, // Glaxo Smith Kline
  "MICH": { peRatio: 5.30, dividendYield: 14.53 }, // Misr Chemical Industries
  "AXPH": { peRatio: 10.23, dividendYield: 7.87 }, // Alexandria Pharmaceuticals
  "CICH": { peRatio: 3.79, dividendYield: 8.28 }, // CI Capital Holding For Financial Investments
  "BTFH": { peRatio: 18.43, dividendYield: 0 },  // Beltone Holding
  "DSCW": { peRatio: 4.97, dividendYield: 0 },   // Dice Sport & Casual Wear
  "OCPH": { peRatio: 15.10, dividendYield: 0 },  // October Pharma
  "EDFM": { peRatio: 8.24, dividendYield: 7.08 }, // East Delta Flour Mills
  "UEFM": { peRatio: 11.07, dividendYield: 4.54 }, // Upper Egypt Flour Mills
  "SCGM": { peRatio: 253.50, dividendYield: 0 }, // South Cairo & Giza Mills & Bakeries
  "OLFI": { peRatio: 12.54, dividendYield: 6.46 }, // Obour Land for Food Industries
};

async function fetchEGXFinancialData(): Promise<Map<string, EGXFinancialData>> {
  const cache = new Map<string, EGXFinancialData>();
  for (const [symbol, data] of Object.entries(EGX_PE_DATA)) {
    cache.set(symbol, data);
  }
  return cache;
}

interface StockPrice {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  source?: string;
  error?: string;
}

interface StockFinancials {
  eps: number | null;
  peRatio: number | null;
  bookValue: number | null;
  recommendation: number | null;
  source?: string;
}

interface StockAnalysis {
  symbol: string;
  currentPrice: number | null;
  eps: number | null;
  peRatio: number | null;
  bookValue: number | null;
  priceToBook: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyDayAvg: number | null;
  twoHundredDayAvg: number | null;
  dividendYield: number | null;
  fairValuePE: number | null;
  fairValueGraham: number | null;
  fairValueAvg: number | null;
  strongBuyZone: { min: number; max: number } | null;
  buyZone: { min: number; max: number } | null;
  holdZone: { min: number; max: number } | null;
  sellZone: { min: number; max: number } | null;
  strongSellZone: { min: number; max: number } | null;
  firstTarget: number | null;
  secondTarget: number | null;
  thirdTarget: number | null;
  recommendation: string;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  dataAvailable: boolean;
  priceSource?: string;
  financialsSource?: string;
  geminiReasoning?: string;
  geminiConfidence?: "High" | "Medium" | "Low";
  geminiRiskLevel?: "Low" | "Medium" | "High";
  geminiKeyPoints?: string[];
  analysisMethod?: string;
  error?: string;
  // Phase 2 additive fields (Critic Agent)
  valuationStatus?: string;
  simpleExplanation?: string[];
  riskSignals?: string[];
  criticFeedback?: import('./schemas/analysis-schemas.js').CriticFeedback;
}

async function fetchEODHDPrice(symbol: string): Promise<StockPrice | null> {
  try {
    // Check cache first
    const cached = await getCached<StockPrice>(`price_${symbol}`);
    if (cached) {
      return { ...cached, source: `${cached.source} (Cached)` };
    }

    // EGX stocks use .EGX suffix - get latest EOD data
    const url = `${EODHD_BASE_URL}/eod/${symbol}.EGX?api_token=${EODHD_API_TOKEN}&fmt=json&period=d&order=d`;
    
    console.log(`Fetching EODHD EOD price for ${symbol}...`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.error(`EODHD price fetch failed for ${symbol}: ${response.status}`);
      // 402 = Payment Required (quota exceeded). Return null so we fall through to TradingView/CNBC.
      if (response.status === 402) return null;
      // Other errors: try stale cache
      const stale = await getStaleCache<StockPrice>(`price_${symbol}`);
      return stale;
    }

    const data = await response.json();

    // Get the latest day's data (first element in array when order=d for descending)
    // But API returns ascending by default, so take last element
    if (Array.isArray(data) && data.length > 0) {
      // Check if data is sorted ascending or descending by comparing dates
      const isDescending = data.length > 1 && new Date(data[0].date) > new Date(data[1].date);
      const latest = isDescending ? data[0] : data[data.length - 1];
      
      const price = latest.close ? parseFloat(latest.close) : null;
      const open = latest.open ? parseFloat(latest.open) : null;
      const high = latest.high ? parseFloat(latest.high) : null;
      const low = latest.low ? parseFloat(latest.low) : null;
      const volume = latest.volume ? parseInt(latest.volume) : null;
      
      // Calculate change from previous day if available
      let change: number | null = null;
      let changePercent: number | null = null;
      let previousClose: number | null = null;
      
      if (data.length > 1) {
        previousClose = data[data.length - 2].close ? parseFloat(data[data.length - 2].close) : null;
        if (price && previousClose) {
          change = price - previousClose;
          changePercent = (change / previousClose) * 100;
        }
      }

      if (price && price > 0) {
        const priceData: StockPrice = {
          symbol,
          price,
          change,
          changePercent,
          previousClose,
          open,
          high,
          low,
          volume,
          source: "EODHD",
        };

        // Cache the successful response
        await setCache(`price_${symbol}`, priceData);
        
        return priceData;
      }
    }

    // If data is invalid, try stale cache
    const stale = await getStaleCache<StockPrice>(`price_${symbol}`);
    return stale;
  } catch (error) {
    console.error("EODHD price fetch error:", error);
    // Try to use stale cache on error
    const stale = await getStaleCache<StockPrice>(`price_${symbol}`);
    return stale;
  }
}

async function fetchTradingViewPrice(symbol: string): Promise<StockPrice | null> {
  try {
    const url = "https://scanner.tradingview.com/egypt/scan";
    const body = {
      symbols: {
        tickers: [`EGX:${symbol}`],
        query: { types: [] }
      },
      columns: ["close", "change", "volume", "open", "high", "low", "Perf.W", "Perf.1M"]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.data?.[0];

    if (result && result.d) {
      const [close, change, volume, open, high, low] = result.d;
      
      if (close && typeof close === "number") {
        const previousClose = change ? close - change : null;
        const changePercent = previousClose && previousClose > 0 ? (change / previousClose) * 100 : null;
        
        return {
          symbol,
          price: close,
          change: change || null,
          changePercent,
          previousClose,
          open: open || null,
          high: high || null,
          low: low || null,
          volume: volume || null,
          source: "TradingView",
        };
      }
    }

    return null;
  } catch (error) {
    console.error("TradingView fetch error:", error);
    return null;
  }
}

async function fetchCNBCPrice(symbol: string): Promise<StockPrice | null> {
  try {
    const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${symbol}-EG&requestMethod=itv&noCache=${Date.now()}&partnerId=2&fund=1&exthrs=1&output=json`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const quote = data?.FormattedQuoteResult?.FormattedQuote?.[0];

    if (quote && quote.last) {
      const price = parseFloat(quote.last);
      const change = quote.change ? parseFloat(quote.change) : null;
      const changePercent = quote.change_pct ? parseFloat(quote.change_pct) : null;
      const previousClose = quote.previous_day_closing ? parseFloat(quote.previous_day_closing) : null;
      const open = quote.open ? parseFloat(quote.open) : null;
      const high = quote.high ? parseFloat(quote.high) : null;
      const low = quote.low ? parseFloat(quote.low) : null;
      const volume = quote.volume ? parseFloat(quote.volume.replace(/,/g, "")) : null;

      if (!isNaN(price) && price > 0) {
        return {
          symbol,
          price,
          change,
          changePercent,
          previousClose,
          open,
          high,
          low,
          volume,
          source: "CNBC",
        };
      }
    }

    return null;
  } catch (error) {
    console.error("CNBC fetch error:", error);
    return null;
  }
}

async function fetchStockPrice(symbol: string): Promise<StockPrice> {
  // EODHD_API_TOKEN is assumed to be present and valid if not empty. If it is empty
  // or the API fails, fallbacks will be used.
  const isEodhdAvailable = !!EODHD_API_TOKEN;

  // Priority: EODHD (if available) → TradingView → CNBC → Stale Cache
  let priceData = isEodhdAvailable ? await fetchEODHDPrice(symbol) : null;

  if (!priceData) {
    priceData = await fetchTradingViewPrice(symbol);
  }

  if (!priceData) {
    priceData = await fetchCNBCPrice(symbol);
  }

  if (priceData) {
    return priceData;
  }

  // Last resort: use stale cache when all live sources failed
  const stale = await getStaleCache<StockPrice>(`price_${symbol}`);
  if (stale && stale.price) {
    return { ...stale, source: `${stale.source || "Cached"} (Stale)` };
  }

  return {
    symbol,
    price: null,
    change: null,
    changePercent: null,
    previousClose: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    error: "Price not available for this stock",
  };
}

interface HistoricalPriceData {
  date: string;
  close: number;
}

export async function fetchHistoricalPrices(symbol: string, days: number = 252): Promise<number[]> {
  try {
    // Check cache first
    const cached = await getCached<number[]>(`historical_${symbol}_${days}`);
    if (cached && cached.length > 0) {
      console.log(`Using cached historical prices for ${symbol} (${cached.length} data points)`);
      return cached;
    }

    // Calculate date range
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days - 30); // Add buffer

    const formatDate = (date: Date) => date.toISOString().split('T')[0];
    
    const url = `${EODHD_BASE_URL}/eod/${symbol}.EGX?api_token=${EODHD_API_TOKEN}&from=${formatDate(fromDate)}&to=${formatDate(toDate)}&fmt=json`;
    
    console.log(`Fetching EODHD historical prices for ${symbol} (${days} days)...`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.error(`EODHD historical fetch failed for ${symbol}: ${response.status}`);
      // Try to use stale cache if API fails
      const stale = await getStaleCache<number[]>(`historical_${symbol}_${days}`);
      if (stale && stale.length > 0) {
        console.log(`Using STALE cached historical prices for ${symbol}`);
        return stale;
      }
      return [];
    }

    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      // Extract close prices from EOD data
      const prices = data
        .map((item: any) => item.close ? parseFloat(item.close) : null)
        .filter((price: number | null) => price !== null && price > 0) as number[];

      if (prices.length > 0) {
        // Cache the successful response
        await setCache(`historical_${symbol}_${days}`, prices);
        console.log(`Cached ${prices.length} historical prices for ${symbol}`);
        return prices;
      }
    }

    // If EODHD fails, try stale cache
    const stale = await getStaleCache<number[]>(`historical_${symbol}_${days}`);
    if (stale && stale.length > 0) {
      console.log(`Using STALE cached historical prices for ${symbol}`);
      return stale;
    }

    return [];
  } catch (error) {
    console.error("Historical prices fetch error:", error);
    // Try to use stale cache on error
    const stale = await getStaleCache<number[]>(`historical_${symbol}_${days}`);
    if (stale && stale.length > 0) {
      console.log(`Using STALE cached historical prices for ${symbol} after error`);
      return stale;
    }
    return [];
  }
}

function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0.10): number | null {
  if (returns.length < 2) return null;
  
  // Convert annual risk-free rate to daily (assuming 252 trading days)
  const dailyRiskFreeRate = riskFreeRate / 252;
  
  // Calculate average return
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  
  // Calculate standard deviation
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return null;
  
  // Annualize the metrics
  const annualizedReturn = avgReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  
  // Sharpe Ratio = (Return - Risk-free Rate) / Standard Deviation
  const sharpeRatio = (annualizedReturn - riskFreeRate) / annualizedStdDev;
  
  return sharpeRatio;
}

function calculateSortinoRatio(returns: number[], riskFreeRate: number = 0.10): number | null {
  if (returns.length < 2) return null;
  
  // Convert annual risk-free rate to daily (assuming 252 trading days)
  const dailyRiskFreeRate = riskFreeRate / 252;
  
  // Calculate average return
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  
  // Calculate downside deviation (only negative returns)
  const downsideReturns = returns.filter(r => r < 0);
  
  if (downsideReturns.length === 0) {
    // If no negative returns, Sortino ratio is undefined or very high
    // Return a high positive value
    return 999;
  }
  
  const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / returns.length;
  const downsideDeviation = Math.sqrt(downsideVariance);
  
  if (downsideDeviation === 0) return null;
  
  // Annualize the metrics
  const annualizedReturn = avgReturn * 252;
  const annualizedDownsideDev = downsideDeviation * Math.sqrt(252);
  
  // Sortino Ratio = (Return - Risk-free Rate) / Downside Deviation
  const sortinoRatio = (annualizedReturn - riskFreeRate) / annualizedDownsideDev;
  
  return sortinoRatio;
}

async function fetchEODHDFundamentals(symbol: string): Promise<StockFinancials & { dividendYield?: number | null } | null> {
  try {
    // Check cache first
    const cached = await getCached<StockFinancials & { dividendYield?: number | null }>(`fundamentals_${symbol}`);
    if (cached) {
      return { ...cached, source: `${cached.source} (Cached)` };
    }

    // Note: Fundamentals API requires paid plan
    // With free plan (20 calls/day), we can only use EOD data
    // For now, skip EODHD fundamentals and let fallback sources handle it
    console.log(`EODHD fundamentals not available with free plan for ${symbol}, using fallbacks...`);
    return null;

    /* FUTURE: Enable when upgraded to paid plan
    const filter = "Highlights::EarningsShare,Highlights::PERatio,Highlights::BookValue,Highlights::DividendYield";
    const url = `${EODHD_BASE_URL}/fundamentals/${symbol}.EGX?api_token=${EODHD_API_TOKEN}&filter=${filter}&fmt=json`;
    
    console.log(`Fetching EODHD fundamentals for ${symbol}...`);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.error(`EODHD fundamentals fetch failed for ${symbol}: ${response.status}`);
      const stale = await getStaleCache<StockFinancials & { dividendYield?: number | null }>(`fundamentals_${symbol}`);
      return stale;
    }

    const data = await response.json();

    if (data && data.Highlights) {
      const highlights = data.Highlights;
      const eps = highlights.EarningsShare ? parseFloat(highlights.EarningsShare) : null;
      const peRatio = highlights.PERatio ? parseFloat(highlights.PERatio) : null;
      const bookValue = highlights.BookValue ? parseFloat(highlights.BookValue) : null;
      const dividendYield = highlights.DividendYield ? parseFloat(highlights.DividendYield) * 100 : null;

      if (eps || peRatio) {
        const fundamentals = {
          eps,
          peRatio,
          bookValue,
          dividendYield,
          recommendation: null,
          source: "EODHD",
        };

        await setCache(`fundamentals_${symbol}`, fundamentals);
        return fundamentals;
      }
    }

    const stale = await getStaleCache<StockFinancials & { dividendYield?: number | null }>(`fundamentals_${symbol}`);
    return stale;
    */
  } catch (error) {
    console.error("EODHD fundamentals fetch error:", error);
    const stale = await getStaleCache<StockFinancials & { dividendYield?: number | null }>(`fundamentals_${symbol}`);
    return stale;
  }
}

async function fetchTradingViewFinancials(symbol: string): Promise<StockFinancials & { dividendYield?: number | null } | null> {
  try {
    const url = "https://scanner.tradingview.com/egypt/scan";
    const body = {
      symbols: {
        tickers: [`EGX:${symbol}`],
        query: { types: [] }
      },
      columns: [
        "name",
        "close",
        "earnings_per_share_basic_ttm",
        "price_earnings_ttm",
        "dividend_yield_recent",
        "price_book_ratio",
        "market_cap_basic",
        "Recommend.All"
      ]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) return null;

    const data = await response.json();
    const result = data?.data?.[0];

    if (result && result.d) {
      const [name, closePrice, eps, pe, divYield, pbRatio, marketCap, recommend] = result.d;
      
      let bookValue: number | null = null;
      if (pbRatio && typeof pbRatio === "number" && closePrice && typeof closePrice === "number" && pbRatio > 0) {
        bookValue = closePrice / pbRatio;
      }

      console.log(`TradingView ${symbol}: EPS=${eps}, P/E=${pe}, DivYield=${divYield}%`);

      return {
        eps: eps && typeof eps === "number" ? eps : null,
        peRatio: pe && typeof pe === "number" ? pe : null,
        bookValue,
        recommendation: recommend && typeof recommend === "number" ? recommend : null,
        dividendYield: divYield && typeof divYield === "number" ? divYield : null,
        source: "TradingView (Live)",
      };
    }

    return null;
  } catch (error) {
    console.error("TradingView financials error:", error);
    return null;
  }
}

async function fetchMubasherFinancials(symbol: string): Promise<StockFinancials | null> {
  try {
    const url = `https://english.mubasher.info/api/1/listed-company/${symbol}/overview?country=eg`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
    });

    if (!response.ok) return null;

    const data = await response.json();

    if (data) {
      const eps = data.eps || data.earningsPerShare || null;
      const peRatio = data.pe || data.priceEarnings || null;
      const bookValue = data.bookValue || data.bookValuePerShare || null;

      if (eps || peRatio || bookValue) {
        return {
          eps: eps ? parseFloat(eps) : null,
          peRatio: peRatio ? parseFloat(peRatio) : null,
          bookValue: bookValue ? parseFloat(bookValue) : null,
          recommendation: null,
          source: "Mubasher",
        };
      }
    }

    return null;
  } catch (error) {
    console.error("Mubasher fetch error:", error);
    return null;
  }
}

async function fetchStockFinancials(symbol: string): Promise<StockFinancials & { dividendYield?: number | null }> {
  // EODHD_API_TOKEN is assumed to be present and valid if not empty. If it is empty
  // or the API fails, fallbacks will be used.
  const isEodhdAvailable = !!EODHD_API_TOKEN;

  // Priority: EODHD (if available) → TradingView → Mubasher → EGX Static → Stale Cache

  // Try EODHD first (includes caching)
  let eodhd = isEodhdAvailable ? await fetchEODHDFundamentals(symbol) : null;
  if (eodhd && (eodhd.eps || eodhd.peRatio)) {
    console.log(`Using EODHD data for ${symbol}: EPS=${eodhd.eps}, P/E=${eodhd.peRatio}, DY=${eodhd.dividendYield}%`);
    return eodhd;
  }

  // Fallback to TradingView
  let tradingViewData = await fetchTradingViewFinancials(symbol);
  if (tradingViewData && (tradingViewData.eps || tradingViewData.peRatio)) {
    console.log(`Using LIVE TradingView data for ${symbol}: EPS=${tradingViewData.eps}, P/E=${tradingViewData.peRatio}, DY=${tradingViewData.dividendYield}%`);
    return tradingViewData;
  }

  // Build result combining available data with fallbacks
  const result: StockFinancials & { dividendYield?: number | null } = {
    eps: null,
    peRatio: null,
    bookValue: tradingViewData?.bookValue || eodhd?.bookValue || null,
    recommendation: tradingViewData?.recommendation || null,
    dividendYield: tradingViewData?.dividendYield || eodhd?.dividendYield || null,
    source: tradingViewData?.dividendYield ? "TradingView (Live)" : undefined,
  };

  // Fallback: Mubasher for EPS/P/E
  const mubasherData = await fetchMubasherFinancials(symbol);
  if (mubasherData && (mubasherData.eps || mubasherData.peRatio)) {
    console.log(`Using Mubasher data for ${symbol} EPS/P/E`);
    result.eps = mubasherData.eps;
    result.peRatio = mubasherData.peRatio;
    result.bookValue = result.bookValue || mubasherData.bookValue;
    result.source = "Mubasher + TradingView";
    return result;
  }

  // Fallback: Static EGX cache for EPS/P/E
  const egxData = await fetchEGXFinancialData();
  const egxFinancials = egxData.get(symbol);

  if (egxFinancials) {
    console.log(`Using EGX cache for ${symbol}: P/E=${egxFinancials.peRatio}, DY from TradingView=${result.dividendYield}%`);
    if (!result.peRatio && egxFinancials.peRatio && egxFinancials.peRatio > 0) {
      result.peRatio = egxFinancials.peRatio;
    }
    // Only use cached dividend yield if TradingView didn't provide one
    if (!result.dividendYield && egxFinancials.dividendYield !== null) {
      result.dividendYield = egxFinancials.dividendYield;
    }
    if (!result.eps && (egxFinancials as any).eps && (egxFinancials as any).eps > 0) {
      result.eps = (egxFinancials as any).eps;
    }
    result.source = result.dividendYield ? "EGX (Cached) + TradingView (Live DY)" : "EGX (Cached)";
  }

  return result;
}

// ARCH-07/08: Orchestrated pipeline adapter — maps PipelineResult to StockAnalysis
// TODO: Remove this flag and old path after 2 weeks validation (pitfall M5)
async function runOrchestratedPipeline(
  symbol: string,
  price: StockPrice,
  financials: StockFinancials & { dividendYield?: number | null },
  refresh: boolean
): Promise<StockAnalysis> {
  const input: DataAgentInput = { symbol, price, financials, refresh };
  const result: PipelineResult = await orchestrator.run(input);

  const { dataOutput, analysisOutput, decisionOutput } = result;
  const cf = dataOutput.computedFields;

  if (analysisOutput) {
    return {
      symbol,
      currentPrice: price.price,
      eps: cf.eps,
      peRatio: cf.peRatio,
      bookValue: cf.bookValue,
      priceToBook: cf.priceToBook,
      fiftyTwoWeekLow: null,
      fiftyTwoWeekHigh: null,
      fiftyDayAvg: null,
      twoHundredDayAvg: null,
      dividendYield: cf.dividendYield,
      fairValuePE: null,
      fairValueGraham: null,
      fairValueAvg: analysisOutput.fairValueEstimate,
      strongBuyZone: analysisOutput.strongBuyZone,
      buyZone: analysisOutput.buyZone,
      holdZone: analysisOutput.holdZone,
      sellZone: analysisOutput.sellZone,
      strongSellZone: analysisOutput.strongSellZone,
      firstTarget: analysisOutput.firstTarget,
      secondTarget: analysisOutput.secondTarget,
      thirdTarget: analysisOutput.thirdTarget,
      recommendation: decisionOutput.finalRecommendation,
      sharpeRatio: cf.sharpeRatio,
      sortinoRatio: cf.sortinoRatio,
      dataAvailable: price.price !== null || cf.eps !== null || cf.peRatio !== null,
      priceSource: price.source,
      financialsSource: financials.source,
      geminiReasoning: analysisOutput.reasoning,
      geminiConfidence: decisionOutput.adjustedConfidence,
      geminiRiskLevel: analysisOutput.riskLevel,
      geminiKeyPoints: analysisOutput.keyPoints,
      analysisMethod: 'Gemini AI (Orchestrated)',
      valuationStatus: analysisOutput.valuationStatus,
      simpleExplanation: analysisOutput.simpleExplanation,
      riskSignals: analysisOutput.riskSignals,
      criticFeedback: decisionOutput.criticFeedback ?? undefined,
    };
  }

  // Fallback — Gemini unavailable
  const fallbackAnalysis = createFallbackAnalysis(symbol, price.price || 0, cf.eps, cf.peRatio, cf.bookValue, cf.dividendYield, cf.sharpeRatio, cf.sortinoRatio);
  return {
    symbol,
    currentPrice: price.price,
    eps: cf.eps,
    peRatio: cf.peRatio,
    bookValue: cf.bookValue,
    priceToBook: cf.priceToBook,
    fiftyTwoWeekLow: null,
    fiftyTwoWeekHigh: null,
    fiftyDayAvg: null,
    twoHundredDayAvg: null,
    dividendYield: cf.dividendYield,
    fairValuePE: null,
    fairValueGraham: null,
    fairValueAvg: fallbackAnalysis.fairValueEstimate,
    strongBuyZone: fallbackAnalysis.strongBuyZone,
    buyZone: fallbackAnalysis.buyZone,
    holdZone: fallbackAnalysis.holdZone,
    sellZone: fallbackAnalysis.sellZone,
    strongSellZone: fallbackAnalysis.strongSellZone,
    firstTarget: fallbackAnalysis.firstTarget,
    secondTarget: fallbackAnalysis.secondTarget,
    thirdTarget: fallbackAnalysis.thirdTarget,
    recommendation: fallbackAnalysis.recommendation,
    sharpeRatio: cf.sharpeRatio,
    sortinoRatio: cf.sortinoRatio,
    dataAvailable: price.price !== null || cf.eps !== null || cf.peRatio !== null,
    priceSource: price.source,
    financialsSource: financials.source,
    analysisMethod: 'Formula (Orchestrated Fallback)',
  };
}

async function calculateAnalysis(
  symbol: string,
  price: StockPrice,
  financials: StockFinancials & { dividendYield?: number | null },
  refresh: boolean = false
): Promise<StockAnalysis> {
  // ARCH-08: Feature flag — USE_ORCHESTRATOR=true routes through new pipeline
  // TODO: Remove this flag and old path after 2 weeks validation (pitfall M5)
  if (process.env.USE_ORCHESTRATOR === 'true') {
    return runOrchestratedPipeline(symbol, price, financials, refresh);
  }

  const currentPrice = price.price;
  // Derive EPS from P/E and price if EPS is missing but P/E is available
  const eps = financials.eps || (financials.peRatio && currentPrice && financials.peRatio > 0 ? currentPrice / financials.peRatio : null);
  const peRatio = financials.peRatio;
  const bookValue = financials.bookValue;
  const dividendYield = financials.dividendYield || null;
  const priceToBook = bookValue && currentPrice ? currentPrice / bookValue : null;

  // Calculate Sharpe and Sortino Ratios
  let sharpeRatio: number | null = null;
  let sortinoRatio: number | null = null;
  let historicalPrices: number[] = [];
  
  try {
    historicalPrices = await fetchHistoricalPrices(symbol, 252);
    if (historicalPrices.length > 1) {
      const returns = calculateReturns(historicalPrices);
      if (returns.length > 0) {
        sharpeRatio = calculateSharpeRatio(returns, 0.10);
        sortinoRatio = calculateSortinoRatio(returns, 0.10);
      }
    }
  } catch (error) {
    console.error(`Error calculating risk ratios for ${symbol}:`, error);
  }

  // Calculate price changes for context
  let priceChange30d: number | null = null;
  let priceChange90d: number | null = null;
  if (historicalPrices.length > 30 && currentPrice) {
    const price30dAgo = historicalPrices[historicalPrices.length - 30];
    priceChange30d = ((currentPrice - price30dAgo) / price30dAgo) * 100;
  }
  if (historicalPrices.length > 90 && currentPrice) {
    const price90dAgo = historicalPrices[historicalPrices.length - 90];
    priceChange90d = ((currentPrice - price90dAgo) / price90dAgo) * 100;
  }

  // Fetch market sentiment (FinBERT on recent news) for AI context
  const sentiment = await fetchSentimentForSymbol(symbol);

  // Prepare data for Gemini AI analysis
  const stockDataForAI: StockDataForAI = {
    symbol,
    companyName: EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol,
    currentPrice: currentPrice || 0,
    volume: price.volume,
    eps,
    peRatio,
    bookValue,
    priceToBook,
    dividendYield,
    sharpeRatio,
    sortinoRatio,
    historicalPrices: historicalPrices.slice(-60),
    priceChange30d,
    priceChange90d,
    priceSource: price.source,
    fundamentalsSource: financials.source,
    ...(sentiment && sentiment.length > 0 && { sentiment }),
  };

  // MEM-04: Fetch relevant episodic context BEFORE calling Gemini
  // macroRegime is null in Phase 1 (classifier added Phase 3/4)
  let episodicContext: string | undefined;
  try {
    const relevantEpisodes = await memoryService.getRelevantEpisodes(symbol, null, 3);
    if (relevantEpisodes.length > 0) {
      episodicContext = relevantEpisodes
        .map((ep, i) => {
          const dateStr = ep.createdAt ? ep.createdAt.toISOString().split('T')[0] : 'unknown';
          return `${i + 1}. [${dateStr}] ${ep.symbol} — ${ep.context}: ${ep.lesson}`;
        })
        .join('\n');
    }
  } catch (e) {
    console.warn('Memory episodic fetch failed (non-fatal):', e);
  }

  // Try Gemini AI analysis first
  console.log(`Attempting Gemini AI analysis for ${symbol}...${refresh ? ' (refresh requested)' : ''}`);
  const geminiAnalysis = await analyzeStockWithGemini(stockDataForAI, refresh, episodicContext);

  // CRIT-01/02/03/04/05: Adversarial critique — runs after Gemini, before response
  let criticFeedback: CriticFeedback | null = null;
  if (geminiAnalysis) {
    criticFeedback = await criticAgent.critique(geminiAnalysis, stockDataForAI);
  }

  // CRIT-06: Adjust confidence based on critic severity
  const adjustedConfidence = (geminiAnalysis && criticFeedback)
    ? applyConfidenceDiscount(geminiAnalysis.confidence, criticFeedback.severity)
    : geminiAnalysis?.confidence ?? undefined;

  // MEM-01: Log decision to memory AFTER analysis, fire-and-forget (don't block response)
  if (geminiAnalysis) {
    setImmediate(() => {
      const inputsHash = createHash('sha256')
        .update(JSON.stringify({
          symbol: stockDataForAI.symbol,
          price: stockDataForAI.currentPrice,
          eps: stockDataForAI.eps,
          peRatio: stockDataForAI.peRatio,
        }))
        .digest('hex')
        .slice(0, 16);

      memoryService.saveDecision({
        symbol,
        decisionType: 'stock',
        recommendation: geminiAnalysis.recommendation,
        confidence: adjustedConfidence ?? geminiAnalysis.confidence,
        reasoning: geminiAnalysis.reasoning.slice(0, 2000),
        inputsHash,
        fairValue: geminiAnalysis.fairValueEstimate ?? null,
        priceAtRec: stockDataForAI.currentPrice,
        criticWeakness: criticFeedback?.weakness ?? null,
        criticSeverity: criticFeedback?.severity ?? null,
        criticBlocking: criticFeedback?.blockingIssues ?? null,
      }).catch(e => console.error('Memory saveDecision failed:', e));
    });
  }

  if (geminiAnalysis) {
    console.log(`Using Gemini AI analysis for ${symbol}: ${geminiAnalysis.recommendation}`);
    
    return {
      symbol,
      currentPrice,
      eps,
      peRatio,
      bookValue,
      priceToBook,
      fiftyTwoWeekLow: null,
      fiftyTwoWeekHigh: null,
      fiftyDayAvg: null,
      twoHundredDayAvg: null,
      dividendYield,
      fairValuePE: null,
      fairValueGraham: null,
      fairValueAvg: geminiAnalysis.fairValueEstimate,
      strongBuyZone: geminiAnalysis.strongBuyZone,
      buyZone: geminiAnalysis.buyZone,
      holdZone: geminiAnalysis.holdZone,
      sellZone: geminiAnalysis.sellZone,
      strongSellZone: geminiAnalysis.strongSellZone,
      firstTarget: geminiAnalysis.firstTarget,
      secondTarget: geminiAnalysis.secondTarget,
      thirdTarget: geminiAnalysis.thirdTarget,
      recommendation: geminiAnalysis.recommendation,
      sharpeRatio,
      sortinoRatio,
      dataAvailable: currentPrice !== null || eps !== null || peRatio !== null,
      priceSource: price.source,
      financialsSource: financials.source,
      geminiReasoning: geminiAnalysis.reasoning,
      geminiConfidence: adjustedConfidence,   // CRIT-06: confidence discount applied when critic runs
      geminiRiskLevel: geminiAnalysis.riskLevel,
      geminiKeyPoints: geminiAnalysis.keyPoints,
      analysisMethod: "Gemini AI",
      valuationStatus: geminiAnalysis.valuationStatus,
      simpleExplanation: geminiAnalysis.simpleExplanation,
      riskSignals: geminiAnalysis.riskSignals,
      criticFeedback: criticFeedback ?? undefined,
    };
  }

  // Fallback to formula-based analysis
  console.log(`Gemini unavailable for ${symbol}, using formula-based fallback`);
  const fallbackAnalysis = createFallbackAnalysis(
    symbol,
    currentPrice || 0,
    eps,
    peRatio,
    bookValue,
    dividendYield,
    sharpeRatio,
    sortinoRatio
  );

  return {
    symbol,
    currentPrice,
    eps,
    peRatio,
    bookValue,
    priceToBook,
    fiftyTwoWeekLow: null,
    fiftyTwoWeekHigh: null,
    fiftyDayAvg: null,
    twoHundredDayAvg: null,
    dividendYield,
    fairValuePE: null,
    fairValueGraham: null,
    fairValueAvg: fallbackAnalysis.fairValueEstimate,
    strongBuyZone: fallbackAnalysis.strongBuyZone,
    buyZone: fallbackAnalysis.buyZone,
    holdZone: fallbackAnalysis.holdZone,
    sellZone: fallbackAnalysis.sellZone,
    strongSellZone: fallbackAnalysis.strongSellZone,
    firstTarget: fallbackAnalysis.firstTarget,
    secondTarget: fallbackAnalysis.secondTarget,
    thirdTarget: fallbackAnalysis.thirdTarget,
    recommendation: fallbackAnalysis.recommendation,
    sharpeRatio,
    sortinoRatio,
    dataAvailable: currentPrice !== null || eps !== null || peRatio !== null,
    priceSource: price.source,
    financialsSource: financials.source,
    geminiReasoning: fallbackAnalysis.reasoning,
    geminiConfidence: fallbackAnalysis.confidence,
    geminiRiskLevel: fallbackAnalysis.riskLevel,
    geminiKeyPoints: fallbackAnalysis.keyPoints,
    analysisMethod: fallbackAnalysis.analysisMethod,
    valuationStatus: fallbackAnalysis.valuationStatus,
    simpleExplanation: fallbackAnalysis.simpleExplanation,
    riskSignals: fallbackAnalysis.riskSignals,
  };
}

interface NewsItem {
  date: string;
  title: string;
  content: string;
  source: string;
}

export interface SentimentResult {
  score: "Bullish" | "Bearish" | "Neutral";
  bullishScore: number;
  bearishScore: number;
  neutralScore: number;
  headlines: { title: string; sentiment: string; score: number; source: string }[];
}

async function fetchGoogleNews(query: string): Promise<NewsItem[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const response = await fetch(url);
    if (!response.ok) return [];
    
    const xml = await response.text();
    
    // Very basic regex to extract titles and pubDates from RSS XML
    // Since we just need the text for sentiment analysis, regex is fine here without a full XML parser
    const items: NewsItem[] = [];
    const itemRegex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<pubDate>(.*?)<\/pubDate>[\s\S]*?<\/item>/gi;
    
    let match;
    let count = 0;
    while ((match = itemRegex.exec(xml)) !== null && count < 5) {
      // Decode HTML entities (basic ones)
      const title = match[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
        
      items.push({
        date: new Date(match[2]).toISOString(),
        title: title,
        content: title, // Google RSS description is messy HTML, title is better for FinBERT
        source: "Google News"
      });
      count++;
    }
    
    return items;
  } catch (error) {
    console.error("Google News error:", error);
    return [];
  }
}

async function fetchEODHDNews(symbol: string): Promise<NewsItem[]> {
  try {
    const url = `${EODHD_BASE_URL}/news?s=${symbol}.EGX&api_token=${EODHD_API_TOKEN}&limit=5&fmt=json`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    
    // Fallback if EODHD fails (e.g. rate limit)
    if (!response.ok) {
      console.log(`EODHD failed for ${symbol}, falling back to Google News`);
      return await fetchGoogleNews(`${symbol} OR "${EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol}" Egypt stock`);
    }
    
    const text = await response.text();
    if (text.includes("exceeded your daily API requests limit") || text.includes("error")) {
      console.log(`EODHD rate limit hit for ${symbol}, falling back to Google News`);
      return await fetchGoogleNews(`${symbol} OR "${EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol}" Egypt stock`);
    }
    
    const data = JSON.parse(text);
    if (!data || data.length === 0) {
      return await fetchGoogleNews(`${symbol} OR "${EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol}" Egypt stock`);
    }
    
    return data.map((item: any) => ({
      date: item.date,
      title: item.title,
      content: item.content,
      source: "EODHD"
    }));
  } catch (error) {
    console.error("EODHD news error:", error);
    return await fetchGoogleNews(`${symbol} OR "${EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol}" Egypt stock`);
  }
}

const MACRO_RSS_FEEDS: { url: string; name: string }[] = [
  { url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", name: "BBC Middle East" },
  { url: "https://feeds.bbci.co.uk/news/world/africa/rss.xml", name: "BBC Africa" },
  { url: "https://feeds.bbci.co.uk/news/business/rss.xml", name: "BBC Business" },
];

function stripCdata(s: string): string {
  if (!s) return "";
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

async function fetchRssFeed(feedUrl: string, sourceName: string, maxItems: number): Promise<NewsItem[]> {
  try {
    const response = await fetch(feedUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return [];
    const xml = await response.text();
    const items: NewsItem[] = [];
    const itemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?(?:<pubDate>(.*?)<\/pubDate>|<dc:date>(.*?)<\/dc:date>)[\s\S]*?<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < maxItems) {
      let title = (match[1] || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      title = stripCdata(title).trim();
      const dateStr = match[2] || match[3] || "";
      items.push({
        date: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
        title,
        content: title,
        source: sourceName,
      });
    }
    return items;
  } catch (error) {
    console.error(`RSS feed ${sourceName} error:`, error);
    return [];
  }
}

async function fetchMacroNews(): Promise<NewsItem[]> {
  const allItems: NewsItem[] = [];

  try {
    const url = `${EODHD_BASE_URL}/news?t=egypt&api_token=${EODHD_API_TOKEN}&limit=5&fmt=json`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (response.ok) {
      const text = await response.text();
      if (!text.includes("exceeded your daily API requests limit") && !text.includes("error")) {
        try {
          const data = JSON.parse(text);
          if (Array.isArray(data) && data.length > 0) {
            data.forEach((item: any) => allItems.push({
              date: item.date,
              title: item.title,
              content: item.content || item.title,
              source: "EODHD",
            }));
          }
        } catch {}
      }
    }
  } catch {}

  const rssResults = await Promise.all(
    MACRO_RSS_FEEDS.map((f) => fetchRssFeed(f.url, f.name, 5))
  );
  rssResults.forEach((items) => allItems.push(...items));

  const seen = new Set<string>();
  const deduped = allItems
    .filter((item) => {
      const key = item.title.toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 15);

  if (deduped.length === 0) {
    return await fetchGoogleNews("Middle East OR Egypt OR Africa economy");
  }
  return deduped;
}

async function analyzeSentimentWithFinBERT(newsItems: NewsItem[]): Promise<SentimentResult | null> {
  if (newsItems.length === 0) return null;
  
  try {
    // HF Inference API for FinBERT
    const API_URL = "https://router.huggingface.co/hf-inference/models/ProsusAI/finbert";
    
    const inputs = newsItems.map(item => item.title);
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (process.env.HUGGINGFACE_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.HUGGINGFACE_API_KEY}`;
    }
    
    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs,
        parameters: { top_k: 3, function_to_apply: "softmax" },
      }),
    });
    
    if (!response.ok) {
      console.error("HuggingFace API error:", await response.text());
      return null;
    }
    
    const results = await response.json();
    
    if (results.error) {
       console.error("HF returned error:", results.error);
       return null;
    }
    
    let totalBullish = 0;
    let totalBearish = 0;
    let totalNeutral = 0;
    
    const headlines = [];
    
    for (let i = 0; i < results.length; i++) {
      const scores = results[i];
      const pos = scores.find((s: any) => s.label === "positive")?.score || 0;
      const neg = scores.find((s: any) => s.label === "negative")?.score || 0;
      const neu = scores.find((s: any) => s.label === "neutral")?.score || 0;
      
      totalBullish += pos;
      totalBearish += neg;
      totalNeutral += neu;
      
      let sentiment = "Neutral";
      let highestScore = neu;
      if (pos > neg && pos > neu) { sentiment = "Bullish"; highestScore = pos; }
      else if (neg > pos && neg > neu) { sentiment = "Bearish"; highestScore = neg; }
      
      headlines.push({
        title: newsItems[i].title,
        source: newsItems[i].source,
        sentiment,
        score: highestScore
      });
    }
    
    const count = results.length;
    const avgBullish = totalBullish / count;
    const avgBearish = totalBearish / count;
    const avgNeutral = totalNeutral / count;
    
    let finalScore: "Bullish" | "Bearish" | "Neutral" = "Neutral";
    // Adjust thresholds for general sentiment
    if (avgBullish > 0.40 && avgBullish > avgBearish) finalScore = "Bullish";
    else if (avgBearish > 0.40 && avgBearish > avgBullish) finalScore = "Bearish";
    
    return {
      score: finalScore,
      bullishScore: avgBullish,
      bearishScore: avgBearish,
      neutralScore: avgNeutral,
      headlines
    };
    
  } catch (error) {
    console.error("Sentiment analysis error:", error);
    return null;
  }
}

/** Raw FinBERT response per headline - no aggregation. Used by AI analysis flows. */
export interface RawSentimentItem {
  title: string;
  source: string;
  scores: { label: string; score: number }[];
}

async function fetchRawFinBERTResponse(newsItems: NewsItem[]): Promise<RawSentimentItem[] | null> {
  if (newsItems.length === 0) return null;
  try {
    const API_URL = "https://router.huggingface.co/hf-inference/models/ProsusAI/finbert";
    const inputs = newsItems.map((item) => item.title);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (process.env.HUGGINGFACE_API_KEY) headers["Authorization"] = `Bearer ${process.env.HUGGINGFACE_API_KEY}`;
    const response = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ inputs, parameters: { top_k: 3, function_to_apply: "softmax" } }),
    });
    if (!response.ok) return null;
    const results = await response.json();
    if (results.error) return null;
    return newsItems.map((item, i) => ({
      title: item.title,
      source: item.source,
      scores: Array.isArray(results[i]) ? results[i] : [],
    }));
  } catch {
    return null;
  }
}

/** Fetch raw FinBERT response for a symbol. Used by AI - no aggregation. */
export async function fetchSentimentForSymbol(symbol: string): Promise<RawSentimentItem[] | null> {
  try {
    const microNews = await fetchEODHDNews(symbol.toUpperCase());
    const macroNews = await fetchMacroNews();
    const allNews = [...microNews.slice(0, 5), ...macroNews.slice(0, 5)];
    return await fetchRawFinBERTResponse(allNews);
  } catch {
    return null;
  }
}

/** Fetch raw FinBERT response for a portfolio. Used by AI - no aggregation. */
export async function fetchSentimentForPortfolio(symbols: string[]): Promise<RawSentimentItem[] | null> {
  try {
    const macroNews = await fetchMacroNews();
    let allNews = [...macroNews.slice(0, 4)];
    for (const symbol of symbols.slice(0, 5)) {
      const microNews = await fetchEODHDNews(symbol.toUpperCase());
      allNews = [...allNews, ...microNews.slice(0, 2)];
    }
    return await fetchRawFinBERTResponse(allNews);
  } catch {
    return null;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/api/prices/:symbol", async (req, res) => {
    const { symbol } = req.params;

    try {
      const priceData = await fetchStockPrice(symbol.toUpperCase());
      res.json(priceData);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch price" });
    }
  });

  app.post("/api/prices/batch", async (req, res) => {
    const { symbols } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: "symbols array required" });
    }

    try {
      const prices = await Promise.all(
        symbols.slice(0, 20).map((s: string) => fetchStockPrice(s.toUpperCase()))
      );
      res.json({ prices });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch prices" });
    }
  });

  app.get("/api/analysis/:symbol", async (req, res) => {
    const { symbol } = req.params;
    const refresh = req.query.refresh === "true";

    try {
      const [priceData, financials] = await Promise.all([
        fetchStockPrice(symbol.toUpperCase()),
        fetchStockFinancials(symbol.toUpperCase()),
      ]);

      const analysis = await calculateAnalysis(symbol.toUpperCase(), priceData, financials, refresh);
      res.json(analysis);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch analysis" });
    }
  });

  app.get("/api/stock/:symbol/summary", async (req, res) => {
    const { symbol } = req.params;
    const refresh = req.query.refresh === "true";
    const symbolUpper = symbol.toUpperCase();

    const validSymbols = new Set([
      ...Object.keys(EGX_PE_DATA),
      ...Object.values(EGX_COMPANY_SYMBOL_MAP),
    ]);
    if (!validSymbols.has(symbolUpper)) {
      return res.status(400).json({ error: "Unknown EGX symbol" });
    }

    try {
      const [priceData, financials] = await Promise.all([
        fetchStockPrice(symbolUpper),
        fetchStockFinancials(symbolUpper),
      ]);

      const analysis = await calculateAnalysis(symbolUpper, priceData, financials, refresh);

      let cacheTimestamp: number | null = null;
      const cacheEntry = await getCacheEntry(`gemini_analysis_${symbolUpper}`);
      if (cacheEntry) {
        cacheTimestamp = cacheEntry.timestamp;
      }

      const companyName = EGX_COMPANY_SYMBOL_MAP_REVERSE[symbolUpper] || symbolUpper;
      const summary = deriveStockSummary(
        symbolUpper,
        companyName,
        {
          symbol: analysis.symbol,
          currentPrice: analysis.currentPrice,
          fairValueAvg: analysis.fairValueAvg,
          recommendation: analysis.recommendation,
          priceSource: analysis.priceSource,
          geminiConfidence: analysis.geminiConfidence,
          geminiRiskLevel: analysis.geminiRiskLevel,
          geminiReasoning: analysis.geminiReasoning,
          valuationStatus: (analysis as { valuationStatus?: "Undervalued" | "Fair" | "Overvalued" }).valuationStatus,
          simpleExplanation: (analysis as { simpleExplanation?: string[] }).simpleExplanation,
          strongBuyZone: analysis.strongBuyZone,
          buyZone: analysis.buyZone,
          holdZone: analysis.holdZone,
          sellZone: analysis.sellZone,
          strongSellZone: analysis.strongSellZone,
        },
        priceData,
        cacheTimestamp
      );

      res.json(summary);
    } catch (error) {
      console.error(`Summary error for ${symbolUpper}:`, error);
      res.status(500).json({ error: "Failed to fetch summary" });
    }
  });

  app.post("/api/reset-portfolio", async (req, res) => {
    try {
      res.json({ success: true, message: "Portfolio reset triggered on client" });
    } catch (error) {
      res.status(500).json({ error: "Failed to reset portfolio" });
    }
  });

  app.post("/api/extract-transactions", async (req, res) => {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "image (base64) required" });
    }

    try {
      // Remove data:image/png;base64, prefix if present
      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      
      const transactions = await extractTransactionsFromImage(base64Data);
      res.json({ transactions });
    } catch (error) {
      console.error("Transaction extraction error:", error);
      res.status(500).json({ error: "Failed to extract transactions from image" });
    }
  });

  app.post("/api/extract-dividend", async (req, res) => {
    const { image } = req.body;

    if (!image) {
      return res.status(400).json({ error: "image (base64) required" });
    }

    try {
      const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
      const dividend = await extractDividendFromImage(base64Data);
      res.json({ dividend });
    } catch (error) {
      console.error("Dividend extraction error:", error);
      res.status(500).json({ error: "Failed to extract dividend from image" });
    }
  });

  app.post("/api/portfolio-analysis", async (req, res) => {
    const portfolioData: PortfolioAnalysisRequest = req.body;

    if (!portfolioData || !portfolioData.holdings || portfolioData.holdings.length === 0) {
      return res.status(400).json({ error: "Portfolio holdings data required" });
    }

    try {
      const symbols = portfolioData.holdings.map((h: any) => h.symbol);
      const sentiment = await fetchSentimentForPortfolio(symbols);
      if (sentiment && sentiment.length > 0) portfolioData.sentiment = sentiment;

      const analysis = await analyzePortfolioWithGemini(portfolioData);
      if (analysis) {
        res.json(analysis);
      } else {
        res.status(503).json({ error: "AI analysis unavailable. Check Gemini API key." });
      }
    } catch (error) {
      console.error("Portfolio analysis error:", error);
      res.status(500).json({ error: "Failed to analyze portfolio" });
    }
  });

  app.post("/api/deploy-capital", async (req, res) => {
    const data: DeployCapitalRequest = req.body;

    if (!data || !data.portfolio || !data.amountToDeployEGP) {
      return res.status(400).json({ error: "Portfolio data and amount required" });
    }

    try {
      const portfolioSymbols = data.portfolio.holdings.map((h: any) => h.symbol);
      const sentiment = await fetchSentimentForPortfolio(portfolioSymbols);
      if (sentiment && sentiment.length > 0) data.portfolio.sentiment = sentiment;

      // Fetch real-time prices for major EGX stocks so Gemini uses actual market data
      const majorSymbols = Object.values(EGX_COMPANY_SYMBOL_MAP);
      const allSymbols = [...new Set([...majorSymbols, ...portfolioSymbols])];

      const marketPrices: Record<string, number> = {};
      await Promise.all(
        allSymbols.map(async (symbol) => {
          try {
            const priceData = await fetchStockPrice(symbol);
            if (priceData.price) {
              marketPrices[symbol] = priceData.price;
            }
          } catch {}
        })
      );

      const recommendation = await deployCapitalWithGemini(data, marketPrices);
      if (recommendation) {
        // Save to recommendation history
        try {
          const historyEntry = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            amountToDeployEGP: data.amountToDeployEGP,
            result: recommendation,
            portfolioSnapshot: data.portfolio.holdings.map(h => ({
              symbol: h.symbol,
              nameEn: h.nameEn,
              shares: h.shares,
              averageCost: h.averageCost,
              currentPrice: h.currentPrice,
              weight: h.weight,
              sector: h.sector,
              role: h.role,
            })),
          };
          const historyPath = path.join(process.cwd(), "server", ".api-cache", "recommendation_history.json");
          let history: any[] = [];
          if (fs.existsSync(historyPath)) {
            try { history = JSON.parse(fs.readFileSync(historyPath, "utf-8")); } catch {}
          }
          history.unshift(historyEntry);
          fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
          console.log(`Saved recommendation history entry ${historyEntry.id}`);
        } catch (err) {
          console.error("Failed to save recommendation history:", err);
        }
        res.json(recommendation);
      } else {
        res.status(503).json({ error: "AI analysis unavailable. Check Gemini API key." });
      }
    } catch (error) {
      console.error("Deploy capital error:", error);
      res.status(500).json({ error: "Failed to get deployment recommendation" });
    }
  });

  // Recommendation History endpoints
  app.get("/api/recommendation-history", async (_req, res) => {
    try {
      const historyPath = path.join(process.cwd(), "server", ".api-cache", "recommendation_history.json");
      if (!fs.existsSync(historyPath)) {
        return res.json([]);
      }
      const history = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      res.json(history);
    } catch (error) {
      console.error("Failed to read recommendation history:", error);
      res.status(500).json({ error: "Failed to read history" });
    }
  });

  app.delete("/api/recommendation-history/:id", async (req, res) => {
    try {
      const historyPath = path.join(process.cwd(), "server", ".api-cache", "recommendation_history.json");
      if (!fs.existsSync(historyPath)) {
        return res.status(404).json({ error: "No history found" });
      }
      let history: any[] = JSON.parse(fs.readFileSync(historyPath, "utf-8"));
      const before = history.length;
      history = history.filter((entry: any) => entry.id !== req.params.id);
      if (history.length === before) {
        return res.status(404).json({ error: "Entry not found" });
      }
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
      res.json({ success: true });
    } catch (error) {
      console.error("Failed to delete recommendation history entry:", error);
      res.status(500).json({ error: "Failed to delete entry" });
    }
  });

  app.post("/api/compare-stocks", async (req, res) => {
    const { symbols, portfolio, amountEGP } = req.body;

    if (!symbols || !Array.isArray(symbols) || symbols.length < 2 || symbols.length > 3) {
      return res.status(400).json({ error: "Provide 2-3 stock symbols to compare" });
    }
    if (!portfolio || !portfolio.holdings) {
      return res.status(400).json({ error: "Portfolio data required" });
    }

    try {
      // Fetch real-time data for the compared stocks
      const stockData = await Promise.all(
        symbols.map(async (symbol: string) => {
          const priceData = await fetchStockPrice(symbol);
          const financials = await fetchStockFinancials(symbol);
          return {
            symbol,
            nameEn: EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol,
            currentPrice: priceData.price || 0,
            peRatio: financials.peRatio,
            eps: financials.eps || (financials.peRatio && priceData.price && financials.peRatio > 0 ? priceData.price / financials.peRatio : null),
            dividendYield: financials.dividendYield,
            bookValue: financials.bookValue,
            sector: undefined,
          };
        })
      );

      const sentimentBySymbol: Record<string, import("./gemini-service").RawSentimentItem[]> = {};
      await Promise.all(
        symbols.map(async (sym: string) => {
          const s = await fetchSentimentForSymbol(sym);
          if (s && s.length > 0) sentimentBySymbol[sym] = s;
        })
      );

      const compareRequest: CompareStocksRequest = {
        symbols,
        stockData,
        portfolio,
        amountEGP: amountEGP || undefined,
        ...(Object.keys(sentimentBySymbol).length > 0 && { sentimentBySymbol }),
      };

      const result = await compareStocksWithGemini(compareRequest);
      if (result) {
        res.json(result);
      } else {
        res.status(503).json({ error: "AI analysis unavailable. Check Gemini API key." });
      }
    } catch (error) {
      console.error("Compare stocks error:", error);
      res.status(500).json({ error: "Failed to compare stocks" });
    }
  });

  // ─── Financial Sentiment (FinBERT) ───
  app.get("/api/stocks/:symbol/sentiment", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    
    try {
      // 1. Fetch Micro News (Company specific)
      const microNews = await fetchEODHDNews(symbol);
      
      // 2. Fetch Macro News (Egypt economy)
      const macroNews = await fetchMacroNews();
      
      // We will analyze them together or separately.
      // EODHD API sometimes returns no news for smaller stocks, so we rely on macro news in that case.
      // To ensure diversity, we interleave them or just take top 5 of each.
      const allNews = [...microNews.slice(0, 5), ...macroNews.slice(0, 5)];
      
      if (allNews.length === 0) {
        return res.json({
          score: "Neutral",
          bullishScore: 0,
          bearishScore: 0,
          neutralScore: 1,
          headlines: [],
          status: "No News Available"
        });
      }
      
      const sentimentResult = await analyzeSentimentWithFinBERT(allNews);
      
      if (!sentimentResult) {
        return res.status(503).json({ error: "Sentiment analysis unavailable at this time." });
      }
      
      res.json(sentimentResult);
    } catch (error) {
      console.error("Sentiment route error:", error);
      res.status(500).json({ error: "Failed to fetch sentiment data." });
    }
  });

  app.post("/api/portfolio-sentiment", async (req, res) => {
    const { symbols } = req.body; // Array of symbols (e.g., top 3-5 holdings)
    
    if (!Array.isArray(symbols)) {
      return res.status(400).json({ error: "symbols array required" });
    }
    
    try {
      // 1. Fetch Macro News
      const macroNews = await fetchMacroNews();
      let allNews = [...macroNews.slice(0, 4)]; // Top 4 macro news
      
      // 2. Fetch 1-2 news for each symbol to avoid overwhelming the model/API limits
      for (const symbol of symbols.slice(0, 5)) {
        const microNews = await fetchEODHDNews(symbol.toUpperCase());
        allNews = [...allNews, ...microNews.slice(0, 2)];
      }
      
      if (allNews.length === 0) {
        return res.json({
          score: "Neutral",
          bullishScore: 0,
          bearishScore: 0,
          neutralScore: 1,
          headlines: [],
          status: "No News Available"
        });
      }
      
      const sentimentResult = await analyzeSentimentWithFinBERT(allNews);
      
      if (!sentimentResult) {
        return res.status(503).json({ error: "Sentiment analysis unavailable at this time." });
      }
      
      res.json(sentimentResult);
    } catch (error) {
      console.error("Portfolio sentiment route error:", error);
      res.status(500).json({ error: "Failed to fetch portfolio sentiment." });
    }
  });

  // ─── Multi-Provider Stock Analysis ───

  // Per-provider single stock analysis
  app.get("/api/ai/:provider/stock-analysis/:symbol", async (req, res) => {
    const provider = req.params.provider as ProviderName;
    const symbol = req.params.symbol.toUpperCase();

    if (!PROVIDERS[provider]) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
    if (!isProviderConfigured(provider)) {
      return res.status(503).json({ error: `${PROVIDERS[provider].name} API key not configured` });
    }

    try {
      const [priceData, financials] = await Promise.all([
        fetchStockPrice(symbol),
        fetchStockFinancials(symbol),
      ]);

      const eps = financials.eps || (financials.peRatio && priceData.price && financials.peRatio > 0 ? priceData.price / financials.peRatio : null);
      let historicalPrices: number[] = [];
      let sharpeRatio: number | null = null;
      let sortinoRatio: number | null = null;
      let priceChange30d: number | null = null;
      let priceChange90d: number | null = null;

      try {
        historicalPrices = await fetchHistoricalPrices(symbol, 252);
        if (historicalPrices.length > 1) {
          const returns = calculateReturns(historicalPrices);
          if (returns.length > 0) {
            sharpeRatio = calculateSharpeRatio(returns, 0.10);
            sortinoRatio = calculateSortinoRatio(returns, 0.10);
          }
        }
        if (historicalPrices.length > 30 && priceData.price) {
          const price30dAgo = historicalPrices[historicalPrices.length - 30];
          priceChange30d = ((priceData.price - price30dAgo) / price30dAgo) * 100;
        }
        if (historicalPrices.length > 90 && priceData.price) {
          const price90dAgo = historicalPrices[historicalPrices.length - 90];
          priceChange90d = ((priceData.price - price90dAgo) / price90dAgo) * 100;
        }
      } catch {}

      const sentiment = await fetchSentimentForSymbol(symbol);

      const stockDataForAI = {
        symbol,
        companyName: EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol,
        currentPrice: priceData.price || 0,
        volume: priceData.volume,
        eps,
        peRatio: financials.peRatio,
        bookValue: financials.bookValue,
        priceToBook: financials.bookValue && priceData.price ? priceData.price / financials.bookValue : null,
        dividendYield: financials.dividendYield || null,
        sharpeRatio,
        sortinoRatio,
        historicalPrices: historicalPrices.slice(-60),
        priceChange30d,
        priceChange90d,
        priceSource: priceData.source,
        fundamentalsSource: financials.source,
        ...(sentiment && sentiment.length > 0 && { sentiment }),
      };

      // MEM-04: Fetch episodic context before analysis
      let episodicContext: string | undefined;
      try {
        const relevantEpisodes = await memoryService.getRelevantEpisodes(symbol, null, 3);
        if (relevantEpisodes.length > 0) {
          episodicContext = relevantEpisodes
            .map((ep, i) => `${i + 1}. [${ep.symbol}] ${ep.context}: ${ep.lesson}`)
            .join('\n');
          (stockDataForAI as any).episodicContext = episodicContext;
        }
      } catch (e) {
        console.warn('Episodic fetch failed (non-fatal):', e);
      }

      const result = await runAnalysis(provider, "stock", { data: stockDataForAI });
      if (result.error) {
        return res.status(503).json(result);
      }

      // Critic: run after analysis if result has recommendation
      if (result.result?.recommendation) {
        try {
          const criticResult = await criticAgent.critique(
            result.result as any,
            stockDataForAI as any
          );
          if (criticResult) {
            result.result.criticFeedback = criticResult;
            // Apply confidence discount
            if (criticResult.severity === 'high' && result.result.confidence) {
              result.result.confidence = applyConfidenceDiscount(result.result.confidence, criticResult.severity);
            }
          }
        } catch (e) {
          console.warn('Critic failed (non-fatal):', e);
        }
      }

      // MEM-01: Log decision fire-and-forget
      if (result.result?.recommendation) {
        setImmediate(() => {
          const inputsHash = createHash('sha256')
            .update(JSON.stringify({ symbol, price: priceData.price, eps, peRatio: financials.peRatio }))
            .digest('hex').slice(0, 16);
          memoryService.saveDecision({
            symbol,
            decisionType: 'stock',
            recommendation: result.result.recommendation,
            confidence: result.result.confidence || 'Medium',
            reasoning: (result.result.reasoning || result.result.geminiReasoning || '').slice(0, 2000),
            inputsHash,
            fairValue: result.result.fairValueEstimate ?? result.result.fairValueAvg ?? null,
            priceAtRec: priceData.price,
            criticWeakness: result.result.criticFeedback?.weakness ?? null,
            criticSeverity: result.result.criticFeedback?.severity ?? null,
            criticBlocking: result.result.criticFeedback?.blockingIssues ?? null,
          }).catch(e => console.error('saveDecision failed:', e));
        });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Stock analysis failed" });
    }
  });

  // Compare prior vs current analysis (AI narrative for "Compare to last week")
  app.post("/api/ai/compare-analysis", async (req, res) => {
    const { prior, current, symbol } = req.body;
    if (!prior || !current || !symbol) {
      return res.status(400).json({ error: "prior, current, and symbol required" });
    }
    try {
      const narrative = await compareAnalysisNarrative(prior, current, symbol);
      res.json({ narrative });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Compare analysis failed" });
    }
  });

  // Get trusted providers for stock analysis
  app.get("/api/ai/trusted-providers", (_req, res) => {
    const available = TRUSTED_PROVIDERS.filter((p) => isProviderConfigured(p));
    const providers = available.map((p) => ({
      id: p,
      name: PROVIDERS[p].name,
      model: PROVIDERS[p].model,
    }));
    res.json({ providers });
  });

  // RAG status: what's filled, partial, empty (from rag-manifest.json)
  app.get("/api/rag/status", (_req, res) => {
    const manifestPath = path.join(process.cwd(), "server", "data", "rag-manifest.json");
    if (!fs.existsSync(manifestPath)) {
      return res.json({
        available: false,
        message: "No RAG manifest. Run: npx tsx server/scripts/ingest-pdfs.ts or npx tsx server/scripts/rag-status.ts",
      });
    }
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      res.json({ available: true, ...manifest });
    } catch (e) {
      res.status(500).json({ available: false, error: "Failed to read manifest" });
    }
  });

  // ─── Multi-Provider AI Endpoints ───

  // List available providers
  app.get("/api/ai/providers", (_req, res) => {
    const available = getAvailableProviders();
    const providers = available.map((p) => ({
      id: p,
      name: PROVIDERS[p].name,
      model: PROVIDERS[p].model,
    }));
    res.json({ providers });
  });

  // Per-provider portfolio analysis
  app.post("/api/ai/:provider/portfolio-analysis", async (req, res) => {
    const provider = req.params.provider as ProviderName;
    if (!PROVIDERS[provider]) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
    if (!isProviderConfigured(provider)) {
      return res.status(503).json({ error: `${PROVIDERS[provider].name} API key not configured` });
    }
    const portfolioData = req.body;
    if (!portfolioData?.holdings?.length) {
      return res.status(400).json({ error: "Portfolio holdings data required" });
    }
    try {
      const symbols = portfolioData.holdings.map((h: any) => h.symbol);
      const sentiment = await fetchSentimentForPortfolio(symbols);
      if (sentiment && sentiment.length > 0) portfolioData.sentiment = sentiment;
      // MEM-04: Fetch episodic context for portfolio symbols
      try {
        const allEpisodes: Array<{ symbol: string; context: string; lesson: string }> = [];
        for (const sym of symbols.slice(0, 5)) {
          const eps = await memoryService.getRelevantEpisodes(sym, null, 2);
          allEpisodes.push(...eps);
        }
        if (allEpisodes.length > 0) {
          portfolioData.episodicContext = allEpisodes
            .map((ep, i) => `${i + 1}. [${ep.symbol}] ${ep.context}: ${ep.lesson}`)
            .join('\n');
        }
      } catch (e) {
        console.warn('Portfolio episodic fetch failed (non-fatal):', e);
      }

      const result = await runAnalysis(provider, "portfolio", { data: portfolioData });
      if (result.error) {
        return res.status(503).json(result);
      }

      // MEM-01: Log portfolio decision
      if (result.result) {
        setImmediate(() => {
          const inputsHash = createHash('sha256')
            .update(JSON.stringify({ symbols, type: 'portfolio' }))
            .digest('hex').slice(0, 16);
          memoryService.saveDecision({
            symbol: symbols.join(','),
            decisionType: 'portfolio',
            recommendation: result.result.recommendation || result.result.health || 'N/A',
            confidence: result.result.confidence || 'Medium',
            reasoning: (result.result.reasoning || result.result.summary || '').slice(0, 2000),
            inputsHash,
            priceAtRec: null,
          }).catch(e => console.error('saveDecision (portfolio) failed:', e));
        });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  // Per-provider deploy capital
  app.post("/api/ai/:provider/deploy-capital", async (req, res) => {
    const provider = req.params.provider as ProviderName;
    if (!PROVIDERS[provider]) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
    if (!isProviderConfigured(provider)) {
      return res.status(503).json({ error: `${PROVIDERS[provider].name} API key not configured` });
    }
    const data = req.body;
    if (!data?.portfolio || !data?.amountToDeployEGP) {
      return res.status(400).json({ error: "Portfolio data and amount required" });
    }

    try {
      const portfolioSymbols = data.portfolio.holdings.map((h: any) => h.symbol);
      const sentiment = await fetchSentimentForPortfolio(portfolioSymbols);
      if (sentiment && sentiment.length > 0) data.portfolio.sentiment = sentiment;

      // Fetch market prices (shared across all providers)
      const majorSymbols = Object.values(EGX_COMPANY_SYMBOL_MAP);
      const allSymbols = [...new Set([...majorSymbols, ...portfolioSymbols])];
      const marketPrices: Record<string, number> = {};
      await Promise.all(
        allSymbols.map(async (symbol) => {
          try {
            const priceData = await fetchStockPrice(symbol);
            if (priceData.price) marketPrices[symbol] = priceData.price;
          } catch {}
        })
      );

      // MEM-04: Fetch episodic context for deploy symbols
      try {
        const deployEpisodes: Array<{ symbol: string; context: string; lesson: string }> = [];
        for (const sym of portfolioSymbols.slice(0, 5)) {
          const eps = await memoryService.getRelevantEpisodes(sym, null, 2);
          deployEpisodes.push(...eps);
        }
        if (deployEpisodes.length > 0) {
          data.episodicContext = deployEpisodes
            .map((ep, i) => `${i + 1}. [${ep.symbol}] ${ep.context}: ${ep.lesson}`)
            .join('\n');
        }
      } catch (e) {
        console.warn('Deploy episodic fetch failed (non-fatal):', e);
      }

      const result = await runAnalysis(provider, "deploy", { data, marketPrices });
      if (result.error) {
        return res.status(503).json(result);
      }

      // MEM-01: Log deploy decision
      if (result.result) {
        setImmediate(() => {
          const inputsHash = createHash('sha256')
            .update(JSON.stringify({ symbols: portfolioSymbols, amount: data.amountToDeployEGP, type: 'deploy' }))
            .digest('hex').slice(0, 16);
          memoryService.saveDecision({
            symbol: portfolioSymbols.join(','),
            decisionType: 'deploy',
            recommendation: result.result.strategy || 'N/A',
            confidence: result.result.confidence || 'Medium',
            reasoning: (result.result.reasoning || '').slice(0, 2000),
            inputsHash,
            priceAtRec: null,
          }).catch(e => console.error('saveDecision (deploy) failed:', e));
        });
      }

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  // Per-provider compare stocks
  app.post("/api/ai/:provider/compare-stocks", async (req, res) => {
    const provider = req.params.provider as ProviderName;
    if (!PROVIDERS[provider]) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
    if (!isProviderConfigured(provider)) {
      return res.status(503).json({ error: `${PROVIDERS[provider].name} API key not configured` });
    }
    const { symbols, portfolio, amountEGP } = req.body;
    if (!symbols || !Array.isArray(symbols) || symbols.length < 2 || symbols.length > 3) {
      return res.status(400).json({ error: "Provide 2-3 stock symbols to compare" });
    }
    if (!portfolio?.holdings) {
      return res.status(400).json({ error: "Portfolio data required" });
    }

    try {
      const stockData = await Promise.all(
        symbols.map(async (symbol: string) => {
          const priceData = await fetchStockPrice(symbol);
          const financials = await fetchStockFinancials(symbol);
          return {
            symbol,
            nameEn: EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol,
            currentPrice: priceData.price || 0,
            peRatio: financials.peRatio,
            eps: financials.eps || (financials.peRatio && priceData.price && financials.peRatio > 0 ? priceData.price / financials.peRatio : null),
            dividendYield: financials.dividendYield,
            bookValue: financials.bookValue,
            sector: undefined,
          };
        })
      );

      const sentimentBySymbol: Record<string, import("./gemini-service").RawSentimentItem[]> = {};
      await Promise.all(
        symbols.map(async (sym: string) => {
          const s = await fetchSentimentForSymbol(sym);
          if (s && s.length > 0) sentimentBySymbol[sym] = s;
        })
      );
      const compareData = {
        symbols,
        stockData,
        portfolio,
        amountEGP: amountEGP || undefined,
        ...(Object.keys(sentimentBySymbol).length > 0 && { sentimentBySymbol }),
      };
      const result = await runAnalysis(provider, "compare", { data: compareData });
      if (result.error) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  // Per-provider behavior analysis
  app.post("/api/ai/:provider/behavior-analysis", async (req, res) => {
    const provider = req.params.provider as ProviderName;
    if (!PROVIDERS[provider]) {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
    if (!isProviderConfigured(provider)) {
      return res.status(503).json({ error: `${PROVIDERS[provider].name} API key not configured` });
    }
    const data = req.body;
    const hasHoldings = data?.holdings?.length > 0;
    const hasTransactions = data?.transactions?.length > 0;
    const hasDividends = data?.dividends?.length > 0;
    const hasRealizedGains = data?.realizedGains?.length > 0;
    if (!hasHoldings && !hasTransactions && !hasDividends && !hasRealizedGains) {
      return res.status(400).json({ error: "Add holdings, trades, dividends, or realized gains to get behavior insights" });
    }
    try {
      const result = await runAnalysis(provider, "behavior", { data });
      if (result.error) {
        return res.status(503).json(result);
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Analysis failed" });
    }
  });

  // Manus AI Deep Analysis endpoints
  app.post("/api/manus/analyze/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();

    try {
      const [priceData, financials] = await Promise.all([
        fetchStockPrice(symbol),
        fetchStockFinancials(symbol),
      ]);

      const eps = financials.eps || (financials.peRatio && priceData.price && financials.peRatio > 0 ? priceData.price / financials.peRatio : null);
      let historicalPrices: number[] = [];
      let sharpeRatio: number | null = null;
      let sortinoRatio: number | null = null;
      let priceChange30d: number | null = null;
      let priceChange90d: number | null = null;

      try {
        historicalPrices = await fetchHistoricalPrices(symbol, 252);
        if (historicalPrices.length > 1) {
          const returns = calculateReturns(historicalPrices);
          if (returns.length > 0) {
            sharpeRatio = calculateSharpeRatio(returns, 0.10);
            sortinoRatio = calculateSortinoRatio(returns, 0.10);
          }
        }
        if (historicalPrices.length > 30 && priceData.price) {
          const price30dAgo = historicalPrices[historicalPrices.length - 30];
          priceChange30d = ((priceData.price - price30dAgo) / price30dAgo) * 100;
        }
        if (historicalPrices.length > 90 && priceData.price) {
          const price90dAgo = historicalPrices[historicalPrices.length - 90];
          priceChange90d = ((priceData.price - price90dAgo) / price90dAgo) * 100;
        }
      } catch {}

      const sentiment = await fetchSentimentForSymbol(symbol);

      const stockDataForAI: ManusAnalysisRequest = {
        symbol,
        companyName: EGX_COMPANY_SYMBOL_MAP_REVERSE[symbol] || symbol,
        currentPrice: priceData.price || 0,
        eps,
        peRatio: financials.peRatio,
        bookValue: financials.bookValue,
        dividendYield: financials.dividendYield || null,
        sharpeRatio,
        sortinoRatio,
        historicalPrices: historicalPrices.slice(-60),
        priceChange30d,
        priceChange90d,
        priceSource: priceData.source,
        fundamentalsSource: financials.source,
        ...(sentiment && sentiment.length > 0 && { sentiment }),
      };

      const task = await createManusAnalysis(symbol, stockDataForAI);
      if (task) {
        res.json({ taskId: task.taskId, status: "pending", taskUrl: task.taskUrl });
      } else {
        res.status(500).json({ error: "Failed to initiate Manus analysis" });
      }
    } catch (error: any) {
      console.error("Manus analysis initiation error:", error);
      res.status(500).json({ error: error.message || "Failed to initiate Manus analysis" });
    }
  });

  app.get("/api/manus/status/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    try {
      const status = await getManusTaskStatus(symbol);
      if (status) {
        res.json(status);
      } else {
        res.status(404).json({ error: "Manus task not found for this symbol" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get Manus task status" });
    }
  });

  app.get("/api/manus/result/:symbol", async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    try {
      const result = await getManusAnalysisResult(symbol);
      if (result) {
        res.json(result);
      } else {
        res.status(404).json({ error: "Manus analysis result not found or still pending" });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get Manus analysis result" });
    }
  });

  // Manus Webhook Endpoint
  app.post("/api/manus/webhook", manusWebhookHandler);

  // CALENDAR: Register a device push token (anonymous — anyone with the app gets calendar alerts)
  app.post('/api/push-tokens', async (req, res) => {
    try {
      const { calendarService } = await import('./calendar/calendar-service.js');
      const { token, platform } = req.body ?? {};
      if (typeof token !== 'string' || token.length < 10) {
        return res.status(400).json({ error: 'token is required' });
      }
      const plat = (platform === 'ios' || platform === 'android' || platform === 'web') ? platform : 'unknown';
      calendarService.upsertPushToken(token, plat);
      return res.json({ ok: true });
    } catch (e: any) {
      console.error('[routes] /api/push-tokens error:', e);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  // CALENDAR: List recent dividend-calendar notifications (history feed)
  app.get('/api/notifications', async (req, res) => {
    try {
      const { calendarService } = await import('./calendar/calendar-service.js');
      const limit = Math.min(parseInt((req.query.limit as string) || '10', 10) || 10, 50);
      const items = calendarService.listNotifications(limit);
      return res.json({ notifications: items });
    } catch (e: any) {
      console.error('[routes] /api/notifications error:', e);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  // CALENDAR: Manual trigger for testing (run a poll on demand)
  app.post('/api/calendar/poll', async (_req, res) => {
    try {
      const { runCalendarPoll } = await import('./calendar/calendar-poller.js');
      const result = await runCalendarPoll();
      return res.json(result);
    } catch (e: any) {
      console.error('[routes] /api/calendar/poll error:', e);
      return res.status(500).json({ error: e.message ?? 'Internal error' });
    }
  });

  // OBS-03: Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      orchestrator: process.env.USE_ORCHESTRATOR === 'true',
    });
  });

  // OBS-03: Metrics endpoint — decisions today, critic overrides, avg confidence, backtest accuracy
  app.get('/api/metrics', async (_req, res) => {
    try {
      const metrics = await memoryService.getMetrics();
      return res.json(metrics);
    } catch (e: any) {
      console.error('[routes] /api/metrics error:', e);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  // LEARN-05: Strategy diff endpoint — compare two strategy versions
  app.get('/api/strategy-diff', async (req, res) => {
    try {
      const v1Num = parseInt(req.query.v1 as string, 10);
      const v2Num = parseInt(req.query.v2 as string, 10);

      if (isNaN(v1Num) || isNaN(v2Num)) {
        return res.status(400).json({ error: 'v1 and v2 must be integers. Example: /api/strategy-diff?v1=1&v2=2' });
      }

      const [stratA, stratB] = await Promise.all([
        memoryService.getStrategyByVersion(v1Num),
        memoryService.getStrategyByVersion(v2Num),
      ]);

      if (!stratA) return res.status(404).json({ error: `Strategy v${v1Num} not found` });
      if (!stratB) return res.status(404).json({ error: `Strategy v${v2Num} not found` });

      const diff = memoryService.getStrategyDiff(stratA.promptText, stratB.promptText);

      return res.json({
        v1: { version: stratA.version, createdAt: stratA.createdAt, isActive: stratA.isActive },
        v2: { version: stratB.version, createdAt: stratB.createdAt, isActive: stratB.isActive },
        diff,
      });
    } catch (e: any) {
      console.error('[routes] /api/strategy-diff error:', e);
      return res.status(500).json({ error: 'Internal error' });
    }
  });

  // Register Manus webhook on startup
  registerManusWebhook();

  const httpServer = createServer(app);

  return httpServer;
}
