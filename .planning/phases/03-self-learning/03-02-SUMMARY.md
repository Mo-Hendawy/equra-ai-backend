---
phase: 03-self-learning
plan: 02
status: Complete
subsystem: strategy-versioning
tags: [strategy, prompt-injection, seed, versioning, diff]
requires: [Phase 1 strategy_prompts table]
provides: [saveStrategyPrompt, getStrategyByVersion, getStrategyDiff, seedInitialStrategy, ACTIVE STRATEGY block injection]
affects: [server/memory/memory-service.ts, server/gemini-service.ts, server/jobs/scoring-jobs.ts]
tech-stack:
  patterns: [one-time seed guard, active-row uniqueness via isActive flag, prepend-to-prompt strategy block]
key-files:
  modified:
    - server/memory/memory-service.ts
    - server/gemini-service.ts
    - server/jobs/scoring-jobs.ts
---

# Phase 3 Plan 2: Strategy Versioning + Injection Summary

**One-liner:** Every analysis reads the current active strategy from `strategy_prompts` and prepends it to the Gemini prompt as an `ACTIVE STRATEGY` block; v1 is seeded once on server start.

## What Was Built

**`server/memory/memory-service.ts`** — three new methods.
- `saveStrategyPrompt(promptText, version?)` inserts a new row, deactivates the previously active row in the same transaction so only one row is `is_active=1` at a time.
- `getStrategyByVersion(version)` returns `{ version, promptText, createdAt, isActive } | null`.
- `getStrategyDiff(v1Text, v2Text)` returns an added/removed line-diff string for the `/api/strategy-diff` endpoint.
- `seedInitialStrategy()` one-time guard: no-op if any row already exists; otherwise writes v1 with a baseline EGX analysis checklist.

**`server/gemini-service.ts`** — `analyzeStockWithGemini` calls `memoryService.getLatestStrategyPrompt()` before prompt construction and prepends an `ACTIVE STRATEGY (v{n}):\n{text}\n\n` block ahead of episodic context.

**`server/jobs/scoring-jobs.ts`** — `registerScoringJobs()` calls `seedInitialStrategy()` once at registration time so v1 exists before any analysis runs.

## Requirements Fulfilled

| Req | Status | How |
|---|---|---|
| LEARN-02 | Complete | `strategy_prompts` active row injected into every analysis prompt |
| LEARN-05 | Complete | Versioning + `getStrategyDiff` enable rollback and audit |

## Key Design Decisions

1. **Single active row** — `saveStrategyPrompt` deactivates the prior active row in the same transaction so races cannot produce two active versions.
2. **One-time seed guard** — `seedInitialStrategy` checks for any existing row before writing v1; safe to call on every restart.
3. **Prompt block position** — strategy block prepended ahead of episodic context so the model reads rules first, then past lessons.

## Commits

| Task | Hash | Message |
|---|---|---|
| Strategy versioning + injection | 324742e | feat(03-02): strategy versioning + prompt injection + seed v1 |

## Self-Check: PASSED

- FOUND: server/memory/memory-service.ts (saveStrategyPrompt, getStrategyByVersion, getStrategyDiff, seedInitialStrategy)
- FOUND: server/gemini-service.ts (ACTIVE STRATEGY block)
- FOUND: server/jobs/scoring-jobs.ts (seedInitialStrategy call)
- FOUND: commit 324742e
