---
phase: 05-monitoring-autonomy
plan: 02
status: Complete
subsystem: observability
tags: [pino, structured-logging, price-freshness, confidence-flag]
requires: [05-01]
provides: [shared pino logger, per-agent structured log events, stale-price rejection, low-confidence flag]
affects: [server/logger.ts, server/agents/*, server/memory/memory-service.ts, server/routes.ts]
tech-stack:
  added: [server/logger.ts]
  patterns: [child-logger per agent, structured event payloads, duration_ms on every pipeline step]
key-files:
  created:
    - server/logger.ts
  modified:
    - server/agents/orchestrator.ts
    - server/agents/data-agent.ts
    - server/agents/analysis-agent.ts
    - server/agents/critic-agent.ts
    - server/agents/decision-agent.ts
    - server/memory/memory-service.ts
    - server/routes.ts
---

# Phase 5 Plan 2: Structured Observability Summary

**One-liner:** Shared pino logger replaces `console.log` in all five agent files; orchestrator asserts price freshness (< 2h) and flags low-confidence results for user review.

## What Was Built

**`server/logger.ts`** — shared pino instance; pretty transport in development, JSON in production. Re-exported as `logger` for all agents and services.

**Per-agent structured events** — every agent emits `logger.info({ agent, symbol, duration_ms }, 'step complete')` at entry and exit. Orchestrator emits an aggregate pipeline log with each child agent's duration.

**`server/agents/orchestrator.ts`** — AUTO-02 freshness assertion: rejects `priceTimestamp` older than 2 hours with a structured `logger.warn` and returns a degraded `PipelineResult` that the caller surfaces to the user. AUTO-03 low-confidence escalation: after DecisionAgent returns adjusted confidence, if it resolves to Low (<50%), the pipeline tags `needsReview: true` in the result.

**`server/memory/memory-service.ts`, `server/routes.ts`** — `console.log` replaced with `logger.{info|warn|error}` structured calls throughout the hot path.

## Requirements Fulfilled

| Req | Status | How |
|---|---|---|
| OBS-01 | Complete | Shared pino logger across all agents |
| OBS-02 | Complete | Structured `{ agent, symbol, duration_ms }` events per pipeline step |
| AUTO-02 | Complete | Orchestrator rejects prices older than 2 hours |
| AUTO-03 | Complete | `needsReview: true` flag on Low confidence outputs |

## Key Design Decisions

1. **Child loggers per agent** — `logger.child({ agent: 'data-agent' })` gives every agent its own named context without repeated `.info({ agent: '...' })`.
2. **Freshness at the orchestrator (not the data agent)** — keeps DataAgent responsible for fetching, Orchestrator responsible for guarding quality, DecisionAgent responsible for writing.
3. **Soft flag, not hard block** — low-confidence results still ship with `needsReview: true` rather than being withheld. The mobile UI renders the flag; the decision still reaches the user.

## Commits

| Task | Hash | Message |
|---|---|---|
| Logger + freshness + confidence flag (combined) | f74d909 | feat(05): monitoring, autonomy, observability — Phase 5 complete |

## Self-Check: PASSED

- FOUND: server/logger.ts
- FOUND: structured logger calls in all 5 agent files
- FOUND: priceTimestamp freshness check in orchestrator.ts
- FOUND: commit f74d909
