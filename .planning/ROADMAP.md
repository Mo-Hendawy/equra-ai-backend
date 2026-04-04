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

**Key deliverables:**
- Install node-cron
- Daily backtest job: query decisions >5 trading days old, fetch current price, score outcome
- Strategy prompt versioning in strategy_prompts table
- Weekly Meta-Agent job: review last 30 decisions + 10 random historical, write new strategy version
- Balanced sampling (macro regime diversity)
- Prompt diff endpoint (compare two strategy versions)
- Analysis prompts read latest strategy version from DB

**Critical pitfall watch:** C5 (data hazards — schedule after market close), M3 (survivorship bias — keep delisted), M4 (overfitting — balanced sample)

**Success criteria:** After 1 week, strategy_prompts has v1 and v2. Diff shows concrete changes. Analysis prompts use the latest strategy.

---

## Phase 4: Multi-Agent Architecture

**Goal:** Refactor monolithic analysis into orchestrated agent pipeline. Each agent has one job.

**Requirements:** ARCH-01 through ARCH-08

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

**Key deliverables:**
- Install pino + pino-pretty
- EventEmitter-based monitoring bus
- Price alert monitor (15-min polling, >5% + volume threshold)
- CBE rate decision detector
- Tiered priority system
- 24-hour cooldown per stock per alert type
- Scheduled daily watchlist analysis (node-cron, after 15:30 Cairo)
- Price timestamp freshness assertion
- Confidence-based escalation (< 50% → flag for review)
- Autonomous episode writing after outcome scoring
- /health and /metrics endpoints
- Structured pino logging across all agents

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
