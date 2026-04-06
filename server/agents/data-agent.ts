import type { Agent, DataAgentInput, DataAgentOutput } from './types.js';
import { memoryService } from '../memory/memory-service.js';
import { fetchSentimentForSymbol, fetchHistoricalPrices, EGX_COMPANY_SYMBOL_MAP_REVERSE } from '../routes.js';

// ─── Pure math helpers (duplicated from routes.ts to keep agent self-contained) ───

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
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return null;
  const annualizedReturn = avgReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);
  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

function calculateSortinoRatio(returns: number[], riskFreeRate: number = 0.10): number | null {
  if (returns.length < 2) return null;
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const downsideReturns = returns.filter(r => r < 0);
  if (downsideReturns.length === 0) return 999;
  const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / returns.length;
  const downsideDeviation = Math.sqrt(downsideVariance);
  if (downsideDeviation === 0) return null;
  const annualizedReturn = avgReturn * 252;
  const annualizedDownsideDev = downsideDeviation * Math.sqrt(252);
  return (annualizedReturn - riskFreeRate) / annualizedDownsideDev;
}

// ─── DataAgent ───

export class DataAgent implements Agent<DataAgentInput, DataAgentOutput> {
  async run(input: DataAgentInput, signal?: AbortSignal): Promise<DataAgentOutput> {
    const { symbol, price, financials } = input;
    const currentPrice = price.price;

    // 1. Derive computed fields
    const eps = financials.eps || (financials.peRatio && currentPrice && financials.peRatio > 0
      ? currentPrice / financials.peRatio
      : null);
    const peRatio = financials.peRatio;
    const bookValue = financials.bookValue;
    const dividendYield = financials.dividendYield ?? null;
    const priceToBook = bookValue && currentPrice ? currentPrice / bookValue : null;

    // 2. Fetch historical prices and compute risk ratios
    let sharpeRatio: number | null = null;
    let sortinoRatio: number | null = null;
    let historicalPrices: number[] = [];
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
      if (historicalPrices.length > 30 && currentPrice) {
        const price30dAgo = historicalPrices[historicalPrices.length - 30];
        priceChange30d = ((currentPrice - price30dAgo) / price30dAgo) * 100;
      }
      if (historicalPrices.length > 90 && currentPrice) {
        const price90dAgo = historicalPrices[historicalPrices.length - 90];
        priceChange90d = ((currentPrice - price90dAgo) / price90dAgo) * 100;
      }
    } catch (error) {
      console.error(`[data-agent] Error computing risk ratios for ${symbol}:`, error);
    }

    // 3. Fetch market sentiment (non-fatal)
    let sentiment: DataAgentOutput['stockDataForAI']['sentiment'];
    try {
      const rawSentiment = await fetchSentimentForSymbol(symbol);
      if (rawSentiment && rawSentiment.length > 0) {
        sentiment = rawSentiment;
      }
    } catch (error) {
      console.warn(`[data-agent] Sentiment fetch failed for ${symbol} (non-fatal):`, error);
    }

    // 4. Build StockDataForAI
    const stockDataForAI: DataAgentOutput['stockDataForAI'] = {
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

    // 5. Fetch episodic context (non-fatal)
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
      console.warn('[data-agent] Episodic fetch failed (non-fatal):', e);
    }

    console.log(`[data-agent] ${symbol} fetched — price=${currentPrice}, sentiment=${sentiment ? sentiment.length : 0}, episodes=${episodicContext ? episodicContext.split('\n').length : 0}`);

    return {
      stockDataForAI,
      episodicContext,
      computedFields: {
        sharpeRatio,
        sortinoRatio,
        eps,
        peRatio,
        bookValue,
        priceToBook,
        dividendYield,
      },
    };
  }
}

export const dataAgent = new DataAgent();
