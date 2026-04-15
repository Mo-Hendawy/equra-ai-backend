---
phase: 05-monitoring-autonomy
plan: 03
status: Complete
subsystem: observability-endpoints
tags: [health, metrics, getMetrics, backtest-accuracy, critic-overrides]
requires: [05-01, 05-02]
provides: [memoryService.getMetrics(), GET /api/health, GET /api/metrics]
affects: [server/memory/memory-service.ts, server/routes.ts]
tech-stack:
  patterns: [computed-at-query-time metrics (no materialized counters)]
key-files:
  modified:
    - server/memory/memory-service.ts
    - server/routes.ts
---

# Phase 5 Plan 3: Health + Metrics Endpoints Summary

**One-liner:** Two runtime endpoints — `/api/health` for liveness and `/api/metrics` for today's decisions, critic overrides, average confidence, and backtest accuracy — all computed live from the SQLite `decisions` table.

## What Was Built

**`server/memory/memory-service.ts`** — `getMetrics()` returns:
- `decisionsToday` — `COUNT(*)` where `created_at >= start of today (Africa/Cairo)`.
- `criticOverrides` — `COUNT(*)` where `critic_severity = 'high'` AND the confidence was discounted.
- `avgConfidence` — average numeric confidence across the last 30 days, mapped from High/Medium/Low to 85/60/35.
- `backtestAccuracy` — of decisions with `outcome_5d IS NOT NULL`, percentage where direction was correct.

**`server/routes.ts`** — `GET /api/health` returns `{ status: 'ok', uptime, timestamp, orchestrator: USE_ORCHESTRATOR === 'true' }`. `GET /api/metrics` calls `memoryService.getMetrics()` and returns the JSON directly.

## Requirements Fulfilled

| Req | Status | How |
|---|---|---|
| OBS-03 | Complete | `/api/health` + `/api/metrics` both live and computed from DB |

## Key Design Decisions

1. **Computed-at-query-time** — no materialized counters, no maintenance cost. Metrics endpoint is a read-only SQL pass that scales with DB size, which is bounded (~tens of thousands of decisions max before pruning).
2. **Confidence scoring map** — High=85, Medium=60, Low=35 chosen so that a typical balanced set lands around 60 (Medium), matching user expectation when average is neither high nor low.
3. **Cairo midnight boundary** — `decisionsToday` uses Africa/Cairo midnight to match user's local perception, not UTC.

## Commits

| Task | Hash | Message |
|---|---|---|
| getMetrics + endpoints (combined) | f74d909 | feat(05): monitoring, autonomy, observability — Phase 5 complete |

## Self-Check: PASSED

- FOUND: getMetrics method in server/memory/memory-service.ts
- FOUND: /api/health and /api/metrics in server/routes.ts
- FOUND: commit f74d909
