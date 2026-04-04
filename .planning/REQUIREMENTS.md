# Requirements: Equra AI — Production Agent Upgrade

**Defined:** 2026-04-04
**Core Value:** The agent must give trustworthy, self-improving stock recommendations.

## v1 Requirements

### Memory System

- [ ] **MEM-01**: Every recommendation stored in SQLite with symbol, date, recommendation, confidence, reasoning, inputs hash
- [ ] **MEM-02**: Outcome scoring — after N trading days, fetch current price and compute return, write to decisions.outcome
- [ ] **MEM-03**: Episodic memory — store specific lessons with context, lesson text, validUntil date, macroRegime tag
- [ ] **MEM-04**: Episodic injection — retrieve top-3 relevant episodes at analysis time and inject into prompt
- [ ] **MEM-05**: invalidationReason enum on decisions (THESIS_ERROR, MACRO_SHOCK, DATA_STALE, TIMING) — only THESIS_ERROR feeds learning

### Critic Agent

- [ ] **CRIT-01**: Separate Critic module that receives draft recommendation and attacks it
- [ ] **CRIT-02**: Critic uses different model/temperature than primary analysis (Groq Llama at temp 0.7)
- [ ] **CRIT-03**: Forced counter-position — if Analysis says BUY, Critic must argue SELL first
- [ ] **CRIT-04**: Structured output: weakness, severity (low/medium/high), counterScenario, blockingIssues[]
- [ ] **CRIT-05**: Fail-open — if Critic times out (10s), recommendation ships without critique
- [ ] **CRIT-06**: Confidence discount — high severity critique reduces confidence by 15-25%

### Self-Learning

- [ ] **LEARN-01**: Daily backtest job — score recommendations older than 5 trading days against actual price
- [ ] **LEARN-02**: Strategy prompt versioning — store strategy instructions in strategy_prompts table with version number
- [ ] **LEARN-03**: Weekly Meta-Agent — review last 30 decisions, identify patterns, write new strategy version
- [ ] **LEARN-04**: Meta-Agent balanced sampling — include random historical decisions from different macro regimes
- [ ] **LEARN-05**: Prompt diff capability — can compare strategy v4.2 vs v4.3 to see what changed

### Multi-Agent Architecture

- [ ] **ARCH-01**: Agent interface — typed `Agent<TInput, TOutput>` contract for all agents
- [ ] **ARCH-02**: DataAgent — wraps existing price cascade + RAG + sentiment into single module
- [ ] **ARCH-03**: AnalysisAgent — wraps existing Gemini/multi-provider analysis + episodic injection
- [ ] **ARCH-04**: CriticAgent — adversarial review (from CRIT requirements above)
- [ ] **ARCH-05**: DecisionAgent — merges analysis + critique, sole writer to memory
- [ ] **ARCH-06**: Orchestrator — sequences pipeline with per-agent 30s timeouts
- [ ] **ARCH-07**: Backward compatibility — existing API endpoints return same response shape via adapter
- [ ] **ARCH-08**: Feature flag — toggle new pipeline vs old path, time-boxed to 2 weeks

### Monitoring & Autonomy

- [ ] **MON-01**: Price alert triggers — >5% move on volume >50% of 30-day average triggers re-analysis
- [ ] **MON-02**: CBE rate decision detection — triggers re-analysis of bank stocks
- [ ] **MON-03**: Tiered priority — CBE emergency > earnings > sentiment spike > price move
- [ ] **MON-04**: 24-hour cooldown per stock per alert type
- [ ] **AUTO-01**: Scheduled daily analysis — run watchlist stocks after 15:30 Cairo time
- [ ] **AUTO-02**: Price timestamp freshness assertion — reject if data >2 hours old
- [ ] **AUTO-03**: Confidence-based escalation — if confidence < 50%, flag for user review
- [ ] **AUTO-04**: Autonomous episode writing — agent writes its own lessons after outcome scoring

### Observability

- [ ] **OBS-01**: Structured logging via pino — all agent steps logged as JSON
- [ ] **OBS-02**: Pipeline observability — log which agent contributed what to final output
- [ ] **OBS-03**: /health and /metrics endpoints — decisions today, critic overrides, avg confidence, backtest accuracy

## v2 Requirements (Deferred)

### Advanced Learning
- **LEARN-v2-01**: RAG case retrieval — embed past decisions as vectors, retrieve by context similarity
- **LEARN-v2-02**: Fine-tuning on 500+ labeled decisions
- **LEARN-v2-03**: A/B testing prompt variants

### Mobile
- **MOB-v2-01**: Push notifications for price alerts (SSE or WebSocket)
- **MOB-v2-02**: Arabic NLP support

## Out of Scope

| Feature | Reason |
|---------|--------|
| Automated trade execution | Regulatory + liability |
| Real-time tick streaming | EGX doesn't support well |
| Microservices architecture | Single-instance sufficient |
| User-specific memory profiles | Premature for current user base |
| Multi-critic debate | One critic is sufficient, extra adds latency |
