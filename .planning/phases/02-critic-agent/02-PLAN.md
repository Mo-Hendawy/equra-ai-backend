---
phase: 02-critic-agent
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - server/agents/critic-agent.ts
  - server/schemas/analysis-schemas.ts
  - server/routes.ts
  - server/memory/memory-service.ts
autonomous: true
requirements:
  - CRIT-01
  - CRIT-02
  - CRIT-03
  - CRIT-04
  - CRIT-05
  - CRIT-06

must_haves:
  truths:
    - "A completed stock analysis returns a criticFeedback field with weakness, severity, counterScenario, and blockingIssues"
    - "Critic always argues the opposite position first (BUY analysis means Critic opens with SELL argument)"
    - "If the Groq call exceeds 10 seconds, the recommendation ships without criticFeedback — no 500 error"
    - "High severity critique reduces confidence one step: High becomes Medium, Medium becomes Low"
    - "critic_severity and critic_weakness columns in the decisions table are populated after each successful critique"
  artifacts:
    - path: "server/agents/critic-agent.ts"
      provides: "CriticAgent class — calls Groq Llama 4 Scout at temp 0.7, returns CriticFeedback or null"
      exports: ["CriticAgent", "CriticFeedback"]
    - path: "server/schemas/analysis-schemas.ts"
      provides: "criticFeedbackSchema (Zod) and applyConfidenceDiscount function appended to file"
      contains: "criticFeedbackSchema"
    - path: "server/routes.ts"
      provides: "Critic called in calculateAnalysis after Gemini, criticFeedback in return object, critic fields in saveDecision"
  key_links:
    - from: "server/routes.ts (calculateAnalysis)"
      to: "server/agents/critic-agent.ts"
      via: "await criticAgent.critique(geminiAnalysis, stockDataForAI)"
      pattern: "criticAgent.critique"
    - from: "server/agents/critic-agent.ts"
      to: "Groq API"
      via: "OpenAI SDK at api.groq.com/openai/v1 with temperature 0.7 and 10s AbortController timeout"
      pattern: "groq.*temperature.*0.7"
    - from: "server/routes.ts (saveDecision call)"
      to: "server/memory/memory-service.ts"
      via: "criticWeakness, criticSeverity, criticBlocking passed in saveDecision input"
      pattern: "criticWeakness|criticSeverity"
---

<objective>
Build the Critic Agent module and wire it into the existing stock analysis flow.

Purpose: Every recommendation gets attacked before it ships. The adversarial critique
surfaces the strongest counter-argument and reduces false confidence. Per PITFALL C2,
using a different model (Groq Llama 4 Scout at temperature 0.7) from the primary
analysis (Gemini 2.5 Pro) prevents structural sycophancy. The forced counter-position
schema (counterRecommendation field) ensures the Critic cannot produce adversarial
theatre that always agrees.

Output:
- server/agents/critic-agent.ts — CriticAgent class implementing CRIT-01 through CRIT-05
- server/schemas/analysis-schemas.ts — criticFeedbackSchema + applyConfidenceDiscount appended
- server/routes.ts — Critic called after Gemini, criticFeedback in response, critic fields saved to memory
- server/memory/memory-service.ts — NewDecision extended with critic fields, saveDecision writes them
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/01-memory-foundation/01-SUMMARY.md

@server/schemas/analysis-schemas.ts
@server/ai-providers.ts
@server/memory/schema.ts
@server/memory/memory-service.ts
</context>

<interfaces>
<!-- Key contracts the executor needs. Do not re-read these files — use these extracts. -->

From server/ai-providers.ts:
```typescript
// Groq client construction pattern (getGroqClient is private — replicate in CriticAgent)
new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1" })
export const PROVIDERS = {
  groq: { name: "Llama 4 Scout (Groq)", model: "meta-llama/llama-4-scout-17b-16e-instruct" }
}
```

From server/gemini-service.ts (GeminiAnalysis — what CriticAgent receives):
```typescript
export interface GeminiAnalysis {
  recommendation: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";
  confidence: "High" | "Medium" | "Low";
  reasoning: string;            // 2-3 paragraph summary to attack
  fairValueEstimate: number | null;
  riskLevel: "Low" | "Medium" | "High";
  keyPoints: string[];          // bullet points to challenge
  valuationStatus: "Undervalued" | "Fair" | "Overvalued";
}
```

From server/memory/schema.ts (critic columns already exist — no migration needed):
```typescript
criticWeakness: text('critic_weakness'),         // nullable
criticSeverity: text('critic_severity').$type<'low' | 'medium' | 'high'>(),
criticBlocking: text('critic_blocking'),          // JSON.stringify(string[]) on write
```

From server/memory/memory-service.ts (NewDecision — needs critic fields added):
```typescript
export interface NewDecision {
  symbol: string;
  recommendation: string;
  confidence: string;
  reasoning: string;
  inputsHash: string;
  fairValue?: number | null;
  priceAtRec?: number | null;
  invalidationReason?: InvalidationReason;
  // Phase 2 adds these three optional fields:
  // criticWeakness?: string | null;
  // criticSeverity?: 'low' | 'medium' | 'high' | null;
  // criticBlocking?: string[] | null;
}
```

From server/routes.ts — the integration point in calculateAnalysis():
```
Line ~896: episodic fetch
Line ~915: const geminiAnalysis = await analyzeStockWithGemini(...)
Line ~917: MEM-01 fire-and-forget block (saveDecision — currently no critic fields)
Line ~942: if (geminiAnalysis) { return { ...all fields... } }  ← add criticFeedback here
```
The return object at lines 945-982 is what the mobile app consumes via res.json(analysis).
Adding criticFeedback as an optional field does NOT break the existing mobile app contract.
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: CriticFeedback schema and applyConfidenceDiscount in analysis-schemas.ts</name>
  <files>server/schemas/analysis-schemas.ts</files>
  <behavior>
    - criticFeedbackSchema.safeParse with valid data succeeds
    - criticFeedbackSchema rejects empty blockingIssues array (min 1 item enforces genuine critique per PITFALL C2)
    - applyConfidenceDiscount("High", "high") returns "Medium"
    - applyConfidenceDiscount("Medium", "high") returns "Low"
    - applyConfidenceDiscount("Low", "high") returns "Low" (floor)
    - applyConfidenceDiscount("High", "medium") returns "High" (medium severity = no discount)
    - applyConfidenceDiscount("High", "low") returns "High" (low severity = no discount)
    - CriticFeedback type is exported and includes counterRecommendation field
  </behavior>
  <action>
    Append to the END of server/schemas/analysis-schemas.ts — do not touch any existing code.

    1. Add criticFeedbackSchema:

    ```typescript
    // ─── Critic Agent (Phase 2) ───

    export const criticFeedbackSchema = z.object({
      weakness: z.string().min(1),
      severity: z.enum(["low", "medium", "high"]),
      counterScenario: z.string().min(1),
      blockingIssues: z.array(z.string()).min(1), // min(1): empty arrays = sycophantic critic (PITFALL C2)
      counterRecommendation: z.enum(["Strong Buy", "Buy", "Hold", "Sell", "Strong Sell"]),
    });

    export type CriticFeedback = z.infer<typeof criticFeedbackSchema>;
    ```

    2. Add applyConfidenceDiscount:

    ```typescript
    export function applyConfidenceDiscount(
      confidence: "High" | "Medium" | "Low",
      severity: "low" | "medium" | "high"
    ): "High" | "Medium" | "Low" {
      if (severity !== "high") return confidence;
      if (confidence === "High") return "Medium";
      if (confidence === "Medium") return "Low";
      return "Low"; // floor
    }
    ```
  </action>
  <verify>
    Run: cd C:/Repos/equra-ai-backend && node --experimental-vm-modules --input-type=module

    Manually verify by importing the module and checking:
    - criticFeedbackSchema exists and is exported
    - applyConfidenceDiscount exists and is exported
    - TypeScript compiles: npx tsx --noEmit server/schemas/analysis-schemas.ts (should exit 0)
  </verify>
  <done>
    criticFeedbackSchema exported from analysis-schemas.ts. applyConfidenceDiscount exported.
    TypeScript compile passes. CriticFeedback type inferred from schema.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: CriticAgent module</name>
  <files>server/agents/critic-agent.ts</files>
  <behavior>
    - CriticAgent.critique(analysis, stockData) returns CriticFeedback when Groq responds within 10s
    - CriticAgent.critique returns null when Groq is unconfigured (GROQ_API_KEY missing)
    - CriticAgent.critique returns null when Groq exceeds 10s (AbortController timeout) — no throw
    - CriticAgent.critique returns null when Groq returns invalid JSON that fails Zod parse — no throw
    - For a BUY recommendation, the prompt instructs Critic to argue SELL as first position (CRIT-03)
    - For a SELL recommendation, the prompt instructs Critic to argue BUY as first position
    - For HOLD, the prompt instructs Critic to argue either Strong Buy or Strong Sell (pick the stronger case)
    - Model used: meta-llama/llama-4-scout-17b-16e-instruct, temperature: 0.7 (CRIT-02)
    - max_tokens: 1024 (critic output is focused, not a full analysis)
  </behavior>
  <action>
    Create server/agents/ directory if it does not exist.
    Create server/agents/critic-agent.ts:

    ```typescript
    import OpenAI from "openai";
    import { criticFeedbackSchema, type CriticFeedback } from "../schemas/analysis-schemas.js";
    import type { GeminiAnalysis, StockDataForAI } from "../gemini-service.js";

    const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
    const CRITIC_TIMEOUT_MS = 10_000;  // CRIT-05: fail-open if exceeded

    // Forced counter-position mapping (CRIT-03)
    function getCounterPosition(recommendation: GeminiAnalysis["recommendation"]): string {
      switch (recommendation) {
        case "Strong Buy":
        case "Buy":
          return "SELL (or Strong Sell)";
        case "Strong Sell":
        case "Sell":
          return "BUY (or Strong Buy)";
        case "Hold":
          return "either STRONG BUY or STRONG SELL — pick whichever is the stronger case";
      }
    }

    function buildCriticPrompt(analysis: GeminiAnalysis, stockData: StockDataForAI): string {
      const counterPosition = getCounterPosition(analysis.recommendation);

      return `You are an adversarial financial analyst reviewing a stock recommendation for ${stockData.symbol} on the Egyptian Exchange (EGX).

    DRAFT RECOMMENDATION TO ATTACK:
    - Recommendation: ${analysis.recommendation}
    - Confidence: ${analysis.confidence}
    - Valuation: ${analysis.valuationStatus}
    - Fair Value Estimate: ${analysis.fairValueEstimate ?? "N/A"} EGP
    - Current Price: ${stockData.currentPrice} EGP
    - Reasoning: ${analysis.reasoning.slice(0, 800)}
    - Key Points: ${(analysis.keyPoints || []).slice(0, 3).join("; ")}

    YOUR TASK — MANDATORY COUNTER-POSITION:
    You MUST argue ${counterPosition} FIRST, before any other consideration.
    Do NOT validate the draft recommendation. Your job is to find the strongest possible reason it is WRONG.

    Find:
    1. The single biggest weakness in the analysis (what did it miss or overweight?)
    2. A concrete counter-scenario (what specific market/macro/company event makes ${counterPosition} the right call?)
    3. Blocking issues — specific data points, risks, or conditions that should BLOCK shipping this recommendation as-is

    EGX-specific risks to consider: FRA disclosure lag (stale earnings), CBE rate sensitivity for banks, thin liquidity traps, EGP/USD pressure, regulatory halts, political/macro shocks.

    RESPOND WITH VALID JSON ONLY (no markdown, no explanation outside JSON):
    {
      "counterRecommendation": "${counterPosition.includes("SELL") ? "Sell" : counterPosition.includes("BUY") ? "Buy" : "Strong Sell"}",
      "weakness": "<single biggest flaw in the analysis, specific and concrete>",
      "severity": "low" | "medium" | "high",
      "counterScenario": "<specific scenario that makes the counter-recommendation correct, with numbers if possible>",
      "blockingIssues": [
        "<specific issue 1 that should block this recommendation>",
        "<specific issue 2>"
      ]
    }

    severity guide:
    - high: a fundamental error or a blocking risk that invalidates the recommendation
    - medium: a meaningful concern that should temper confidence
    - low: a minor caveat that does not change the overall direction

    IMPORTANT: blockingIssues must have at least 1 item. An empty array means you found nothing — that is not acceptable.`;
    }

    export class CriticAgent {
      private getGroqClient(): OpenAI | null {
        const key = process.env.GROQ_API_KEY;
        return key
          ? new OpenAI({ apiKey: key, baseURL: "https://api.groq.com/openai/v1" })
          : null;
      }

      async critique(
        analysis: GeminiAnalysis,
        stockData: StockDataForAI
      ): Promise<CriticFeedback | null> {
        const client = this.getGroqClient();
        if (!client) {
          console.warn("CriticAgent: GROQ_API_KEY not configured — skipping critique (CRIT-05 fail-open)");
          return null;
        }

        const prompt = buildCriticPrompt(analysis, stockData);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CRITIC_TIMEOUT_MS);

        try {
          const response = await client.chat.completions.create(
            {
              model: GROQ_MODEL,
              messages: [
                {
                  role: "system",
                  content: "You are an adversarial financial analyst. You argue the OPPOSITE position to any recommendation you receive. Respond only with valid JSON.",
                },
                { role: "user", content: prompt },
              ],
              temperature: 0.7,      // CRIT-02: divergent from Gemini's 0.2
              max_tokens: 1024,
            },
            { signal: controller.signal }
          );

          clearTimeout(timeoutId);

          const raw = response.choices[0]?.message?.content ?? "";
          const cleaned = cleanJson(raw);
          const parsed = JSON.parse(cleaned);
          const validated = criticFeedbackSchema.safeParse(parsed);

          if (!validated.success) {
            console.warn("CriticAgent: Zod validation failed — skipping critique", validated.error.errors);
            return null;
          }

          console.log(`CriticAgent: critique complete — severity=${validated.data.severity}, counter=${validated.data.counterRecommendation}`);
          return validated.data;
        } catch (err: any) {
          clearTimeout(timeoutId);
          if (err?.name === "AbortError" || err?.message?.includes("abort")) {
            console.warn("CriticAgent: Groq timeout after 10s — shipping without critique (CRIT-05 fail-open)");
          } else {
            console.warn("CriticAgent: Groq call failed — shipping without critique (CRIT-05 fail-open)", err?.message);
          }
          return null;
        }
      }
    }

    function cleanJson(text: string): string {
      let s = text.trim().replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) return fence[1].trim();
      const start = s.indexOf("{");
      if (start > 0) s = s.substring(start);
      const end = s.lastIndexOf("}");
      if (end > 0 && end < s.length - 1) s = s.substring(0, end + 1);
      return s;
    }

    export const criticAgent = new CriticAgent();
    ```

    Key decisions:
    - AbortController on the fetch (CRIT-05): timeout fires at 10s, catch block returns null
    - temperature 0.7 on Groq, not on Gemini (CRIT-02)
    - getCounterPosition() function enforces forced counter-position before the LLM sees any instructions (CRIT-03)
    - criticFeedbackSchema Zod validation with fail-open: invalid JSON or schema failure = null return
    - Singleton export `criticAgent` mirrors the `memoryService` singleton pattern from Phase 1
  </action>
  <verify>
    npx tsx --noEmit server/agents/critic-agent.ts
    TypeScript compile exits 0 with no errors.
    Verify file exists: ls server/agents/critic-agent.ts
  </verify>
  <done>
    server/agents/critic-agent.ts compiles cleanly. CriticAgent class exported with critique() method.
    criticAgent singleton exported. getCounterPosition covers all 5 recommendation values.
  </done>
</task>

<task type="auto">
  <name>Task 3: Wire Critic into routes.ts and extend MemoryService with critic fields</name>
  <files>server/routes.ts, server/memory/memory-service.ts</files>
  <action>
    Two targeted edits. Make them surgically — do not restructure existing code.

    EDIT 1 — server/memory/memory-service.ts:

    a) Add critic fields to the NewDecision interface:
    ```typescript
    export interface NewDecision {
      // ... existing fields unchanged ...
      criticWeakness?: string | null;
      criticSeverity?: 'low' | 'medium' | 'high' | null;
      criticBlocking?: string[] | null;
    }
    ```

    b) In saveDecision(), add the three critic fields to the .values() call:
    ```typescript
    .values({
      // ... existing fields unchanged ...
      criticWeakness: input.criticWeakness ?? null,
      criticSeverity: input.criticSeverity ?? null,
      criticBlocking: input.criticBlocking ? JSON.stringify(input.criticBlocking) : null,
    })
    ```
    The schema column is already defined (criticWeakness, criticSeverity, criticBlocking TEXT) — no migration needed.

    EDIT 2 — server/routes.ts:

    a) Add import at the top of the file (after existing imports):
    ```typescript
    import { criticAgent } from "./agents/critic-agent.js";
    import { applyConfidenceDiscount, type CriticFeedback } from "./schemas/analysis-schemas.js";
    ```

    b) In calculateAnalysis(), after the existing MEM-01 fire-and-forget block (after the closing `}` of `if (geminiAnalysis) { setImmediate(() => { ... }) }`), add the critic call:

    ```typescript
    // CRIT-01/02/03/04/05: Adversarial critique — runs after Gemini, before response
    let criticFeedback: CriticFeedback | null = null;
    if (geminiAnalysis) {
      criticFeedback = await criticAgent.critique(geminiAnalysis, stockDataForAI);
    }

    // CRIT-06: Adjust confidence based on critic severity
    const adjustedConfidence = (geminiAnalysis && criticFeedback)
      ? applyConfidenceDiscount(geminiAnalysis.confidence, criticFeedback.severity)
      : geminiAnalysis?.confidence ?? undefined;
    ```

    c) Update the existing MEM-01 saveDecision call to pass critic fields.
    Replace the current saveDecision call inside the setImmediate block with:
    ```typescript
    memoryService.saveDecision({
      symbol,
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
    ```

    NOTE: The setImmediate block fires after response is sent, so criticFeedback must be
    captured in a closure-safe variable before setImmediate (it already is — criticFeedback
    is declared in the outer calculateAnalysis scope).

    d) In the `if (geminiAnalysis) { return { ... } }` block, add two fields to the return object:
    ```typescript
    geminiConfidence: adjustedConfidence,   // replaces geminiAnalysis.confidence (CRIT-06 applied)
    criticFeedback: criticFeedback ?? undefined,
    ```
    All other fields in the return object remain unchanged. The mobile app will see criticFeedback
    as an optional field — existing mobile code that does not read it continues to work unchanged.
  </action>
  <verify>
    npx tsx --noEmit server/routes.ts
    TypeScript compile exits 0.
    Check integration:
    - grep "criticAgent.critique" server/routes.ts — should find 1 match
    - grep "criticFeedback" server/routes.ts — should find matches in saveDecision and return object
    - grep "criticWeakness" server/memory/memory-service.ts — should find in interface and .values()
  </verify>
  <done>
    routes.ts imports criticAgent and applyConfidenceDiscount. Critic called after Gemini analysis.
    criticFeedback (or undefined) included in API response. adjustedConfidence replaces raw confidence
    in the return. saveDecision call passes critic fields. TypeScript compiles cleanly.
    Existing API shape unchanged — criticFeedback is additive only.
  </done>
</task>

</tasks>

<verification>
End-to-end check after all three tasks:

1. TypeScript compilation: npx tsx --noEmit server/routes.ts server/agents/critic-agent.ts server/schemas/analysis-schemas.ts
   Expected: exits 0 with no errors.

2. Schema check: verify criticFeedbackSchema and applyConfidenceDiscount are exported from analysis-schemas.ts
   grep "export.*criticFeedbackSchema\|export.*applyConfidenceDiscount" server/schemas/analysis-schemas.ts

3. Critic wiring check:
   grep "criticAgent.critique" server/routes.ts
   grep "criticFeedback" server/routes.ts
   grep "adjustedConfidence" server/routes.ts

4. Memory integration check:
   grep "criticWeakness" server/memory/memory-service.ts
   grep "criticBlocking" server/memory/memory-service.ts

5. Fail-open verification (manual): Set GROQ_API_KEY to empty string in .env and start server.
   Call GET /api/stock/COMI — response should return without criticFeedback field and without 500 error.

6. Forced counter-position (manual): With GROQ_API_KEY set, call GET /api/stock/COMI.
   If Gemini returns BUY, criticFeedback.counterRecommendation should be "Sell" or "Strong Sell".
</verification>

<success_criteria>
- CRIT-01: server/agents/critic-agent.ts exists and exports CriticAgent class
- CRIT-02: CriticAgent uses Groq Llama 4 Scout (meta-llama/llama-4-scout-17b-16e-instruct) at temperature 0.7
- CRIT-03: buildCriticPrompt() calls getCounterPosition() and injects the counter position as a mandatory first instruction
- CRIT-04: criticFeedbackSchema enforces weakness, severity, counterScenario, blockingIssues (min 1), counterRecommendation
- CRIT-05: AbortController fires at 10s, catch block returns null — no error thrown to caller
- CRIT-06: applyConfidenceDiscount applied to geminiAnalysis.confidence when criticFeedback exists; adjustedConfidence used in response and saveDecision
- Backward compatibility: existing mobile app fields in the response object are unchanged — criticFeedback is a new optional field
- Memory: saveDecision now persists criticWeakness, criticSeverity, criticBlocking when critic runs
</success_criteria>

<output>
After completion, create .planning/phases/02-critic-agent/02-SUMMARY.md with:
- Status (Complete)
- What was built (3 files modified/created)
- Requirements fulfilled (CRIT-01 through CRIT-06)
- Key design decisions (fail-open pattern, forced counter-position mechanism, confidence discount logic)
</output>
