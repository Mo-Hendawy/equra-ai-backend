# Phase 1: Memory Foundation - Research

**Researched:** 2026-04-05
**Domain:** SQLite persistence, Drizzle ORM, episodic memory injection, cron scheduling
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MEM-01 | Every recommendation stored in SQLite (symbol, date, recommendation, confidence, reasoning, inputs_hash, fair_value, price_at_rec, invalidation_reason, critic fields) | decisions table schema documented below with exact column set |
| MEM-02 | 3-window outcome scoring — 5-day (daily cron 15:30 Cairo), 30-day (weekly Friday 16:00), 90-day (monthly last Friday). outcome_5d, outcome_30d, outcome_90d columns | node-cron v4 API + Africa/Cairo timezone confirmed; cron expressions documented |
| MEM-03 | Episodic memory — lessons with context, validUntil, macroRegime tag, embedding for similarity search | episodes table + LanceDB vector table pattern confirmed; existing rag-service.ts is the exact reference |
| MEM-04 | Episodic injection — retrieve top-3 relevant episodes at analysis time, inject into prompt | Injection point in analyzeStockWithGemini prompt string identified; LanceDB vectorSearch pattern confirmed |
| MEM-05 | invalidationReason enum (THESIS_ERROR, MACRO_SHOCK, DATA_STALE, TIMING) — only THESIS_ERROR feeds learning | SQLite text column with TypeScript enum enforcement; filtering pattern documented |
</phase_requirements>

---

## Summary

Phase 1 installs the memory substrate the entire production upgrade depends on. Two storage layers are needed: SQLite via `better-sqlite3` + `drizzle-orm` for structured decision records and episode metadata, and a new LanceDB table for episode text embeddings (reusing the exact pattern already in `server/rag-service.ts`). The project is ESM (`"type": "module"` in package.json), Node v24 — both `better-sqlite3` v12 and `drizzle-orm` v0.45 support this cleanly with `import Database from 'better-sqlite3'` syntax.

The injection point for episodic context in `analyzeStockWithGemini` is the prompt string assembled at line ~154 of `server/gemini-service.ts`. Episodic context is prepended before the `STOCK DATA:` section as an `EPISODIC MEMORY` block. No function signature changes are required — the function accepts a `StockDataForAI` object; episodic context is fetched internally by the `MemoryService` using the symbol.

The three outcome-scoring cron jobs use `node-cron` v4 (already recommended in STACK.md) with `timezone: 'Africa/Cairo'` option. Cairo observes DST (UTC+2 in winter, UTC+3 in summer) — the `Africa/Cairo` IANA identifier handles this automatically.

**Primary recommendation:** Build `server/memory/` as a self-contained module (db.ts, schema.ts, memory-service.ts) that exports a singleton `MemoryService` class. The rest of the codebase imports only from this module — never from drizzle or better-sqlite3 directly.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.8.0 | Synchronous SQLite driver | Zero infrastructure, fastest Node.js SQLite driver, WAL mode, Railway-compatible |
| drizzle-orm | 0.45.2 | Type-safe query builder | No binary engine (Prisma has ~50MB), first-class better-sqlite3 support, lightweight |
| node-cron | 4.2.1 | Cron scheduling | In-process, no Redis dependency, timezone support via IANA names, v4 is TypeScript-native |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/better-sqlite3 | 7.6.13 | TypeScript types for better-sqlite3 | Always — devDependency |
| drizzle-kit | 0.31.10 | Migration CLI (generate + migrate) | Schema changes only — not a runtime dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | Prisma | Prisma adds ~50MB binary, slower cold starts on Railway |
| drizzle-orm | raw SQL | Type safety lost; schema drift risk |
| node-cron | BullMQ | BullMQ requires Redis — adds infrastructure |

**Installation:**
```bash
# Runtime
npm install better-sqlite3 drizzle-orm node-cron

# Dev
npm install -D @types/better-sqlite3 drizzle-kit
```

**Verified versions (npm registry, 2026-04-05):**
- better-sqlite3: 12.8.0 (published ~2025)
- drizzle-orm: 0.45.2
- node-cron: 4.2.1
- @types/better-sqlite3: 7.6.13
- drizzle-kit: 0.31.10

---

## Architecture Patterns

### Recommended Project Structure
```
server/
├── memory/
│   ├── db.ts              # Database connection singleton + WAL setup
│   ├── schema.ts          # Drizzle table definitions (3 tables)
│   ├── memory-service.ts  # MemoryService class (read/write interface)
│   └── migrations/        # Generated SQL migrations (drizzle-kit output)
├── jobs/
│   └── scoring-jobs.ts    # node-cron outcome scoring jobs (3 windows)
├── gemini-service.ts      # MODIFIED: episodic injection at prompt build
└── schemas/
    └── analysis-schemas.ts  # UNCHANGED (Zod schemas stay here)
```

### Pattern 1: Database Singleton with WAL Mode

Set pragmas before creating the drizzle instance — WAL must be set on the raw Database object, not via migration SQL.

```typescript
// server/memory/db.ts
// Source: https://github.com/drizzle-team/drizzle-orm/issues/4968
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as path from 'path';
import * as schema from './schema.js';

const DB_PATH = path.join(process.cwd(), 'server', 'data', 'equra-memory.db');

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');     // 5s wait on locked db
sqlite.pragma('synchronous = normal');    // safe + fast

export const db = drizzle({ client: sqlite, schema });
export { sqlite };
```

**Why WAL on the instance:** Setting WAL via `PRAGMA journal_mode = WAL` in a migration file does NOT reliably persist — the pragma must be set on the Database instance before drizzle wraps it. Confirmed via drizzle-orm issue #4968.

### Pattern 2: Drizzle Schema (3 Tables)

```typescript
// server/memory/schema.ts
// Source: https://orm.drizzle.team/docs/sql-schema-declaration
import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const decisions = sqliteTable('decisions', {
  id:                integer('id').primaryKey({ autoIncrement: true }),
  symbol:            text('symbol').notNull(),
  createdAt:         integer('created_at', { mode: 'timestamp' }).notNull()
                       .$defaultFn(() => new Date()),
  recommendation:    text('recommendation').notNull(),   // "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell"
  confidence:        text('confidence').notNull(),        // "High" | "Medium" | "Low"
  reasoning:         text('reasoning').notNull(),
  inputsHash:        text('inputs_hash').notNull(),       // SHA-256 of stock data inputs
  fairValue:         real('fair_value'),
  priceAtRec:        real('price_at_rec'),
  invalidationReason: text('invalidation_reason'),       // "THESIS_ERROR" | "MACRO_SHOCK" | "DATA_STALE" | "TIMING"
  // Critic fields (Phase 2 will populate these; nullable for Phase 1)
  criticWeakness:    text('critic_weakness'),
  criticSeverity:    text('critic_severity'),             // "low" | "medium" | "high"
  criticBlocking:    text('critic_blocking'),             // JSON array stored as text
  // Outcome scoring (MEM-02)
  outcome5d:         real('outcome_5d'),
  outcome30d:        real('outcome_30d'),
  outcome90d:        real('outcome_90d'),
  scored5dAt:        integer('scored_5d_at', { mode: 'timestamp' }),
  scored30dAt:       integer('scored_30d_at', { mode: 'timestamp' }),
  scored90dAt:       integer('scored_90d_at', { mode: 'timestamp' }),
});

export const episodes = sqliteTable('episodes', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  symbol:        text('symbol').notNull(),
  createdAt:     integer('created_at', { mode: 'timestamp' }).notNull()
                   .$defaultFn(() => new Date()),
  lesson:        text('lesson').notNull(),                // agent-generated lesson text (max 200 tokens)
  context:       text('context').notNull(),               // what setup triggered this lesson
  validUntil:    integer('valid_until', { mode: 'timestamp' }),  // MEM-03: expiry
  macroRegime:   text('macro_regime'),                    // MEM-03: e.g. "HIGH_RATES", "RECOVERY", "CRISIS"
  decisionId:    integer('decision_id').references(() => decisions.id),
  // lanceEpisodeId stores the LanceDB row ID for vector retrieval cross-reference
  lanceEpisodeId: text('lance_episode_id'),
});

export const strategyPrompts = sqliteTable('strategy_prompts', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  version:      integer('version').notNull(),
  promptText:   text('prompt_text').notNull(),
  createdAt:    integer('created_at', { mode: 'timestamp' }).notNull()
                  .$defaultFn(() => new Date()),
  performanceScore: real('performance_score'),
  isActive:     integer('is_active', { mode: 'boolean' }).notNull().default(false),
});
```

**Timestamp storage note:** Drizzle's `integer({ mode: 'timestamp' })` stores Unix epoch seconds in SQLite (INTEGER column), and maps to/from JS `Date` objects automatically. This is the standard pattern — do NOT use TEXT for timestamps in this schema.

**JSON in SQLite:** The `criticBlocking` field stores a JSON array as TEXT. Serialize with `JSON.stringify()` before write, `JSON.parse()` after read. Drizzle v0.45 supports `text({ mode: 'json' })` for automatic serialization, but explicit is clearer here given the array type.

### Pattern 3: drizzle.config.ts

```typescript
// drizzle.config.ts (project root)
// Source: https://orm.drizzle.team/docs/drizzle-config-file
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/memory/schema.ts',
  out: './server/memory/migrations',
  dbCredentials: {
    url: './server/data/equra-memory.db',
  },
});
```

**Migration commands:**
```bash
# Generate SQL migrations from schema changes
npx drizzle-kit generate

# Apply migrations to the database
npx drizzle-kit migrate

# For development: push schema directly without migration files
npx drizzle-kit push
```

### Pattern 4: MemoryService Class Interface

```typescript
// server/memory/memory-service.ts
export class MemoryService {
  // MEM-01: Write a new decision
  async saveDecision(input: NewDecision): Promise<number>  // returns decision id

  // MEM-02: Score outcome for a specific window
  async scoreOutcome(
    decisionId: number,
    window: '5d' | '30d' | '90d',
    outcomePercent: number
  ): Promise<void>

  // MEM-03: Save an episode (lesson learned)
  async saveEpisode(input: NewEpisode): Promise<number>

  // MEM-04: Retrieve top-N relevant episodes for a symbol
  async getRelevantEpisodes(
    symbol: string,
    currentMacroRegime: string,
    limit: number = 3
  ): Promise<Episode[]>

  // MEM-05: Mark a decision as invalidated
  async invalidateDecision(
    decisionId: number,
    reason: InvalidationReason
  ): Promise<void>

  // Self-learning queries
  async getDecisionsByWindow(window: '5d' | '30d' | '90d'): Promise<Decision[]>
  async getLatestStrategyPrompt(): Promise<StrategyPrompt | null>
}

export type InvalidationReason = 'THESIS_ERROR' | 'MACRO_SHOCK' | 'DATA_STALE' | 'TIMING';
```

### Pattern 5: Episodic Injection into analyzeStockWithGemini

The injection point is the prompt string in `analyzeStockWithGemini()` (gemini-service.ts, line ~154). Episodic context is inserted between the function signature and the `STOCK DATA:` section.

```typescript
// server/gemini-service.ts — MODIFIED signature
export async function analyzeStockWithGemini(
  stockData: StockDataForAI,
  skipCache: boolean = false,
  episodicContext?: string       // NEW optional parameter
): Promise<GeminiAnalysis | null>

// Inside the function, build episodicBlock before the prompt:
const episodicBlock = episodicContext
  ? `\n\nEPISODIC MEMORY (lessons from past analyses of similar setups):\n${episodicContext}\n`
  : '';

const prompt = `You are an expert stock analyst specializing in the Egyptian Exchange (EGX).
${episodicBlock}
STOCK DATA:
...`
```

**Where episodic context is fetched:** The caller (routes.ts line ~896) fetches from `MemoryService.getRelevantEpisodes(symbol, macroRegime)` before calling `analyzeStockWithGemini`. The episodes are formatted as a numbered list, max 200 tokens each, max 3 items.

**Format of injected episodes:**
```
EPISODIC MEMORY (lessons from past analyses of similar setups):
1. [2025-11-15] HRHO — High-CBE-rate regime: P/E-based thesis was correct but CBE rate cut took 3 months longer than expected. Avoid over-weighting timing signals.
2. [2025-12-03] COMI — Bank sector re-rating: Banks re-rated sharply when CBE cut rates. Monitor CBE meeting dates as a trigger condition.
3. [2025-12-20] FWRY — Fintech discount: Market applies 25-30% discount to fintech P/E vs regional peers. Adjust fair value accordingly.
```

### Pattern 6: node-cron Scoring Jobs

```typescript
// server/jobs/scoring-jobs.ts
// Source: node-cron v4 API (https://nodecron.com/migrating-from-v3)
import cron from 'node-cron';

// MEM-02: 5-day scoring — daily at 15:30 Cairo
cron.schedule('30 15 * * *', async () => {
  await scoreOutcomeWindow('5d');
}, { timezone: 'Africa/Cairo', name: 'score-5d' });

// MEM-02: 30-day scoring — every Friday at 16:00 Cairo
cron.schedule('0 16 * * 5', async () => {
  await scoreOutcomeWindow('30d');
}, { timezone: 'Africa/Cairo', name: 'score-30d' });

// MEM-02: 90-day scoring — last Friday of the month at 16:00 Cairo
// Note: node-cron does not support "last Friday" natively.
// Run every Friday, gate internally: if today is last Friday of month, proceed.
cron.schedule('0 16 * * 5', async () => {
  if (isLastFridayOfMonth(new Date())) {
    await scoreOutcomeWindow('90d');
  }
}, { timezone: 'Africa/Cairo', name: 'score-90d' });
```

**"Last Friday of month" implementation:**
```typescript
function isLastFridayOfMonth(date: Date): boolean {
  const nextWeek = new Date(date);
  nextWeek.setDate(date.getDate() + 7);
  return nextWeek.getMonth() !== date.getMonth(); // no more Fridays this month
}
```

**Where to register jobs:** Call `registerScoringJobs()` from `server/index.ts` after `registerRoutes(app)` — same pattern as how LanceDB is initialized lazily. Jobs must not run during tests.

### Anti-Patterns to Avoid

- **Anti-pattern — WAL via migration SQL:** `PRAGMA journal_mode = WAL` in a .sql migration file does not reliably persist in better-sqlite3. Always set on the raw `Database` instance.
- **Anti-pattern — Multiple writers:** Never import `db` from `memory/db.ts` in gemini-service.ts, rag-service.ts, or routes.ts directly. Only `MemoryService` writes. Reads (for injection) go through `MemoryService.getRelevantEpisodes()`.
- **Anti-pattern — Raw user text in episodes:** Episode `lesson` and `context` fields must be agent-generated summaries. Never store raw user input (prompt injection risk, pitfall M6).
- **Anti-pattern — Blocking writes on response path:** Decision writes happen after the response is sent (`setImmediate(() => memoryService.saveDecision(...))` or fire-and-forget pattern). Do not `await` the save inside the route handler.
- **Anti-pattern — Integer timestamps in cron expressions:** node-cron v4 accepts standard 5-field cron syntax (`MIN HOUR DOM MON DOW`). Do not use seconds-field format (6-field).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema migrations | Custom migration runner | `drizzle-kit generate` + `drizzle-kit migrate` | Handles column diffs, renames, index changes correctly |
| WAL + busy timeout | Custom lock-retry loop | `sqlite.pragma('busy_timeout = 5000')` | better-sqlite3 handles this in C layer, no JS overhead |
| Timezone-aware cron | Manual UTC offset math | node-cron `{ timezone: 'Africa/Cairo' }` | DST transitions (Cairo: April/October) handled automatically |
| Vector similarity search | Cosine distance in JS | LanceDB `vectorSearch()` | Optimized HNSW index, already in use for RAG |
| Embedding generation | Custom HTTP call per episode | Reuse `getQueryEmbedding()` from rag-service.ts | Already implemented, same Gemini embedding-001 model |

**Key insight:** The existing `rag-service.ts` already contains the exact LanceDB + Gemini embedding pattern needed for episode retrieval. The episode embedding table is a new LanceDB table (`episodic_memory`), not a new implementation.

---

## Common Pitfalls

### Pitfall 1: Poisoned Feedback Loop (C1)
**What goes wrong:** Outcome scoring marks a CBE-shock loss as `THESIS_ERROR`. Meta-Agent learns to avoid P/E analysis. Strategy degrades.
**Why it happens:** `invalidationReason` column is NULL or ignored during learning queries.
**How to avoid:** All `getDecisionsByWindow()` queries for learning purposes (Phase 3) MUST filter `WHERE invalidation_reason = 'THESIS_ERROR' OR invalidation_reason IS NULL`. The MEM-05 enum enforcement in MemoryService prevents other values from being stored.
**Warning signs:** Meta-Agent avoids entire sectors after macro events.

### Pitfall 2: Stale Episode Injection (C3)
**What goes wrong:** Episode from high-CBE-rate regime injected during low-rate regime. Agent becomes overly conservative.
**Why it happens:** LanceDB vector similarity does not capture temporal validity.
**How to avoid:** `getRelevantEpisodes()` filters episodes BEFORE returning them:
  1. `validUntil IS NULL OR validUntil > NOW()` — discard expired
  2. `macroRegime = currentMacroRegime OR macroRegime IS NULL` — regime match
  Post-filter by LanceDB similarity score. If fewer than 3 valid episodes remain, return what's valid (don't fill with stale ones).
**Warning signs:** Agent cites old CBE-regime episodes during rate cuts.

### Pitfall 3: SQLite Write Contention (C6)
**What goes wrong:** Concurrent requests both write to decisions table. `SQLITE_BUSY` errors. Audit log has gaps.
**Why it happens:** better-sqlite3 uses sync writes; concurrent async code can interleave.
**How to avoid:**
  1. `sqlite.pragma('busy_timeout = 5000')` — wait up to 5 seconds before throwing
  2. Single-writer pattern: only `MemoryService.saveDecision()` writes (called from routes.ts after response)
  3. In Phase 4, this becomes `DecisionAgent` only — noted here for future compliance
**Warning signs:** `SQLITE_BUSY` in Railway logs; decisions table missing entries.

### Pitfall 4: better-sqlite3 Binary on Railway (L4)
**What goes wrong:** Railway uses Linux x64; local dev may be Windows. The native binary must match.
**Why it happens:** better-sqlite3 compiles a native .node binary at install time.
**How to avoid:**
  1. `package.json` already has `"engines": { "node": ">=18.0.0" }` — add exact Node pin if issues arise
  2. better-sqlite3 v12 ships prebuilds for Linux x64 Node 18, 20, 22, and 24 — all covered
  3. On Railway: `npm ci` rebuilds from source if no prebuild matches; ensure `python3` is available in build phase (Railway provides it)
**Warning signs:** Deploy fails with `Error: Could not locate the bindings file`.

### Pitfall 5: ESM import of better-sqlite3
**What goes wrong:** `import Database from 'better-sqlite3'` fails in ESM TypeScript project.
**Why it happens:** better-sqlite3 is CJS. With `"type": "module"` projects, default imports of CJS modules work in Node.js >= 18 via the CJS interop layer, but TypeScript may complain without `esModuleInterop`.
**How to avoid:** The project currently lacks a `tsconfig.json` (using tsx defaults). tsx handles CJS/ESM interop automatically — `import Database from 'better-sqlite3'` works as-is. If a tsconfig is added later, include `"esModuleInterop": true`.
**Warning signs:** `SyntaxError: The requested module 'better-sqlite3' does not provide an export named 'default'`.

### Pitfall 6: LanceDB Episode Table vs RAG Tables
**What goes wrong:** Episodes stored in existing `financial_reports_*` LanceDB tables, colliding with RAG data.
**Why it happens:** Code reuses the existing table-creation logic without namespacing.
**How to avoid:** Create a dedicated `episodic_memory` table in LanceDB. Use a different schema: `{ id: string, symbol: string, lesson: string, vector: Float32Array, createdAt: number }`. Never mix with financial report chunks.

---

## Code Examples

Verified patterns from official sources:

### Drizzle database initialization (WAL + busy timeout)
```typescript
// Source: https://orm.drizzle.team/docs/get-started-sqlite + drizzle-orm issue #4968
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const sqlite = new Database('./server/data/equra-memory.db');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
export const db = drizzle({ client: sqlite, schema });
```

### Drizzle schema column types
```typescript
// Source: https://orm.drizzle.team/docs/column-types/sqlite
import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

// Integer timestamp (stores Unix epoch seconds, JS Date on read)
createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date())

// Boolean as integer (0/1)
isActive: integer('is_active', { mode: 'boolean' }).default(false)

// Runtime-typed text
invalidationReason: text('invalidation_reason').$type<InvalidationReason>()
```

### Drizzle insert and select
```typescript
// Source: https://orm.drizzle.team/docs/sql-schema-declaration
import { db } from './db.js';
import { decisions } from './schema.js';
import { eq, and, isNull } from 'drizzle-orm';

// Insert
const result = db.insert(decisions).values({ symbol, recommendation, ... }).returning({ id: decisions.id }).get();

// Select with filter
const pending5d = db
  .select()
  .from(decisions)
  .where(and(isNull(decisions.outcome5d), isNull(decisions.invalidationReason)))
  .all();
```

### node-cron v4 with timezone
```typescript
// Source: node-cron v4 API (https://nodecron.com/migrating-from-v3)
import cron from 'node-cron';

cron.schedule('30 15 * * *', async () => {
  // runs daily at 15:30 Cairo (UTC+2 or UTC+3 depending on DST)
}, { timezone: 'Africa/Cairo', name: 'score-5d' });
```

### LanceDB episode table creation (reusing existing rag-service.ts pattern)
```typescript
// Source: existing server/rag-service.ts pattern + https://docs.lancedb.com/embedding/quickstart
import * as lancedb from '@lancedb/lancedb';

const EPISODE_TABLE = 'episodic_memory';

async function getOrCreateEpisodeTable(db: lancedb.Connection) {
  const names = await db.tableNames();
  if (names.includes(EPISODE_TABLE)) {
    return db.openTable(EPISODE_TABLE);
  }
  return db.createEmptyTable(EPISODE_TABLE, {
    id: 'string',
    symbol: 'string',
    lesson: 'string',
    vector: new Float32Array(768),  // gemini-embedding-001 dimension
    createdAt: 'double',
  });
}
```

### Episode vector search with validity filter
```typescript
// Fetch candidates from LanceDB, then filter by validUntil + macroRegime in SQLite
async getRelevantEpisodes(symbol: string, macroRegime: string, limit = 3) {
  const query = `${symbol} stock analysis lesson learned`;
  const vector = await getQueryEmbedding(query);  // reuse from rag-service.ts
  
  // Get top-10 candidates from LanceDB
  const candidates = await episodeTable
    .vectorSearch(vector)
    .limit(10)
    .toArray();
  
  const now = new Date();
  // Cross-reference with SQLite for validUntil + macroRegime filtering
  const valid = candidates
    .map(c => db.select().from(episodes).where(eq(episodes.lanceEpisodeId, c.id)).get())
    .filter(Boolean)
    .filter(e => !e.validUntil || e.validUntil > now)
    .filter(e => !e.macroRegime || e.macroRegime === macroRegime)
    .slice(0, limit);
  
  return valid;
}
```

### Inputs hash generation
```typescript
// SHA-256 of key inputs prevents duplicate recommendations
import { createHash } from 'node:crypto';

function hashInputs(stockData: StockDataForAI): string {
  const key = JSON.stringify({
    symbol: stockData.symbol,
    price: stockData.currentPrice,
    eps: stockData.eps,
    peRatio: stockData.peRatio,
  });
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Prisma as default ORM | Drizzle ORM preferred for edge/serverless | ~2023 | No binary engine, works in Railway without 50MB overhead |
| node-cron v3 (CommonJS) | node-cron v4 (TypeScript-native) | v4.0.0 ~2024 | Breaking: `scheduled` option removed; tasks auto-start |
| IANA timezone in cron | Same, but v4 uses `{ timezone }` option not `{ scheduled, timezone }` | v4.0.0 | `scheduled` option removed entirely |
| LanceDB createTable with Arrow schema | LanceDB createEmptyTable or infer from data | v0.4+ | createEmptyTable preferred for typed schemas |

**Deprecated/outdated:**
- `node-cron` v3 `{ scheduled: true, timezone: '...' }` — v4 removed `scheduled` option. Tasks auto-start. Use `{ timezone: '...', name: '...' }` only.
- Drizzle `drizzle-orm-sqlite` package (old, separate) — use `drizzle-orm` unified package with `drizzle-orm/better-sqlite3` import path.

---

## Open Questions

1. **gemini-embedding-001 vector dimensions**
   - What we know: rag-service.ts uses `gemini-embedding-001` successfully for financial reports. The model produces 768-dimensional vectors.
   - What's unclear: The exact dimension is not hardcoded in the existing code — it's inferred by LanceDB on first insert. This works but makes schema declaration imprecise.
   - Recommendation: On first episode insert, let LanceDB infer the dimension. Document 768 in a comment but don't hardcode in Float32Array constructor unless tests confirm it.

2. **"Last Friday of month" for 90-day cron**
   - What we know: node-cron v4 does not support "last weekday of month" syntax natively.
   - What's unclear: Whether Railway's cron (if used externally) supports `L` field — but we're using in-process node-cron, not external.
   - Recommendation: Use the `isLastFridayOfMonth()` guard shown above. Simple, zero dependencies.

3. **macroRegime: who determines it?**
   - What we know: Episodes need a `macroRegime` tag for staleness filtering (C3).
   - What's unclear: Phase 1 has no macro regime detector. The field is optional.
   - Recommendation: For Phase 1, `macroRegime` defaults to `null` on all episodes. Filtering allows null (`WHERE macroRegime IS NULL OR macroRegime = ?`). A real regime classifier can be added in Phase 3/4 without schema changes.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.13.0 | — |
| better-sqlite3 prebuilds | MEM-01/02/03 | Needs install | 12.8.0 prebuild covers Node 24 | npm rebuild from source (needs Python, available on Railway) |
| LanceDB | MEM-03/04 | Yes (existing) | 0.26.2 | — |
| Gemini API (embedding-001) | MEM-03/04 | Yes (existing env var) | — | Stub embeddings for local dev without API key |
| Africa/Cairo timezone data | MEM-02 node-cron | Yes (Node.js built-in ICU) | ICU bundled with Node 24 | — |

**Missing dependencies with no fallback:** None — all dependencies are installable.

**Missing dependencies with fallback:** None blocking.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None detected — no test config, no test directory, no test scripts in package.json |
| Config file | Wave 0 task: create `server/memory/__tests__/` and basic smoke test |
| Quick run command | `npx tsx server/memory/__tests__/memory-service.test.ts` (smoke) |
| Full suite command | Same — no test runner configured yet |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | saveDecision() writes a row to decisions table | unit | `npx tsx server/memory/__tests__/memory-service.test.ts` | Wave 0 |
| MEM-01 | inputsHash computed correctly from StockDataForAI | unit | same | Wave 0 |
| MEM-02 | scoreOutcome() updates correct window column | unit | same | Wave 0 |
| MEM-02 | cron expressions parse correctly for Africa/Cairo | smoke | manual — log cron registration on startup | — |
| MEM-03 | saveEpisode() inserts to SQLite + LanceDB | integration | `npx tsx server/memory/__tests__/memory-service.test.ts` | Wave 0 |
| MEM-04 | getRelevantEpisodes() filters expired + wrong regime | unit | same | Wave 0 |
| MEM-04 | Episodic context appears in Gemini prompt string | integration | log prompt in dev mode, verify substring | manual |
| MEM-05 | saveDecision() rejects invalid invalidationReason | unit | same | Wave 0 |

### Sampling Rate
- **Per task commit:** Run `npx tsx server/memory/__tests__/memory-service.test.ts`
- **Per wave merge:** Full test file (all describe blocks)
- **Phase gate:** All tests green + manual: run one analysis, check SQLite row exists

### Wave 0 Gaps
- [ ] `server/memory/__tests__/memory-service.test.ts` — covers MEM-01 through MEM-05 using in-memory SQLite (`:memory:` path)
- [ ] No test runner (jest/vitest) — Phase 1 uses manual `tsx` execution for smoke tests; a proper test framework is deferred to Phase 4 when the full agent pipeline needs integration tests

*(Rationale for no test runner: the project has zero test infrastructure today; adding jest/vitest is a setup cost disproportionate to Phase 1 scope. Smoke tests via tsx are sufficient for the audit log + injection validation.)*

---

## Sources

### Primary (HIGH confidence)
- [Drizzle ORM SQLite docs](https://orm.drizzle.team/docs/get-started-sqlite) — driver init, schema, migrations
- [Drizzle column types SQLite](https://orm.drizzle.team/docs/column-types/sqlite) — integer modes, text, real, defaults
- [Drizzle config file](https://orm.drizzle.team/docs/drizzle-config-file) — drizzle.config.ts format
- npm registry (2026-04-05) — verified: better-sqlite3@12.8.0, drizzle-orm@0.45.2, node-cron@4.2.1
- [drizzle-orm WAL issue #4968](https://github.com/drizzle-team/drizzle-orm/issues/4968) — WAL must be set on Database instance
- [LanceDB embedding quickstart](https://docs.lancedb.com/embedding/quickstart) — createEmptyTable + vectorSearch
- Existing `server/rag-service.ts` — authoritative reference for LanceDB + Gemini embedding pattern in this project
- Existing `server/gemini-service.ts` — confirmed injection point at prompt string construction (~line 154)

### Secondary (MEDIUM confidence)
- [node-cron v4 migration guide](https://nodecron.com/migrating-from-v3) — `scheduled` option removed, timezone option API confirmed
- WebSearch results — WAL pragma pattern corroborated across multiple sources
- [nodejs/node issue #47818](https://github.com/nodejs/node/issues/47818) — Africa/Cairo timezone handling in Node.js

### Tertiary (LOW confidence)
- None — all critical claims verified against official sources or the actual codebase.

---

## Project Constraints (from CLAUDE.md)

CLAUDE.md does not exist in this project. Constraints are drawn from `.planning/PROJECT.md`:

1. All new code must be TypeScript (no Python, no JavaScript).
2. Database: LanceDB for vectors (existing), SQLite for audit log/memory (new, this phase).
3. Keep Gemini API costs manageable — route cheap tasks to deterministic code.
4. Mobile backward compatibility — new endpoints must not break existing API contract. (Phase 1 adds no new endpoints.)
5. Deployment: Railway — must work within Railway constraints. No cron service; use in-process node-cron.
6. Node.js >= 18 (engines field in package.json). Current environment: Node 24.13.0.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry today; ESM compatibility confirmed via tsx interop
- Architecture patterns: HIGH — schema drawn from official Drizzle docs; injection point verified in actual source file
- Pitfalls: HIGH — all 3 critical pitfalls (C1, C3, C6) documented with exact prevention code; L4 binary pitfall verified against better-sqlite3 prebuild matrix
- Cron job scheduling: HIGH — node-cron v4 API confirmed; Africa/Cairo DST handling confirmed via Node.js ICU

**Research date:** 2026-04-05
**Valid until:** 2026-05-05 (stable libraries; drizzle-orm and node-cron have active release cycles — verify versions if planning after this date)
