---
phase: 03-self-learning
plan: 01
status: Complete
subsystem: backtest-scoring
tags: [scoring, eodhd, outcome, auto-episode, cron]
requires: [Phase 1 decisions + episodes tables, Phase 2 critic wiring]
provides: [fetchCurrentPrice, scoreOutcome using real EODHD prices, autoEpisodeFromOutcome]
affects: [server/jobs/scoring-jobs.ts, server/memory/memory-service.ts]
tech-stack:
  added: [EODHD EOD price fetch integration]
  patterns: [per-decision try/catch so one failure never aborts a run, fail-silent for delisted symbols, THESIS_ERROR-only auto-episodes]
key-files:
  modified:
    - server/jobs/scoring-jobs.ts
    - server/memory/memory-service.ts
---

# Phase 3 Plan 1: Real Backtest Scoring Summary

**One-liner:** Replace the Phase 1 scoring stub with a live EODHD price fetch that computes % return, writes `outcome_Nd` fields, and auto-generates THESIS_ERROR episodes for bad calls >5% in the wrong direction.

## What Was Built

**`server/jobs/scoring-jobs.ts`** — `fetchCurrentPrice(symbol)` calls `https://eodhd.com/api/eod/{symbol}.EGX`, handles both ascending and descending payload orders, returns `null` on HTTP errors or empty data. `scoreOutcomeWindow('5d'|'30d'|'90d')` iterates `getDecisionsPendingOutcome(window)`, skips decisions with no `priceAtRec` (pitfall M3 — never delete delisted), computes `(current - priceAtRec) / priceAtRec * 100`, writes via `memoryService.scoreOutcome`, then calls `autoEpisodeFromOutcome` when the threshold is crossed.

**`server/memory/memory-service.ts`** — new `autoEpisodeFromOutcome(decisionId, window, outcomePct)` method. Filters to THESIS_ERROR decisions only (pitfall C1 guard — never learn from macro shocks, stale data, or timing errors). Writes an episode with `context = "{window} outcome: {pct}% — {recommendation} was wrong"` and `lesson` auto-generated from the decision's reasoning.

## Requirements Fulfilled

| Req | Status | How |
|---|---|---|
| LEARN-01 | Complete | Real EODHD price fetch, % return computed and stored, auto-episode for bad outcomes |

## Key Design Decisions

1. **Per-decision try/catch** — each symbol's scoring wrapped in its own try so one bad symbol cannot abort the entire job run.
2. **Pitfall M3 (survivorship bias)** — delisted symbols (`priceAtRec` missing or EODHD 404) log a skip and continue; row stays in DB.
3. **Pitfall C1 (poisoned feedback)** — `autoEpisodeFromOutcome` filters to THESIS_ERROR only so market chaos never pollutes the episodic memory.

## Commits

| Task | Hash | Message |
|---|---|---|
| Scoring + auto-episode | 3d72993 | feat(03-01): real backtest scoring + auto-episode from bad outcomes |

## Self-Check: PASSED

- FOUND: server/jobs/scoring-jobs.ts (fetchCurrentPrice, scoreOutcomeWindow)
- FOUND: server/memory/memory-service.ts (autoEpisodeFromOutcome)
- FOUND: commit 3d72993
