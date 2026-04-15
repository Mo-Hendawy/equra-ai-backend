---
phase: 04-multi-agent-architecture
plan: 01
status: Complete
subsystem: agent-pipeline
tags: [orchestrator, data-agent, analysis-agent, decision-agent, feature-flag, single-writer, timeouts]
requires: [Phase 1 memory, Phase 2 critic, Phase 3 strategy + episodic]
provides: [Agent<TInput,TOutput> interface, DataAgent, AnalysisAgent, DecisionAgent, AgentOrchestrator, USE_ORCHESTRATOR feature flag]
affects: [server/agents/*, server/routes.ts]
tech-stack:
  added: [server/agents/types.ts, data-agent.ts, analysis-agent.ts, decision-agent.ts, orchestrator.ts]
  patterns: [singleton per agent, 30s per-agent timeout via Promise.race, single-writer DecisionAgent, feature-flag parity]
key-files:
  created:
    - server/agents/types.ts
    - server/agents/data-agent.ts
    - server/agents/analysis-agent.ts
    - server/agents/decision-agent.ts
    - server/agents/orchestrator.ts
  modified:
    - server/agents/critic-agent.ts
    - server/routes.ts
---

# Phase 4: Multi-Agent Architecture Summary

**One-liner:** Decomposes monolithic analysis into four specialized agents (Data → Analysis → Critic → Decision) sequenced by an Orchestrator with 30s per-agent timeouts, behind the `USE_ORCHESTRATOR` feature flag. Same API response shape.

## What Was Built

**`server/agents/types.ts`** — `Agent<TInput, TOutput>` interface plus the four agent I/O type pairs and a `PipelineResult` top-level type. Every agent exports `run(input): Promise<output>`.

**`server/agents/data-agent.ts`** — deterministic-only. Wraps price cascade (EODHD → Alpha Vantage → manual quotes), episodic RAG search, sentiment fetch. No LLM calls. Returns `DataAgentOutput`.

**`server/agents/analysis-agent.ts`** — wraps `analyzeStockWithGemini` with the episodic context from `DataAgentOutput` already injected. Does NOT write to SQLite.

**`server/agents/critic-agent.ts`** — existing Phase 2 class formalized to the `Agent<TInput, TOutput>` interface. Same fail-open semantics; `critique()` is now `run()`.

**`server/agents/decision-agent.ts`** — only agent that writes to memory. Applies `applyConfidenceDiscount` to merge critic severity with analysis confidence, then calls `memoryService.saveDecision` (pitfall C6 guard — single writer).

**`server/agents/orchestrator.ts`** — sequences Data → Analysis → Critic → Decision. Each `run()` wrapped in `Promise.race([agent, timeout(30000)])`. Critic timeout returns `null` and pipeline continues (fail-open). Returns `PipelineResult`.

**`server/routes.ts`** — `USE_ORCHESTRATOR=true` routes `/api/analysis/:symbol` (and the three calendar-adjacent endpoints) through `orchestrator.run(...)`; response adapter maps `PipelineResult` back to the legacy response shape. `USE_ORCHESTRATOR=false` or unset routes through the unchanged `calculateAnalysis`.

## Requirements Fulfilled

| Req | Status | How |
|---|---|---|
| ARCH-01..08 | Complete | Interface, four specialized agents, orchestrator, timeouts, single-writer, feature-flag parity |

## Key Design Decisions

1. **Single writer (pitfall C6)** — only `DecisionAgent` touches `memoryService.saveDecision`. Prevents write contention and double-logging when refactors happen later.
2. **Critic fail-open preserved** — Critic timeout returns null; pipeline continues to DecisionAgent, which handles null as "no discount."
3. **Feature flag parity** — response shape adapter keeps the mobile app unchanged. Flag planned to sunset within 2 weeks (pitfall M5 time-boxed).
4. **No LLM in DataAgent (pitfall C4)** — explicit DAG + timeouts + zero blocking LLM in the data layer prevents pipeline deadlock.

## Commits

| Task | Hash | Message |
|---|---|---|
| Interfaces + Data/Analysis/Critic agents | efd96e7 | feat(04-01): agent interfaces + DataAgent + AnalysisAgent + CriticAgent formalized |
| DecisionAgent + Orchestrator + flag | 49c5b97 | feat(04-01): DecisionAgent + Orchestrator + feature flag wiring |

## Self-Check: PASSED

- FOUND: server/agents/types.ts, data-agent.ts, analysis-agent.ts, decision-agent.ts, orchestrator.ts
- FOUND: USE_ORCHESTRATOR flag in routes.ts
- FOUND: commits efd96e7, 49c5b97
