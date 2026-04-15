---
phase: 05-monitoring-autonomy
plan: 01
status: Complete
subsystem: monitoring
tags: [event-bus, price-monitor, cbe-monitor, cooldown, priority-queue, watchlist-cron]
requires: [Phase 4 orchestrator]
provides: [monitoringBus, startPriceMonitor, startCbeMonitor, watchlist cron at 15:45 Cairo]
affects: [server/monitoring/*, server/jobs/scoring-jobs.ts, server/index.ts]
tech-stack:
  added: [server/monitoring/monitoring-bus.ts, price-monitor.ts, cbe-monitor.ts, pino dependency]
  patterns: [EventEmitter with 24h per-symbol cooldown, priority ordering, volume-gated alerts]
key-files:
  created:
    - server/monitoring/monitoring-bus.ts
    - server/monitoring/price-monitor.ts
    - server/monitoring/cbe-monitor.ts
  modified:
    - server/jobs/scoring-jobs.ts
    - server/index.ts
    - package.json
---

# Phase 5 Plan 1: Monitoring + Autonomy Summary

**One-liner:** Event-driven autonomy layer — a priority-ordered EventEmitter bus collects price-move and CBE-decision alerts with 24h per-symbol cooldown; orchestrator listens and triggers autonomous re-analysis.

## What Was Built

**`server/monitoring/monitoring-bus.ts`** — singleton `monitoringBus` extending `EventEmitter`. Exports `AlertType` and `AlertPriority` enums (`CBE_EMERGENCY > EARNINGS > SENTIMENT_SPIKE > CBE_DECISION > PRICE_MOVE`). Internal `Map<symbol, Map<AlertType, lastFiredAt>>` enforces 24h cooldown per (symbol, type) before re-emitting. Supersedes lower-priority queued alerts if a higher one arrives within the cooldown window.

**`server/monitoring/price-monitor.ts`** — `startPriceMonitor()` registers a 15-minute `setInterval` (only runs during EGX market hours 10:00–14:30 Cairo). For each `WATCHLIST_SYMBOLS` env symbol, fetches EODHD last-tick + 30-day-avg volume. Emits `PRICE_MOVE` only when `|pctChange| > 5%` AND `volume > 50% of 30-day average` (pitfall M2 — circuit-breaker noise guard).

**`server/monitoring/cbe-monitor.ts`** — `startCbeMonitor()` registers a 2-hour poll of EODHD Egypt news feed. Matches headlines against a small keyword set (`rate`, `CBE`, `MPC`, `inflation`). On match for a bank symbol watchlist, emits `CBE_DECISION` or `CBE_EMERGENCY` based on severity.

**`server/jobs/scoring-jobs.ts`** — new `watchlist-daily` cron `45 15 * * 1-5` (Africa/Cairo) triggers `orchestrator.run()` for each watchlist symbol post-close (pitfall C5 — post-market only).

**`server/index.ts`** — calls `startPriceMonitor()` + `startCbeMonitor()` after routes register. `monitoringBus.on('alert', …)` is subscribed in `index.ts` and dispatches to orchestrator when `USE_ORCHESTRATOR=true`.

**`package.json`** — added `pino` + `pino-pretty` devDep for the next plan.

## Requirements Fulfilled

| Req | Status | How |
|---|---|---|
| MON-01 | Complete | `startPriceMonitor` 15-min EODHD poll |
| MON-02 | Complete | Volume-gated (>50% of 30d avg) alert emission |
| MON-03 | Complete | Priority ordering in `monitoringBus` |
| MON-04 | Complete | 24h per-symbol cooldown (L3 fatigue guard) |
| AUTO-01 | Complete | Watchlist cron at 15:45 Cairo Mon-Fri |
| AUTO-04 | Complete | Bus subscriber triggers orchestrator.run() |

## Key Design Decisions

1. **Volume-gated alerts (pitfall M2)** — a 5% move on thin volume is noise, not signal. `startPriceMonitor` requires `vol > 50% of 30d avg` before emitting.
2. **24h cooldown (pitfall L3)** — same (symbol, alertType) cannot fire twice in 24h. Prevents alert fatigue when a stock oscillates around a threshold.
3. **Priority queue supersede** — if a `PRICE_MOVE` is cooled down but a `CBE_EMERGENCY` arrives, the higher-priority alert fires anyway.
4. **Post-close watchlist (pitfall C5)** — autonomous re-analysis runs at 15:45 after EGX close (14:30) to avoid intraday data hazards.

## Commits

| Task | Hash | Message |
|---|---|---|
| Monitoring + autonomy (combined commit) | f74d909 | feat(05): monitoring, autonomy, observability — Phase 5 complete |

## Self-Check: PASSED

- FOUND: server/monitoring/monitoring-bus.ts, price-monitor.ts, cbe-monitor.ts
- FOUND: watchlist cron in server/jobs/scoring-jobs.ts
- FOUND: startPriceMonitor + startCbeMonitor called in server/index.ts
- FOUND: commit f74d909
