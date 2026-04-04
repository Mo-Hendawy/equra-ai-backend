# Features Research — Production Agent Capabilities

**Research Date:** 2026-04-04

## Overview

Six missing capabilities mapped against the 13-stage production agent framework. Each categorized as table stakes (must have), differentiator (competitive edge), or anti-feature (deliberately skip).

---

## 1. Memory System

### Table Stakes
- **Recommendation audit log** — every recommendation stored with timestamp, inputs, reasoning, confidence. Without this, no backtesting, no learning, no accountability. Complexity: Low.
- **Session context** — carry conversation state within a single analysis session (e.g., user asks follow-up). Complexity: Low.

### Differentiators
- **Episodic memory** — store specific lessons ("BUY CIB @ 62 → −8% because momentum in low volume") and inject relevant episodes into future prompts. This is what makes the agent actually learn. Complexity: Medium.
- **Outcome tracking** — automatically check if past recommendations were right after N days. Complexity: Medium (needs scheduled job + price lookup).

### Anti-Features
- **Full conversation history replay** — storing and replaying entire past conversations is token-expensive and mostly noise. Use episodic summaries instead.
- **User-specific memory profiles** — premature for single-user/small-user-base stage. Add when user base grows.

### Dependencies
- Memory must be built FIRST. Critic, Self-Learning, and Autonomy all depend on it.

---

## 2. Critic Agent (Adversarial Self-Evaluation)

### Table Stakes
- **Counter-argument generation** — find the single strongest reason the recommendation is wrong. Not a balanced "on the other hand" — an actual attack. Complexity: Low (prompt engineering).
- **Severity scoring** — rate the counter-argument (low/medium/high) so the Decision Agent can adjust confidence. Complexity: Low.

### Differentiators
- **Domain-specific critique** — critic trained on EGX-specific failure modes (thin liquidity, FRA lag, CBE reversal risk, regulatory halts). Generic critique is worthless for EGX. Complexity: Medium.
- **Confidence discount** — automatically reduce recommendation confidence based on critic severity. "High severity critique → confidence drops 20%". Complexity: Low.
- **Historical pattern matching** — critic checks if similar setups failed before (requires episodic memory). Complexity: Medium.

### Anti-Features
- **Multi-critic debate** — running 3+ critics adds latency and cost without proportional value. One good critic is enough.
- **Human-in-the-loop critic** — defeats the purpose of automation. The critic must be autonomous.

### Dependencies
- Needs Memory (audit log) to be meaningful — critic should reference past failures.
- Needs to run on a DIFFERENT model or temperature than the primary agent to avoid self-agreement.

---

## 3. Self-Learning

### Table Stakes
- **Episodic injection** — paste relevant past failures into the prompt. "Last time similar conditions, we were wrong by 12%." Works immediately with 10+ episodes. Complexity: Low.
- **Recommendation outcome scoring** — after N trading days, check if recommendation was correct. Write outcome back to audit log. Complexity: Medium.

### Differentiators
- **Strategy prompt evolution** — Meta-Agent reviews last 30 decisions weekly, identifies what's working/failing, rewrites the strategy instructions. Prompt is versioned — can diff and rollback. Complexity: Medium.
- **RAG case retrieval** — embed past decisions as vectors, retrieve by context similarity (not ticker name). "Similar macro setup" is more useful than "same stock." Complexity: Medium (LanceDB already available).

### Anti-Features
- **Fine-tuning** — need 500+ labeled decisions minimum. We're not there yet. Premature optimization.
- **Reinforcement learning** — academic, impractical for this scale and domain.
- **Real-time learning** — updating strategy on every decision creates instability. Weekly batch is safer.

### Dependencies
- Needs Memory (decisions table with outcomes).
- Episodic injection needs RAG (LanceDB, already available).
- Strategy evolution needs node-cron for scheduling.

---

## 4. Event-Driven Monitoring

### Table Stakes
- **Price alert triggers** — >5% intraday move triggers re-analysis. Not a notification — a full re-run. Complexity: Medium.
- **CBE rate decision detection** — scheduled CBE meetings + emergency meetings trigger re-analysis of bank stocks. Complexity: Medium.

### Differentiators
- **Tiered priority** — CBE emergency meeting > earnings release > sentiment spike > minor price move. Not all events are equal. Complexity: Low.
- **Context-aware alerts** — alert includes WHY it triggered and what changed, not just "CIB moved 6%." Complexity: Medium.
- **Earnings calendar integration** — auto-detect EGX earnings season, pre-schedule re-analysis. Complexity: Medium.

### Anti-Features
- **Real-time tick streaming** — EGX doesn't support it well. Daily/15-min polling is sufficient.
- **Push notifications to mobile** — adds SSE/WebSocket complexity. Mobile can poll. Add push later.

### Dependencies
- Needs Multi-Agent Architecture (to trigger the full pipeline, not just one endpoint).
- Needs node-cron for polling schedules.

---

## 5. Autonomy

### Table Stakes
- **Scheduled daily analysis** — run analysis on watchlist stocks every morning before market open. Complexity: Low (cron + existing endpoints).
- **Self-managing data refresh** — agent decides when to refresh stale data, not the user. Complexity: Low.

### Differentiators
- **Confidence-based escalation** — if confidence < threshold, flag for user review instead of auto-publishing. Complexity: Low.
- **Proactive watchlist alerts** — "CIB entered your buy zone" without user asking. Complexity: Medium.
- **Autonomous memory management** — agent writes its own episodes and strategy updates. Complexity: Medium.

### Anti-Features
- **Fully autonomous trading** — regulatory + liability. Recommendations only, never execute.
- **Autonomous scope expansion** — agent should not decide to analyze new stocks the user didn't ask about.

### Dependencies
- Needs Monitoring (event triggers).
- Needs Memory (to write episodes autonomously).
- Needs Multi-Agent (to run the full pipeline without HTTP request).

---

## 6. Multi-Agent Architecture

### Table Stakes
- **Agent separation** — Data, Analysis, Critic, Decision as distinct modules with typed interfaces. Complexity: Medium (refactor).
- **Orchestrator** — coordinates the pipeline, handles timeouts and failures. Complexity: Medium.
- **Backward compatibility** — existing API endpoints must return same response shape. Complexity: Low (adapter layer).

### Differentiators
- **Agent-specific model routing** — Data Agent uses no LLM, Analysis uses Flash, Critic uses different model/temperature. Complexity: Low.
- **Fail-open design** — if Critic times out, recommendation ships without critique (degraded, not broken). Complexity: Low.
- **Pipeline observability** — log which agent contributed what to the final output. Complexity: Low.

### Anti-Features
- **Microservices** — separate processes for each agent is massive overhead for a single-instance app. Keep it monolithic.
- **Dynamic routing** — the workflow is fixed (Data → Analysis → Critic → Decision). Don't build a general-purpose agent router.
- **LangChain/LangGraph** — adds abstraction without value for a fixed pipeline.

### Dependencies
- This is the architectural refactor that enables everything else.
- Should be built AFTER Memory (agents need to read/write memory).
- Should be built AFTER Critic (Critic is an agent in the pipeline).

---

## Build Priority (Based on Dependencies)

1. **Memory** — everything depends on it
2. **Critic Agent** — needs memory, enables self-evaluation
3. **Self-Learning** — needs memory + critic outcomes
4. **Multi-Agent Architecture** — refactor existing code into agent modules
5. **Monitoring** — needs multi-agent pipeline to trigger
6. **Autonomy** — needs monitoring + memory + multi-agent

## Complexity Summary

| Capability | Estimated Effort | New Dependencies |
|------------|-----------------|-----------------|
| Memory | 2-3 days | better-sqlite3, drizzle-orm |
| Critic Agent | 1-2 days | None (prompt engineering) |
| Self-Learning | 3-4 days | node-cron |
| Multi-Agent | 3-4 days | None (refactor) |
| Monitoring | 2-3 days | None (node-cron already added) |
| Autonomy | 2-3 days | None (composes existing) |
