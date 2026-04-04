# Stack Research — Production Agent Capabilities

**Research Date:** 2026-04-04

## Existing Stack (Keep As-Is)

| Technology | Version | Purpose |
|------------|---------|---------|
| TypeScript | ~5.9.2 | All server code |
| Express | ^5.0.1 | HTTP server |
| @google/generative-ai | ^0.24.1 | Gemini AI |
| openai SDK | ^6.22.0 | Multi-provider (Groq, Cerebras, Qwen) |
| @lancedb/lancedb | ^0.26.2 | RAG vector storage |
| Zod | ^4.3.6 | AI response validation |
| tsx | ^4.20.6 | TypeScript execution |

## New Dependencies by Capability

### 1. Memory Store (Audit Log + Episodic Memory)

**Recommendation: `better-sqlite3` + `drizzle-orm`**

| Package | Purpose |
|---------|---------|
| better-sqlite3 | Embedded SQL — zero infra, Railway-compatible, WAL mode for concurrent reads |
| drizzle-orm | Type-safe query builder — lighter than Prisma (no binary engine), works with better-sqlite3 natively |
| drizzle-kit | Migration CLI — schema migrations as .sql files |

**Three-table schema:**
- `decisions` — audit log (ticker, recommendation, confidence, reasoning, timestamp, outcome)
- `episodes` — episodic cases (ticker, setup, outcome, lesson, embedding for retrieval)
- `conversation_turns` — session memory (session_id, role, content, timestamp)

**Rejected alternatives:**
- Prisma — binary engine ~50MB, slow Railway cold starts
- Turso/libsql — adds network dependency and cost
- PostgreSQL — requires separate Railway service
- Redis — extra service, only justified for multi-instance

### 2. Critic Agent

**No new library needed.** Internal module using existing Gemini SDK.

- Primary analysis: `gemini-2.5-flash` at temperature 0.2
- Critic: `llama-4-scout-17b` via Groq at temperature 0.7 (divergent, free tier, fast)

### 3. Self-Learning (Backtesting + Meta-Agent)

| Package | Purpose |
|---------|---------|
| node-cron | Schedule weekly Meta-Agent runs and daily backtest scoring — in-process, no Redis |

**Backtesting:** Pure TypeScript. Query decisions table → fetch current price → compute return → write outcome.

**Episodic retrieval:** Use existing LanceDB + gemini-embedding-001 to embed episode descriptions, retrieve top-3 similar at inference.

**Meta-Agent:** Weekly cron job reads last N decisions + outcomes, writes revised strategy to `strategy_prompts` SQLite table.

**Rejected:** LangGraph.js (pre-1.0 instability), BullMQ (requires Redis), Agenda (requires MongoDB).

### 4. Event-Driven Monitoring

**No new library.** `node-cron` (already added above) + Node.js built-in `EventEmitter`.

Poll EODHD every 15 minutes for price changes. EventEmitter for internal pub/sub.

**Rejected:** BullMQ (requires Redis), WebSockets (mobile polls REST, don't add complexity preemptively).

### 5. Multi-Agent Orchestration

**No new library.** TypeScript interfaces + dependency injection.

Each agent is a class implementing `Agent<TInput, TOutput>`. Orchestrator is a sequential pipeline.

**Rejected:**
- LangGraph.js — pre-1.0, overkill for fixed workflow
- Mastra — pre-1.0 as of Aug 2025, assumes LLM routing ownership (conflicts with existing multi-provider)
- LangChain.js — abstraction overhead, complex debugging
- AutoGen/CrewAI — Python-only

### 6. Observability

| Package | Purpose |
|---------|---------|
| pino | Structured JSON logging — 5-10x faster than Winston, Railway reads JSON natively |
| pino-pretty | Dev-time formatting (devDependency) |

**Rejected:** Winston (3-5x slower), OpenTelemetry (15+ deps, requires collector service).

## Install Command

```bash
# Runtime
npm install better-sqlite3 drizzle-orm node-cron pino

# Dev
npm install -D @types/better-sqlite3 drizzle-kit pino-pretty
```

**Bundle impact:** ~2.5MB added (better-sqlite3 native binary dominates).

## Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Memory store (better-sqlite3 + Drizzle) | MEDIUM | Pattern solid; verify versions on npm |
| Critic agent (no new lib) | HIGH | Architecture pattern, no dependency |
| Self-learning (node-cron + custom) | MEDIUM | Stable lib; verify version |
| Event monitoring (EventEmitter + cron) | HIGH | Built-in Node.js, no risk |
| Multi-agent (module pattern) | HIGH | Pure TypeScript, no dependency |
| Observability (pino) | MEDIUM | Well-established; verify version |

## Build Order Implication

Phase 1 (Memory) installs better-sqlite3 + drizzle-orm first. All other phases depend on memory being in place.
