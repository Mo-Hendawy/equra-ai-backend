---
phase: 03-self-learning
plan: 03
status: Complete
subsystem: meta-agent
tags: [meta-agent, gemini-flash, weekly-cron, thesis-error-filter, balanced-sampling, strategy-diff-endpoint]
requires: [03-01, 03-02]
provides: [MetaAgent class, weekly Sunday 17:00 Cairo cron, GET /api/strategy-diff endpoint]
affects: [server/agents/meta-agent.ts, server/jobs/scoring-jobs.ts, server/routes.ts]
tech-stack:
  added: [server/agents/meta-agent.ts]
  patterns: [balanced sampling (30 recent + 10 random historical), THESIS_ERROR filter at source, minimum-sample guard]
key-files:
  created:
    - server/agents/meta-agent.ts
  modified:
    - server/jobs/scoring-jobs.ts
    - server/routes.ts
---

# Phase 3 Plan 3: Meta-Agent Weekly Evolution Summary

**One-liner:** A weekly Gemini Flash call reviews 30 recent + 10 random historical THESIS_ERROR decisions and writes a new strategy version; the `/api/strategy-diff` endpoint exposes the change.

## What Was Built

**`server/agents/meta-agent.ts`** — `MetaAgent.reviewAndEvolve()`:
1. Calls `memoryService.getScoredDecisionsForMeta(30, 10)` — returns 30 most recent + up to 10 random older THESIS_ERROR decisions with scored outcomes.
2. Skips if fewer than 10 scored decisions exist (logs reason, does not throw).
3. Calls Gemini Flash (`gemini-2.5-flash`, temp 0.5) with the current active strategy + sampled decisions.
4. Writes the new strategy via `memoryService.saveStrategyPrompt` — which atomically flips the active flag.
5. Singleton export `metaAgent` matching the other agent singletons.

**`server/jobs/scoring-jobs.ts`** — new cron `0 17 * * 0` with `{ timezone: 'Africa/Cairo', name: 'meta-agent-weekly' }` calling `metaAgent.reviewAndEvolve()`.

**`server/routes.ts`** — `GET /api/strategy-diff?v1=N&v2=M` — parses ints, fetches both versions, returns `{ v1, v2, diff }` where `diff` is computed via `memoryService.getStrategyDiff`.

## Requirements Fulfilled

| Req | Status | How |
|---|---|---|
| LEARN-03 | Complete | Weekly Meta-Agent cron writes new strategy version |
| LEARN-04 | Complete | Balanced sampling (30 recent + 10 random) prevents overfitting |
| LEARN-05 | Complete | `/api/strategy-diff` exposes version-to-version diff |

## Key Design Decisions

1. **Different model** — Gemini Flash (cheaper, weekly) vs primary `gemini-2.5-pro` used for live analysis. Prevents self-reinforcing artifacts where the same model grades its own work at the same temperature.
2. **THESIS_ERROR at source** — filter is in the DB method (`getScoredDecisionsForMeta`), not the Meta-Agent, so the agent cannot accidentally see poisoned samples (pitfall C1).
3. **Minimum sample guard** — < 10 scored decisions → log skip, do not run. Prevents v2 being written from a single bad week.
4. **Atomic active flip** — delegated to `saveStrategyPrompt`; Meta-Agent only writes text.

## Commits

| Task | Hash | Message |
|---|---|---|
| Meta-Agent + endpoint | 509626d | feat(03-03): Meta-Agent weekly strategy evolution + /api/strategy-diff |

## Self-Check: PASSED

- FOUND: server/agents/meta-agent.ts (MetaAgent, reviewAndEvolve, metaAgent singleton)
- FOUND: server/jobs/scoring-jobs.ts (meta-agent-weekly cron)
- FOUND: server/routes.ts (/api/strategy-diff)
- FOUND: commit 509626d
