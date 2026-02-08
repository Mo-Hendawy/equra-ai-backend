import type { Express } from "express";
import { createServer, type Server } from "node:http";
import * as fs from "fs";
import * as path from "path";
import { getCached, setCache, getStaleCache } from "./api-cache";
import { analyzeStockWithGemini, createFallbackAnalysis, analyzePortfolioWithGemini, deployCapitalWithGemini, compareStocksWithGemini, type StockDataForAI, type PortfolioAnalysisRequest, type DeployCapitalRequest, type CompareStocksRequest } from "./gemini-service";
import { extractTransactionsFromImage } from "./vision-service";

const EODHD_API_TOKEN = "697f54f83d2b52.60862429";
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
};

// Reverse mapping for company names
const EGX_COMPANY_SYMBOL_MAP_REVERSE: Record<string, string> = Object.entries(EGX_COMPANY_SYMBOL_MAP).reduce((acc, [name, symbol]) => {
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
      // Try to use stale cache if API fails
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
  // Priority: EODHD (with cache) → TradingView → CNBC → Stale Cache
  let priceData = await fetchEODHDPrice(symbol);
  
  if (!priceData) {
    priceData = await fetchTradingViewPrice(symbol);
  }
  
  if (!priceData) {
    priceData = await fetchCNBCPrice(symbol);
  }

  if (priceData) {
    return priceData;
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

async function fetchHistoricalPrices(symbol: string, days: number = 252): Promise<number[]> {
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
  // Priority: EODHD (with cache) → TradingView → Mubasher → EGX Static → Stale Cache
  
  // Try EODHD first (includes caching)
  let eodhd = await fetchEODHDFundamentals(symbol);
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

async function calculateAnalysis(
  symbol: string,
  price: StockPrice,
  financials: StockFinancials & { dividendYield?: number | null },
  refresh: boolean = false
): Promise<StockAnalysis> {
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
  };

  // Try Gemini AI analysis first
  console.log(`Attempting Gemini AI analysis for ${symbol}...${refresh ? ' (refresh requested)' : ''}`);
  const geminiAnalysis = await analyzeStockWithGemini(stockDataForAI, refresh);

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
      geminiConfidence: geminiAnalysis.confidence,
      geminiRiskLevel: geminiAnalysis.riskLevel,
      geminiKeyPoints: geminiAnalysis.keyPoints,
      analysisMethod: "Gemini AI",
      valuationStatus: geminiAnalysis.valuationStatus,
      simpleExplanation: geminiAnalysis.simpleExplanation,
      riskSignals: geminiAnalysis.riskSignals,
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

  app.post("/api/portfolio-analysis", async (req, res) => {
    const portfolioData: PortfolioAnalysisRequest = req.body;

    if (!portfolioData || !portfolioData.holdings || portfolioData.holdings.length === 0) {
      return res.status(400).json({ error: "Portfolio holdings data required" });
    }

    try {
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
      // Fetch real-time prices for major EGX stocks so Gemini uses actual market data
      const majorSymbols = Object.values(EGX_COMPANY_SYMBOL_MAP);
      // Also include portfolio symbols
      const portfolioSymbols = data.portfolio.holdings.map(h => h.symbol);
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

      const compareRequest: CompareStocksRequest = {
        symbols,
        stockData,
        portfolio,
        amountEGP: amountEGP || undefined,
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

  const httpServer = createServer(app);

  return httpServer;
}
