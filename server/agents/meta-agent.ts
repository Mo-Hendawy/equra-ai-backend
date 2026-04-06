// server/agents/meta-agent.ts
// LEARN-03: Weekly Meta-Agent — reviews past decisions, evolves strategy
import { GoogleGenerativeAI } from '@google/generative-ai';
import { memoryService } from '../memory/memory-service.js';

export class MetaAgent {
  private readonly META_MODEL = 'gemini-2.0-flash';
  private readonly MIN_DECISIONS_TO_RUN = 10;

  async reviewAndEvolve(): Promise<void> {
    console.log('[meta-agent] Starting weekly strategy review...');

    // 1. Get all scored decisions
    const allScored = await memoryService.getScoredDecisionsForMeta();

    if (allScored.length < this.MIN_DECISIONS_TO_RUN) {
      console.log(`[meta-agent] Only ${allScored.length} scored decisions — need ${this.MIN_DECISIONS_TO_RUN}. Skipping.`);
      return;
    }

    // 2. Filter: only THESIS_ERROR or null invalidationReason (pitfall C1)
    const learnable = allScored.filter(d =>
      d.invalidationReason === null || d.invalidationReason === 'THESIS_ERROR'
    );

    if (learnable.length < this.MIN_DECISIONS_TO_RUN) {
      console.log(`[meta-agent] Only ${learnable.length} learnable decisions after C1 filter. Skipping.`);
      return;
    }

    // 3. Balanced sampling (pitfall M4): 30 most recent + 10 random historical
    const sorted = [...learnable].sort(
      (a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0)
    );
    const recent30 = sorted.slice(0, 30);
    const historical = sorted.slice(30);
    const random10 = this.sampleRandom(historical, 10);
    const sample = this.dedupeById([...recent30, ...random10]);

    // 4. Get current active strategy
    const currentStrategy = await memoryService.getLatestStrategyPrompt();
    const currentVersion = currentStrategy?.version ?? 0;
    const currentText = currentStrategy?.promptText ?? '(no strategy yet)';

    // 5. Build Meta-Agent prompt
    const decisionSummaries = sample.map(d => ({
      id: d.id,
      symbol: d.symbol,
      recommendation: d.recommendation,
      confidence: d.confidence,
      outcome5d: d.outcome5d,
      outcome30d: d.outcome30d,
      criticSeverity: d.criticSeverity,
      criticWeakness: d.criticWeakness,
      reasoningSummary: (d.reasoning ?? '').slice(0, 300),
    }));

    const prompt = `You are the Meta-Agent for an Egyptian Exchange (EGX) stock analysis AI.

Your job: review past recommendations and write an improved strategy version.

CURRENT STRATEGY (v${currentVersion}):
${currentText}

PAST DECISIONS SAMPLE (${sample.length} decisions, ${recent30.length} recent + ${random10.length} random historical):
${JSON.stringify(decisionSummaries, null, 2)}

TASK:
1. Identify 2-4 patterns where the current strategy led to poor outcomes (outcome5d < -5 for BUY recs, or outcome5d > 5 for SELL recs).
2. Identify 1-2 patterns that worked well (recommendation direction matched outcome).
3. Write an IMPROVED strategy text. Keep all sections from the current strategy. Add/modify rules based on what you learned. Add a "Learning Notes" section at the bottom summarizing what changed and why.
4. Return ONLY the new strategy text — no JSON wrapper, no markdown fences, just the raw strategy text starting with "# Equra AI — Stock Analysis Strategy v${currentVersion + 1}".

CONSTRAINTS:
- Do NOT remove the core EGX-specific rules unless you have strong evidence they are wrong.
- Keep strategy length similar to the current version (±30%).
- Learning Notes section must reference specific decision IDs from the sample.
- If fewer than 3 decisions had bad outcomes, return the current strategy unchanged (copy it verbatim).`;

    // 6. Call Gemini Flash
    let newStrategyText: string;
    try {
      const apiKey = process.env.GEMINI_API_KEY || '';
      if (!apiKey) {
        console.warn('[meta-agent] GEMINI_API_KEY not set — cannot run');
        return;
      }
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: this.META_MODEL,
        generationConfig: { temperature: 0.5, maxOutputTokens: 4096 },
      });
      const result = await model.generateContent(prompt);
      newStrategyText = result.response.text().trim();
    } catch (e) {
      console.error('[meta-agent] Gemini Flash call failed:', e);
      return;
    }

    if (!newStrategyText || newStrategyText.length < 100) {
      console.warn('[meta-agent] Returned empty or too-short strategy — skipping save');
      return;
    }

    // 7. Save new strategy version
    try {
      const newId = await memoryService.saveStrategyPrompt(newStrategyText);
      console.log(`[meta-agent] Saved strategy v${currentVersion + 1} (id=${newId}). Reviewed: ${sample.length} decisions.`);
    } catch (e) {
      console.error('[meta-agent] Failed to save new strategy:', e);
    }
  }

  private sampleRandom<T>(arr: T[], n: number): T[] {
    if (arr.length <= n) return [...arr];
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n);
  }

  private dedupeById(arr: Array<{ id: number }>): typeof arr {
    const seen = new Set<number>();
    return arr.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });
  }
}

export const metaAgent = new MetaAgent();
