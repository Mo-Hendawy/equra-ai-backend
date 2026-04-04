# Equra AI Agent — From Prototype to Production

## What This Is

Equra AI is a stock analysis agent for the Egyptian Exchange (EGX). It fetches market data, runs AI-powered analysis (valuation, technicals, sentiment), and delivers buy/hold/sell recommendations to Egyptian retail investors via a React Native mobile app. Currently a working prototype — covers data collection, basic reasoning, and multi-provider AI routing. Missing the 6 production-grade capabilities that separate a real agent from a prompt with tools.

## Core Value

**The agent must give trustworthy, self-improving stock recommendations** — every recommendation should be better than the last because the agent remembers its mistakes, challenges its own logic, and evolves its strategy over time.

## Requirements

### Validated

- ✓ Multi-source data collection (EODHD + TradingView + CNBC fallbacks) — existing
- ✓ RAG hybrid retrieval (query expansion + RRF + keyword re-rank over financial PDFs) — existing
- ✓ Chain-of-thought reasoning with reasoningSteps — existing
- ✓ 5-point recommendation scale (Strong Buy → Strong Sell) with confidence — existing
- ✓ Multi-provider AI routing (Gemini/Groq/Cerebras/Qwen) — existing
- ✓ Zod schema validation with retry on malformed AI responses — existing
- ✓ Price cascade with stale cache fallback — existing
- ✓ FinBERT sentiment analysis via HuggingFace — existing
- ✓ Manus AI deep-dive async analysis — existing
- ✓ Portfolio, Compare, Deploy Capital, Behavior analysis endpoints — existing
- ✓ React Native mobile app with portfolio tracking — existing

### Active

- [ ] **Memory System** — Session memory (conversation context), long-term memory (decision history DB), episodic memory (case store with lessons learned)
- [ ] **Critic Agent** — Adversarial second agent that attacks every recommendation before it ships, finds the strongest counter-argument
- [ ] **Self-Learning** — Recommendation audit log, backtesting framework, episodic injection into prompts, weekly strategy prompt evolution via Meta-Agent
- [ ] **Event-Driven Monitoring** — Price alerts (>5% move), CBE rate decisions, earnings releases, sentiment spikes trigger automatic re-analysis
- [ ] **Autonomy** — Scheduled analysis runs, proactive alerts to users, self-managing data refresh, escalation only when confidence is low
- [ ] **Multi-Agent Architecture** — Orchestrator coordinating specialized agents (Data Agent, Analysis Agent, Critic Agent, Decision Agent) instead of single monolithic prompt

### Out of Scope

- Fine-tuning a custom model — need 500+ labeled decisions first, we're not there yet
- Real-time tick-by-tick data — EGX doesn't support it well, daily/intraday is sufficient
- Automated trade execution — regulatory and liability reasons, recommendations only
- Arabic NLP — English-first, Arabic later as a separate milestone
- Mobile app redesign — focus on backend agent capabilities, mobile consumes the API

## Context

- **Domain:** Egyptian Exchange (EGX) — thin liquidity, regulatory halts, FRA disclosure lags, CBE rate sensitivity, EGP/USD pressure
- **Stack:** TypeScript/Express, Gemini (primary), LanceDB (RAG), deployed on Railway
- **Users:** Egyptian retail investors who don't have Bloomberg terminals
- **Article reference:** "Most AI Agents Are Just Prompts in Disguise" — the 13-stage framework that defines what "great" looks like
- **Current state:** 7/13 stages implemented, 6 gaps to close
- **Existing improvement plan:** `docs/AI-AGENT-IMPROVEMENT-PLAN.md` covers prompt engineering + tool use + RAG improvements. This project covers the bigger architectural gaps.

## Constraints

- **Tech stack**: TypeScript/Node.js — all new code must be TypeScript, no Python
- **Database**: LanceDB for vectors, need to add a persistent store (SQLite or similar) for memory/audit log
- **API costs**: Must keep Gemini API costs manageable — route cheap tasks to deterministic code, only use frontier models for reasoning
- **Mobile backward compatibility**: New endpoints must not break existing mobile app API contract
- **Deployment**: Railway — must work within Railway's constraints (no cron natively, use external scheduler or in-process intervals)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build memory before critic | Critic needs historical context to be useful — "last time this setup failed" requires episodic memory | Pending |
| SQLite for audit log + memory | Lightweight, embedded, no infra overhead — fits Railway deployment | Pending |
| Single orchestrator pattern | Not full microservices — one Express server, agents as internal modules with clear interfaces | Pending |
| Episodic injection before fine-tuning | Works immediately with 10+ episodes, no training infra needed | Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone:**
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-04 after initialization*
