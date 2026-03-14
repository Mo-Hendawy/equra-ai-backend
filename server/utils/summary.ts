/**
 * Stock summary derivation for EQU-5 One-Tap Summary View.
 * Derives a lightweight summary from full cached analysis.
 */

export interface StockSummary {
  symbol: string;
  companyName: string;

  // Decision
  recommendation: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
  confidence: "High" | "Medium" | "Low";

  // Valuation snapshot
  currentPrice: number | null;
  fairValueEstimate: number | null;
  valuationStatus: "Undervalued" | "Fair" | "Overvalued";
  discountPercent: number | null;

  // Risk
  riskLevel: "Low" | "Medium" | "High";

  // One-liner
  headline: string;

  // Entry zone context
  currentZone: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell" | null;
  zoneRange: { min: number; max: number } | null;
  inEntryZone: boolean;

  // Metadata
  analysisAge: number;
  priceSource: string;
  ragUsed: boolean;
  sentimentUsed: boolean;
  fullAnalysisAvailable: boolean;
}

interface AnalysisZones {
  strongBuyZone: { min: number; max: number } | null;
  buyZone: { min: number; max: number } | null;
  holdZone: { min: number; max: number } | null;
  sellZone: { min: number; max: number } | null;
  strongSellZone: { min: number; max: number } | null;
}

interface StockAnalysisInput {
  symbol: string;
  currentPrice: number | null;
  fairValueAvg: number | null;
  recommendation: string;
  priceSource?: string;
  geminiConfidence?: "High" | "Medium" | "Low";
  geminiRiskLevel?: "Low" | "Medium" | "High";
  geminiReasoning?: string;
  valuationStatus?: "Undervalued" | "Fair" | "Overvalued";
  simpleExplanation?: string[];
  strongBuyZone: { min: number; max: number } | null;
  buyZone: { min: number; max: number } | null;
  holdZone: { min: number; max: number } | null;
  sellZone: { min: number; max: number } | null;
  strongSellZone: { min: number; max: number } | null;
}

interface StockPriceInput {
  symbol: string;
  price: number | null;
  source?: string;
}

function getCurrentZone(
  price: number,
  zones: AnalysisZones
): { zone: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell"; range: { min: number; max: number } } | null {
  const checks: Array<{ name: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell"; zone: { min: number; max: number } | null }> = [
    { name: "Strong Buy", zone: zones.strongBuyZone },
    { name: "Buy", zone: zones.buyZone },
    { name: "Hold", zone: zones.holdZone },
    { name: "Sell", zone: zones.sellZone },
    { name: "Strong Sell", zone: zones.strongSellZone },
  ];

  for (const { name, zone } of checks) {
    if (zone && price >= zone.min && price <= zone.max) {
      return { zone: name, range: zone };
    }
  }
  return null;
}

export function deriveStockSummary(
  symbol: string,
  companyName: string,
  analysis: StockAnalysisInput,
  price: StockPriceInput,
  cacheTimestamp?: number | null
): StockSummary {
  const currentPrice = price.price ?? analysis.currentPrice;
  const fairValue = analysis.fairValueAvg;

  const recommendation = (analysis.recommendation || "Hold") as StockSummary["recommendation"];
  const confidence = (analysis.geminiConfidence || "Medium") as StockSummary["confidence"];
  const riskLevel = (analysis.geminiRiskLevel || "Medium") as StockSummary["riskLevel"];
  const valuationStatus = (analysis.valuationStatus || "Fair") as StockSummary["valuationStatus"];

  let discountPercent: number | null = null;
  if (fairValue != null && fairValue > 0 && currentPrice != null) {
    discountPercent = ((fairValue - currentPrice) / fairValue) * 100;
  }

  let headline = "";
  if (analysis.simpleExplanation && analysis.simpleExplanation.length > 0) {
    headline = analysis.simpleExplanation[0];
  } else {
    const reasoning = analysis.geminiReasoning || "";
    headline = reasoning.slice(0, 100).trim();
    if (headline && reasoning.length > 100) headline += "...";
  }
  if (!headline) headline = "Limited data available for analysis";

  let currentZone: StockSummary["currentZone"] = null;
  let zoneRange: StockSummary["zoneRange"] = null;
  let inEntryZone = false;

  if (currentPrice != null) {
    const zoneResult = getCurrentZone(currentPrice, analysis);
    if (zoneResult) {
      currentZone = zoneResult.zone;
      zoneRange = zoneResult.range;
      inEntryZone = currentZone === "Strong Buy" || currentZone === "Buy";
    }
  }

  const analysisAge = cacheTimestamp != null ? (Date.now() - cacheTimestamp) / 60000 : 0;

  return {
    symbol,
    companyName,
    recommendation,
    confidence,
    currentPrice,
    fairValueEstimate: fairValue,
    valuationStatus,
    discountPercent,
    riskLevel,
    headline,
    currentZone,
    zoneRange,
    inEntryZone,
    analysisAge,
    priceSource: analysis.priceSource ?? price.source ?? "Unknown",
    ragUsed: false,
    sentimentUsed: false,
    fullAnalysisAvailable: true,
  };
}
