# Roadmap: Equra AI — Production Agent Upgrade

**Created:** 2026-04-04
**Granularity:** Coarse (5 phases)
**Mode:** YOLO

## Phase Overview

| Phase | Name | Goal | Effort | Dependencies |
|-------|------|------|--------|-------------|
| 1 | Memory Foundation | SQLite store + audit log + episodic memory + injection | 2-3 days | None |
| 2 | Critic Agent | Adversarial review module with forced counter-position | 1-2 days | Phase 1 |
| 3 | Self-Learning | Backtest scoring + Meta-Agent strategy evolution | 3-4 days | Phases 1, 2 |
| 4 | Multi-Agent Architecture | Refactor into Orchestrator + 4 specialized agents | 3-4 days | Phases 1-3 |
| 5 | Monitoring & Autonomy | Event-driven triggers + scheduled analysis + observability | 3-4 days | Phase 4 |

---

## Phase 1: Memory Foundation

**Goal:** Every recommendation gets logged. Past failures get injected into future analyses. The agent remembers.

**Requirements:** MEM-01, MEM-02, MEM-03, MEM-04, MEM-05

**Plans:** 1 plan

Plans:
- [ ] 01-memory-foundation-01-PLAN.md — Install better-sqlite3 + drizzle-orm, create memory module (db + schema + MemoryService), wire episodic injection into Gemini prompt, log decisions fire-and-forget after each analysis, register three outcome scoring cron jobs

**Key deliverables:**
- Install better-sqlite3 + drizzle-orm
- Schema: decisions, episodes, strategy_prompts tables
- MemoryService class (read/write interface)
- Episodic injection into existing gemini-service analysis prompts
- invalidationReason enum on decisions
- validUntil + macroRegime on episodes

**Critical pitfall watch:** C1 (poisoned feedback), C3 (stale injection), C6 (write contention — single-writer pattern)

**Success criteria:** Run an analysis → check SQLite → recommendation is logged. Run another analysis for same stock → episodic context appears in the prompt.

---

## Phase 2: Critic Agent

**Goal:** Every recommendation gets attacked before it ships. The strongest counter-argument is visible in the output.

**Requirements:** CRIT-01, CRIT-02, CRIT-03, CRIT-04, CRIT-05, CRIT-06

**Plans:** 1 plan

Plans:
- [ ] 02-critic-agent-01-PLAN.md — CriticFeedback Zod schema + applyConfidenceDiscount, CriticAgent class using Groq Llama 4 Scout at temp 0.7 with 10s fail-open timeout, wire into calculateAnalysis after Gemini, add criticFeedback to response and critic fields to saveDecision

**Key deliverables:**
- CriticAgent module in server/agents/critic-agent.ts
- Uses Groq Llama 4 Scout at temperature 0.7
- Forced counter-position schema (counterRecommendation required)
- Structured output: weakness, severity, counterScenario, blockingIssues[]
- 10-second timeout with fail-open
- Confidence discount logic (high severity → -20%)
- Integrate into existing analysis flow (after analysis, before response)

**Critical pitfall watch:** C2 (sycophantic critic — must use different model + forced counter)

**Success criteria:** Run analysis → output includes criticFeedback field with a non-trivial counter-argument. Force a timeout → recommendation ships without critique (no 500).

---

## Phase 3: Self-Learning

**Goal:** The agent gets better over time. Past recommendations are scored. Strategy evolves weekly.

**Requirements:** LEARN-01, LEARN-02, LEARN-03, LEARN-04, LEARN-05

**Plans:** 3 plans

Plans:
- [ ] 03-01-PLAN.md — Real backtest scoring: fetchCurrentPrice from EODHD, compute % return, write outcome_5d/30d/90d, auto-generate episode for bad outcomes (>5% wrong direction, THESIS_ERROR only)
- [ ] 03-02-PLAN.md — Strategy versioning: seed v1 into strategy_prompts on startup, inject active strategy into analyzeStockWithGemini, add saveStrategyPrompt/getStrategyByVersion/getStrategyDiff/seedInitialStrategy to MemoryService
- [ ] 03-03-PLAN.md — Meta-Agent: MetaAgent class using Gemini Flash, balanced sampling (30 recent + 10 random historical), THESIS_ERROR filter, weekly cron Sunday 17:00 Cairo, /api/strategy-diff endpoint

**Critical pitfall watch:** C5 (data hazards — schedule after market close), M3 (survivorship bias — keep delisted), M4 (overfitting — balanced sample)

**Success criteria:** After 1 week, strategy_prompts has v1 and v2. Diff shows concrete changes. Analysis prompts use the latest strategy.

---

## Phase 4: Multi-Agent Architecture

**Goal:** Refactor monolithic analysis into orchestrated agent pipeline. Each agent has one job.

**Requirements:** ARCH-01 through ARCH-08

**Plans:** 1 plan

Plans:
- [ ] 04-01-PLAN.md — Agent<TInput,TOutput> interface + DataAgent + AnalysisAgent + formalize CriticAgent; then DecisionAgent + Orchestrator + USE_ORCHESTRATOR feature flag wiring in routes.ts with response adapter

**Key deliverables:**
- Agent<TInput, TOutput> interface
- DataAgent (wraps price cascade + RAG + sentiment)
- AnalysisAgent (wraps Gemini + episodic injection)
- CriticAgent (already built in Phase 2, now formalized)
- DecisionAgent (merges analysis + critique, writes memory)
- Orchestrator (sequences pipeline, 30s per-agent timeouts)
- Response adapter (new pipeline → same API shape)
- Feature flag toggle (new vs old path)

**Critical pitfall watch:** C4 (deadlock — explicit DAG + timeouts), C6 (write contention — only DecisionAgent writes), M5 (feature flag drift — time-box to 2 weeks)

**Success criteria:** Same API endpoint returns same response shape. Pipeline logs show each agent's contribution. Timeout on Critic → graceful degradation.

---

## Phase 5: Monitoring & Autonomy

**Goal:** The agent runs itself. It watches for events, triggers re-analysis, and logs everything.

**Requirements:** MON-01 through MON-04, AUTO-01 through AUTO-04, OBS-01 through OBS-03

**Plans:** 3 plans

Plans:
- [ ] 05-01-PLAN.md — Install pino, EventEmitter MonitoringBus with 24h cooldown + tiered priority, PriceMonitor (15-min EODHD poll, >5% move on volume >50% 30d avg), CbeMonitor (2h news poll, keyword detection), AUTO-01 watchlist cron at 15:45 Cairo
- [ ] 05-02-PLAN.md — Shared pino logger (server/logger.ts), replace console.log in all 5 agent files, OBS-02 per-agent structured log events, AUTO-02 price freshness assertion in Orchestrator, AUTO-03 low-confidence flagging
- [ ] 05-03-PLAN.md — getMetrics() on MemoryService (decisionsToday, criticOverrides, avgConfidence, backtestAccuracy), /health and /api/metrics endpoints in routes.ts

**Critical pitfall watch:** C5 (data hazards — post-market only), M2 (circuit breaker noise — volume threshold), L3 (alert fatigue — cooldown)

**Success criteria:** Server starts → cron jobs registered. Price moves 6% on good volume → re-analysis triggered automatically. /metrics shows today's decisions, critic overrides, backtest accuracy.

---

## Milestone Complete When

All 5 phases delivered. The agent:
1. Remembers every recommendation it made
2. Challenges its own logic before shipping
3. Scores past recommendations against reality
4. Evolves its strategy weekly based on what worked
5. Runs autonomously, watching for market events
6. Logs everything with structured observability

This is the difference between a prompt with tools and a production agent.
