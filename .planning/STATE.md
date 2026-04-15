# Project State

**Project:** Equra AI — Production Agent Upgrade
**Status:** Milestone Complete
**Current Phase:** —
**Next Action:** Commit + deploy to Railway; run `eas init` in `equra-ai-mobile` for production push

## Milestone: v1 — Production Agent + Dividend Calendar

| Phase | Status | Started | Completed |
|-------|--------|---------|-----------|
| 1. Memory Foundation | Complete | 2026-04-04 | 2026-04-04 |
| 2. Critic Agent | Complete | 2026-04-05 | 2026-04-05 |
| 3. Self-Learning | Complete | 2026-04-06 | 2026-04-06 |
| 4. Multi-Agent Architecture | Complete | 2026-04-06 | 2026-04-06 |
| 5. Monitoring & Autonomy | Complete | 2026-04-06 | 2026-04-06 |
| 6. Dividend Calendar Notifications | Complete | 2026-04-15 | 2026-04-15 |

## Decisions

| Phase | Decision |
|-------|----------|
| Phase 2 | Critic declared before setImmediate so closure captures resolved criticFeedback |
| Phase 2 | temperature 0.7 on Groq/Gemini Flash Critic to prevent structural sycophancy (CRIT-02) |
| Phase 2 | blockingIssues min(1) in Zod schema prevents sycophantic empty critique (PITFALL C2) |
| Phase 2 | adjustedConfidence replaces geminiAnalysis.confidence in both response and saveDecision (CRIT-06) |
| Phase 3 | THESIS_ERROR-only filter at DB method source (not agent) — Meta-Agent cannot see poisoned samples |
| Phase 3 | Balanced sampling 30 recent + 10 random historical prevents overfitting to recent week |
| Phase 3 | Different model for Meta-Agent (Flash) vs live analysis (Pro) — no self-reinforcement |
| Phase 4 | Single-writer pattern — only DecisionAgent calls memoryService.saveDecision (pitfall C6) |
| Phase 4 | USE_ORCHESTRATOR feature flag for old/new path parity; time-boxed to 2 weeks (pitfall M5) |
| Phase 5 | Volume-gated alerts (>50% of 30d avg) to avoid circuit-breaker noise (pitfall M2) |
| Phase 5 | 24h per-(symbol, alertType) cooldown to prevent alert fatigue (pitfall L3) |
| Phase 6 | Use The Events Calendar REST API directly, not HTML scraping (brittle-source mitigation) |
| Phase 6 | Smart batching 1 / 2–4 / 5+ over one-per-event to prevent push spam on busy days |
| Phase 6 | Anonymous device token registration (no per-user opt-in yet — future extension) |
| Phase 6 | SHA-1 snapshot hash + transactional diffAndUpsert for race-safe change detection |

## Performance Metrics

| Phase | Plan | Tasks | Files |
|-------|------|-------|-------|
| 02 | 01 | 3 | 4 |
| 03 | 01 | 1 | 2 |
| 03 | 02 | 3 | 3 |
| 03 | 03 | 3 | 3 |
| 04 | 01 | 2 | 7 |
| 05 | 01 | 4 | 6 |
| 05 | 02 | 2 | 8 |
| 05 | 03 | 2 | 2 |
| 06 | 01 | ~12 | 16 |

## Follow-Ups

- Run `eas init` in `c:/Repos/equra-ai-mobile` and replace `extra.eas.projectId` placeholder in `app.json`
- Commit Phase 6 files: `feat(06): dividend calendar notifications`
- Deploy backend to Railway — new tables auto-create on startup
- Build Expo dev client to verify push end-to-end on a real device (Expo Go cannot receive remote push since SDK 53)

## Session

**Last session:** 2026-04-15
**Stopped at:** Milestone close-out — 8 SUMMARY.md files retroactively authored, Phase 6 added and documented.
