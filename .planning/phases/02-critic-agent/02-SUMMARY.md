---
phase: 02-critic-agent
plan: 01
status: Complete
subsystem: critic-agent
tags: [critic, adversarial, groq, llama, confidence-discount, fail-open]
requires: [Phase 1 memory foundation — decisions table with critic columns]
provides: [CriticAgent module, criticFeedbackSchema, applyConfidenceDiscount, critic wiring in calculateAnalysis]
affects: [server/routes.ts calculateAnalysis response shape, decisions table rows]
tech-stack:
  added: [server/agents/critic-agent.ts]
  patterns: [fail-open null return, forced counter-position schema, AbortController timeout, singleton export]
key-files:
  created:
    - server/agents/critic-agent.ts
  modified:
    - server/schemas/analysis-schemas.ts
    - server/routes.ts
    - server/memory/memory-service.ts
decisions:
  - Critic declared before MEM-01 setImmediate so closure captures final criticFeedback value
  - temperature 0.7 on Groq vs Gemini primary to prevent structural sycophancy (CRIT-02)
  - blockingIssues min(1) in Zod schema prevents sycophantic empty critique (PITFALL C2)
  - adjustedConfidence replaces geminiAnalysis.confidence in both response and saveDecision
metrics:
  duration: 8 minutes
  completed: 2026-04-05
  tasks: 3
  files: 4
---

# Phase 2 Plan 1: Critic Agent Summary

**One-liner:** Adversarial Groq Llama 4 Scout critic at temperature 0.7 with forced counter-position schema and 10s fail-open timeout wired into the stock analysis pipeline.

## What Was Built

Three tasks completed, four files modified/created:

**Task 1 — criticFeedbackSchema + applyConfidenceDiscount (`server/schemas/analysis-schemas.ts`)**
- Appended `criticFeedbackSchema` (Zod) with 5 fields: weakness, severity (enum low/medium/high), counterScenario, blockingIssues (min 1), counterRecommendation
- `CriticFeedback` type exported via `z.infer`
- `applyConfidenceDiscount()` exported: high severity drops confidence one step (High→Medium, Medium→Low, Low→Low floor); medium/low severity = no change

**Task 2 — CriticAgent module (`server/agents/critic-agent.ts`)**
- `CriticAgent` class with `critique(analysis, stockData)` method
- Groq client uses OpenAI SDK at `api.groq.com/openai/v1`, model `meta-llama/llama-4-scout-17b-16e-instruct`, temperature 0.7
- `getCounterPosition()` maps all 5 recommendation values to forced counter position (CRIT-03)
- `AbortController` fires at 10s → catch block returns `null` — no throw to caller (CRIT-05)
- Zod validation on parsed response — invalid shape returns `null` (fail-open)
- `cleanJson()` helper strips think tags, markdown fences, surrounding text
- `criticAgent` singleton exported matching Phase 1 `memoryService` pattern

**Task 3 — Routes + Memory wiring (`server/routes.ts`, `server/memory/memory-service.ts`)**
- `NewDecision` interface extended with `criticWeakness?`, `criticSeverity?`, `criticBlocking?`
- `saveDecision()` writes critic fields; `criticBlocking` serialized as `JSON.stringify(string[])`
- Imports added: `criticAgent` and `applyConfidenceDiscount` + `CriticFeedback` type
- Critic called after Gemini analysis, before response: `await criticAgent.critique(geminiAnalysis, stockDataForAI)`
- `adjustedConfidence` computed (CRIT-06) and used in both the return object and `saveDecision`
- `criticFeedback` added as optional field in Gemini analysis return object (backward compatible)
- Existing mobile app fields unchanged — purely additive

## Requirements Fulfilled

| Requirement | Status | How |
|-------------|--------|-----|
| CRIT-01 | Complete | `server/agents/critic-agent.ts` exports `CriticAgent` class |
| CRIT-02 | Complete | Groq Llama 4 Scout, temperature 0.7 vs Gemini primary |
| CRIT-03 | Complete | `getCounterPosition()` enforces counter-position in prompt |
| CRIT-04 | Complete | `criticFeedbackSchema` with all 5 fields including `blockingIssues` min(1) |
| CRIT-05 | Complete | `AbortController` 10s timeout, catch returns null, no 500 error |
| CRIT-06 | Complete | `applyConfidenceDiscount()` applied, `adjustedConfidence` in response and memory |

## Key Design Decisions

**1. Fail-open null return pattern (CRIT-05)**
The `critique()` method returns `null` on any failure — timeout, missing API key, invalid JSON, Zod validation failure. The caller in `routes.ts` handles `null` by using `geminiAnalysis.confidence` unmodified and omitting `criticFeedback` from the response. No 500 errors possible from the critic path.

**2. Forced counter-position before prompt (CRIT-03)**
`getCounterPosition()` is called before the LLM sees any instructions. The counter position string is injected as a mandatory first clause. The JSON template in the prompt hardcodes the expected `counterRecommendation` value to reinforce it. This prevents the LLM from "agreeing" with the analysis in adversarial theatre.

**3. Critic declared before setImmediate (closure correctness)**
The critic call runs before the MEM-01 `setImmediate` block. This ensures `criticFeedback` is fully resolved before `setImmediate` captures it in its closure. `setImmediate` fires after response is sent — `criticFeedback` is already a stable value by then.

**4. Temperature divergence (CRIT-02)**
Gemini runs at its default configuration (controlled by gemini-service.ts). Groq Critic explicitly uses `temperature: 0.7`. This prevents structural sycophancy where two models using the same sampling temperature tend to produce correlated outputs.

**5. blockingIssues min(1) (PITFALL C2 guard)**
The Zod schema enforces `z.array(z.string()).min(1)` — an empty `blockingIssues` array fails validation and returns null. This prevents a sycophantic critic that produces the required fields but populates `blockingIssues: []` to avoid challenging the recommendation.

## Commits

| Task | Hash | Message |
|------|------|---------|
| Task 1: Schema | 1ee2793 | feat(02-critic-agent-01): add criticFeedbackSchema and applyConfidenceDiscount |
| Task 2: CriticAgent | e060206 | feat(02-critic-agent-01): create CriticAgent module with Groq Llama 4 Scout |
| Task 3: Wiring | 3a95847 | feat(02-critic-agent-01): wire CriticAgent into routes.ts and extend MemoryService |

## Deviations from Plan

None — plan executed exactly as written.

The only structural note: the plan's task order for EDIT 2 in Task 3 described adding the critic call "after the MEM-01 fire-and-forget block." However, to correctly pass `criticFeedback` to `saveDecision` (which runs inside `setImmediate`), the critic call was placed BEFORE the `setImmediate` block so the variable is resolved before closure capture. This matches the plan's own NOTE that says "criticFeedback must be captured in a closure-safe variable before setImmediate (it already is)."

## Known Stubs

None — all critic fields are wired end-to-end. When `GROQ_API_KEY` is configured, a live Groq call executes and `criticFeedback` is populated in both the API response and the SQLite `decisions` row.

## Self-Check: PASSED

All files found:
- FOUND: server/agents/critic-agent.ts
- FOUND: server/schemas/analysis-schemas.ts
- FOUND: server/routes.ts
- FOUND: server/memory/memory-service.ts

All commits found:
- FOUND: 1ee2793 (Task 1)
- FOUND: e060206 (Task 2)
- FOUND: 3a95847 (Task 3)
