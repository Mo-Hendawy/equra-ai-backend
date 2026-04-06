import type { StockDataForAI, GeminiAnalysis } from '../gemini-service.js';
import type { CriticFeedback } from '../schemas/analysis-schemas.js';

export type { StockDataForAI, GeminiAnalysis, CriticFeedback };

// ─── Base Agent contract ───

export interface Agent<TInput, TOutput> {
  run(input: TInput, signal?: AbortSignal): Promise<TOutput>;
}

// ─── DataAgent I/O ───

export interface DataAgentInput {
  symbol: string;
  price: {
    price: number | null;
    volume: number | null;
    source?: string;
    change: number | null;
    changePercent: number | null;
    previousClose: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
  };
  financials: {
    eps: number | null;
    peRatio: number | null;
    bookValue: number | null;
    dividendYield?: number | null;
    source?: string;
  };
  refresh?: boolean;
}

export interface DataAgentOutput {
  stockDataForAI: StockDataForAI;
  episodicContext: string | undefined;
  computedFields: {
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    eps: number | null;
    peRatio: number | null;
    bookValue: number | null;
    priceToBook: number | null;
    dividendYield: number | null;
  };
}

// ─── AnalysisAgent I/O ───

export interface AnalysisAgentInput {
  stockDataForAI: StockDataForAI;
  episodicContext: string | undefined;
  refresh?: boolean;
}

export type AnalysisAgentOutput = GeminiAnalysis | null;

// ─── CriticAgent I/O ───

export interface CriticAgentInput {
  analysis: GeminiAnalysis;
  stockData: StockDataForAI;
}

export type CriticAgentOutput = CriticFeedback | null;

// ─── DecisionAgent I/O ───

export interface DecisionAgentInput {
  symbol: string;
  analysis: GeminiAnalysis;
  criticFeedback: CriticFeedback | null;
  stockDataForAI: StockDataForAI;
  computedFields: DataAgentOutput['computedFields'];
  priceSource?: string;
  financialsSource?: string;
}

export interface DecisionAgentOutput {
  finalRecommendation: GeminiAnalysis['recommendation'];
  adjustedConfidence: 'High' | 'Medium' | 'Low';
  criticFeedback: CriticFeedback | null;
  decisionId: number | null;
}

// ─── Full pipeline result ───

export interface PipelineResult {
  dataOutput: DataAgentOutput;
  analysisOutput: AnalysisAgentOutput;
  decisionOutput: DecisionAgentOutput;
}
