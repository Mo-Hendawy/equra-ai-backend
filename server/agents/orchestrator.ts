// server/agents/orchestrator.ts
// ARCH-06: Orchestrator — sequences pipeline with per-agent timeouts
import type { DataAgentInput, PipelineResult } from './types.js';
import { dataAgent } from './data-agent.js';
import { analysisAgent } from './analysis-agent.js';
import { criticAgent } from './critic-agent.js';
import { decisionAgent } from './decision-agent.js';

const AGENT_TIMEOUT_MS = 30_000;

// C4 pitfall prevention: explicit per-agent timeout with fail-open
function withTimeout<T>(promise: Promise<T>, ms: number, agentName: string): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`[orchestrator] ${agentName} timed out after ${ms}ms — continuing without output`);
      resolve(null);
    }, ms);

    promise
      .then(result => { clearTimeout(timer); resolve(result); })
      .catch(err => {
        clearTimeout(timer);
        console.warn(`[orchestrator] ${agentName} failed:`, err);
        resolve(null);
      });
  });
}

export class AgentOrchestrator {
  async run(input: DataAgentInput): Promise<PipelineResult> {
    console.log(`[orchestrator] Pipeline start — ${input.symbol}`);

    // Step 1: DataAgent (no timeout — deterministic fetches, no LLM)
    const dataOutput = await dataAgent.run(input);

    // Step 2: AnalysisAgent — 30s timeout
    const analysisOutput = await withTimeout(
      analysisAgent.run({
        stockDataForAI: dataOutput.stockDataForAI,
        episodicContext: dataOutput.episodicContext,
        refresh: input.refresh,
      }),
      AGENT_TIMEOUT_MS, 'AnalysisAgent'
    );

    if (!analysisOutput) {
      console.warn(`[orchestrator] AnalysisAgent returned null — using fallback`);
      return {
        dataOutput,
        analysisOutput: null,
        decisionOutput: {
          finalRecommendation: 'Hold',
          adjustedConfidence: 'Low',
          criticFeedback: null,
          decisionId: null,
        },
      };
    }

    // Step 3: CriticAgent — 30s timeout, fail-open (C4)
    const criticOutput = await withTimeout(
      criticAgent.run({ analysis: analysisOutput, stockData: dataOutput.stockDataForAI }),
      AGENT_TIMEOUT_MS, 'CriticAgent'
    );

    // Step 4: DecisionAgent — 30s timeout
    const decisionOutput = await withTimeout(
      decisionAgent.run({
        symbol: input.symbol,
        analysis: analysisOutput,
        criticFeedback: criticOutput,
        stockDataForAI: dataOutput.stockDataForAI,
        computedFields: dataOutput.computedFields,
        priceSource: input.price.source,
        financialsSource: input.financials.source,
      }),
      AGENT_TIMEOUT_MS, 'DecisionAgent'
    );

    console.log(`[orchestrator] Pipeline complete — ${input.symbol}`);

    return {
      dataOutput,
      analysisOutput,
      decisionOutput: decisionOutput ?? {
        finalRecommendation: analysisOutput.recommendation,
        adjustedConfidence: analysisOutput.confidence,
        criticFeedback: criticOutput,
        decisionId: null,
      },
    };
  }
}

export const orchestrator = new AgentOrchestrator();
