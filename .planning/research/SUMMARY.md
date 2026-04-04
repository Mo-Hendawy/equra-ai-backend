# Research Summary — Production Agent Upgrade

**Synthesized:** 2026-04-04
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

---

## Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Memory store | better-sqlite3 + drizzle-orm | Embedded, zero infra, Railway-compatible, type-safe |
| Agent framework | None — TypeScript modules | Fixed workflow doesn't need LangGraph/Mastra overhead |
| Critic model | Groq (Llama 4 Scout) at temp 0.7 | Different model than primary = less sycophancy, free tier, fast |
| Scheduling | node-cron (in-process) | No Redis needed, fits Railway single-instance |
| Logging | pino | Structured JSON, 5-10x faster than Winston, Railway-native |
| Architecture | Monolith-hosted orchestrator | Agents as internal modules, not microservices |

## Build Order

```
Phase 1: Memory (SQLite + drizzle schema)
    ↓ everything depends on memory
Phase 2: Critic Agent (adversarial review module)
    ↓ needs memory for historical context
Phase 3: Self-Learning (audit scoring + episodic injection + meta-agent)
    ↓ needs memory + critic outcomes
Phase 4: Multi-Agent Architecture (refactor into orchestrator + agents)
    ↓ needs all agents defined
Phase 5: Monitoring + Autonomy (event triggers + scheduled runs)
    ↓ needs multi-agent pipeline to trigger
```

**Why this order:** Memory is the foundation — without the audit log, the Critic can't reference history, self-learning can't score outcomes, and autonomy can't log what it did. Each phase gates the next.

## Critical Risks (Top 3)

1. **Poisoned feedback loop (C1)** — Agent learns wrong lessons from macro shocks. MUST add `invalidationReason` enum to filter learning input.

2. **Sycophantic critic (C2)** — Critic agrees with analysis because same model/temp. MUST use different model AND force counter-position schema.

3. **Stale memory injection (C3)** — Old episodes injected into new analyses with different macro conditions. MUST add `validUntil` dates and macro-regime tags.

## Scope Confirmation

### In Scope (This Milestone)
- SQLite memory system (3 tables: decisions, episodes, strategy_prompts)
- Critic Agent module with forced counter-position
- Recommendation outcome scoring (backtest after N days)
- Episodic injection into analysis prompts
- Weekly Meta-Agent strategy evolution
- Multi-agent refactor (Orchestrator → Data → Analysis → Critic → Decision)
- Event-driven monitoring (price alerts, CBE triggers)
- Scheduled autonomous analysis (daily watchlist runs)
- Structured logging (pino)

### Out of Scope (Confirmed)
- Fine-tuning (need 500+ labeled decisions first)
- Microservices (single-instance is sufficient)
- Real-time tick streaming (EGX doesn't support well)
- Push notifications to mobile (mobile polls REST)
- Arabic NLP (separate milestone)
- Automated trade execution (regulatory reasons)

## New Dependencies

```bash
npm install better-sqlite3 drizzle-orm node-cron pino
npm install -D @types/better-sqlite3 drizzle-kit pino-pretty
```

~2.5MB bundle impact. No new infrastructure services.

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|-------------|
| 1. Memory | 2-3 days | None |
| 2. Critic | 1-2 days | Phase 1 |
| 3. Self-Learning | 3-4 days | Phase 1 |
| 4. Multi-Agent | 3-4 days | Phases 1-3 |
| 5. Monitoring + Autonomy | 3-4 days | Phase 4 |
| **Total** | **~14 days** | Sequential |
