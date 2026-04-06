import { analyzeStockWithGemini } from '../gemini-service.js';
import type { Agent, AnalysisAgentInput, AnalysisAgentOutput } from './types.js';

export class AnalysisAgent implements Agent<AnalysisAgentInput, AnalysisAgentOutput> {
  async run(input: AnalysisAgentInput, signal?: AbortSignal): Promise<AnalysisAgentOutput> {
    const { stockDataForAI, episodicContext, refresh } = input;
    const symbol = stockDataForAI.symbol;

    if (signal?.aborted) {
      console.warn(`[analysis-agent] ${symbol} — aborted before Gemini call`);
      return null;
    }

    const result = await analyzeStockWithGemini(stockDataForAI, refresh ?? false, episodicContext);

    if (signal?.aborted) {
      console.warn(`[analysis-agent] ${symbol} — aborted after Gemini call`);
      return null;
    }

    if (result) {
      console.log(`[analysis-agent] ${symbol} — recommendation=${result.recommendation} confidence=${result.confidence}`);
    } else {
      console.log(`[analysis-agent] ${symbol} — Gemini returned null`);
    }

    return result;
  }
}

export const analysisAgent = new AnalysisAgent();
