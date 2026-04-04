# Architecture Research — Multi-Agent AI System

**Research Date:** 2026-04-04

## Recommended Pattern: Monolith-Hosted Orchestrator

One Express server, agents as TypeScript modules in `server/agents/`, memory in `server/memory/`. No microservices, no HTTP between agents. This keeps deployment simple (Railway) and avoids network latency between agent calls.

## Five Core Components

### 1. AgentOrchestrator (`server/agents/orchestrator.ts`)
- Sequences the pipeline: Data → Analysis → Critic → Decision
- Owns no analysis logic itself — just coordination
- Handles timeouts, retries, and graceful degradation
- Entry point for all analysis requests

### 2. DataAgent (`server/agents/data-agent.ts`)
- All deterministic data fetching — no LLM calls
- Wraps existing price cascade (EODHD → TradingView → CNBC → cache)
- Wraps RAG retrieval and FinBERT sentiment
- Returns structured data context for Analysis Agent

### 3. AnalysisAgent (`server/agents/analysis-agent.ts`)
- Wraps existing `ai-providers.ts` and `gemini-service.ts`
- Adds episodic injection: queries memory for similar past analyses
- Injects past failures/successes into the prompt context
- Produces draft recommendation with reasoning

### 4. CriticAgent (`server/agents/critic-agent.ts`)
- Adversarial review using Gemini 2.5 Pro (or different model than Analysis)
- Receives the draft recommendation, tries to break it
- Returns: weakness, severity, counter_scenario
- Fail-open: if Critic fails, recommendation ships without critique (degraded, not blocked)

### 5. DecisionAgent (`server/agents/decision-agent.ts`)
- Deterministic synthesis: merges Analysis output + Critic feedback
- Adjusts confidence based on Critic severity
- Sole writer to SQLite memory (single-writer pattern)
- Produces final structured recommendation

## Memory Architecture (`server/memory/`)

### Storage: SQLite (better-sqlite3)
- `recommendations` table: symbol, date, recommendation, confidence, reasoning, outcome
- `episodes` table: symbol, context_hash, lesson, created_at
- `strategy_versions` table: version, prompt_text, created_at, performance_score

### Three Memory Types
- **Session:** In-memory Map, cleared per request (conversation context)
- **Long-term:** SQLite `recommendations` table (decision history, outcomes)
- **Episodic:** SQLite `episodes` table (specific lessons learned from past failures)

### Access Pattern
- AnalysisAgent reads episodes (for injection)
- DecisionAgent writes recommendations and episodes
- Meta-Agent reads recommendations for strategy evolution (weekly)

## Data Flow

```
Request → Orchestrator
  → DataAgent (fetch prices, fundamentals, RAG, sentiment)
  → AnalysisAgent (LLM reasoning + episodic injection from memory)
  → CriticAgent (adversarial review of draft)
  → DecisionAgent (final synthesis + write to memory)
  → Response (same API shape as current, with added fields)
```

## Build Order (Each Layer Gates the Next)

| Layer | Component | Depends On | Why This Order |
|-------|-----------|------------|----------------|
| 1 | MemoryService (SQLite) | Nothing | Everything else needs memory |
| 2 | DataAgent | MemoryService | Refactors existing data fetching into agent |
| 3 | AnalysisAgent | DataAgent, MemoryService | Needs data + episodic memory |
| 4 | CriticAgent | AnalysisAgent | Needs draft recommendation to critique |
| 5 | DecisionAgent | CriticAgent, MemoryService | Merges analysis + critique, writes memory |
| 6 | Orchestrator | All agents | Coordinates the pipeline |
| 7 | Route Adapter | Orchestrator | Adapts new pipeline to existing API endpoints |

## Key Design Principles

- **Backward-compatible:** Feature flag toggles new pipeline vs old path. Response shape adapter ensures mobile app works unchanged.
- **Single-writer memory:** Only DecisionAgent writes to SQLite — prevents race conditions.
- **Fail-open:** CriticAgent failure degrades gracefully (recommendation ships without critique), not 500 error.
- **Fire-and-forget memory writes:** Audit log writes happen after response is sent — don't block the user.
- **No new infrastructure:** SQLite is embedded, no new database server needed. Fits Railway deployment.

## Integration with Existing Code

- `routes.ts` — add feature flag check: if enabled, route through Orchestrator; else, use existing `gemini-service.ts` directly
- `ai-providers.ts` — used internally by AnalysisAgent and CriticAgent, not replaced
- `rag-service.ts` — used internally by DataAgent, not replaced
- `schemas/analysis-schemas.ts` — extended with new fields (criticFeedback, episodicContext, auditId)
