// server/agents/decision-agent.ts
// ARCH-05: DecisionAgent — merges analysis + critique, sole writer to memory
import { createHash } from 'node:crypto';
import type { Agent, DecisionAgentInput, DecisionAgentOutput } from './types.js';
import { memoryService } from '../memory/memory-service.js';
import { applyConfidenceDiscount } from '../schemas/analysis-schemas.js';

export class DecisionAgent implements Agent<DecisionAgentInput, DecisionAgentOutput> {
  async run(input: DecisionAgentInput, signal?: AbortSignal): Promise<DecisionAgentOutput> {
    if (signal?.aborted) {
      return { finalRecommendation: input.analysis.recommendation, adjustedConfidence: input.analysis.confidence, criticFeedback: input.criticFeedback, decisionId: null };
    }

    // CRIT-06: Apply confidence discount based on critic severity
    const adjustedConfidence = input.criticFeedback
      ? applyConfidenceDiscount(input.analysis.confidence, input.criticFeedback.severity)
      : input.analysis.confidence;

    const finalRecommendation = input.analysis.recommendation;

    // C6: Sole memory writer — fire-and-forget via setImmediate
    const inputsHash = createHash('sha256')
      .update(JSON.stringify({
        symbol: input.symbol,
        price: input.stockDataForAI.currentPrice,
        eps: input.stockDataForAI.eps,
        peRatio: input.stockDataForAI.peRatio,
      }))
      .digest('hex')
      .slice(0, 16);

    setImmediate(() => {
      memoryService.saveDecision({
        symbol: input.symbol,
        recommendation: finalRecommendation,
        confidence: adjustedConfidence,
        reasoning: input.analysis.reasoning.slice(0, 2000),
        inputsHash,
        fairValue: input.analysis.fairValueEstimate ?? null,
        priceAtRec: input.stockDataForAI.currentPrice,
        criticWeakness: input.criticFeedback?.weakness ?? null,
        criticSeverity: input.criticFeedback?.severity ?? null,
        criticBlocking: input.criticFeedback?.blockingIssues ?? null,
      }).catch(e => console.error('[decision-agent] saveDecision failed:', e));
    });

    console.log(`[decision-agent] ${input.symbol} — final=${finalRecommendation} adjustedConfidence=${adjustedConfidence} criticSeverity=${input.criticFeedback?.severity ?? 'none'}`);

    return {
      finalRecommendation,
      adjustedConfidence,
      criticFeedback: input.criticFeedback,
      decisionId: null, // fire-and-forget — ID not available synchronously
    };
  }
}

export const decisionAgent = new DecisionAgent();
