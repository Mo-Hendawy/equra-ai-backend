---
phase: 01-memory-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - drizzle.config.ts
  - server/memory/db.ts
  - server/memory/schema.ts
  - server/memory/memory-service.ts
  - server/memory/migrations/
  - server/memory/__tests__/memory-service.test.ts
  - server/jobs/scoring-jobs.ts
  - server/gemini-service.ts
  - server/routes.ts
  - server/index.ts
autonomous: true
requirements:
  - MEM-01
  - MEM-02
  - MEM-03
  - MEM-04
  - MEM-05

must_haves:
  truths:
    - "Running an analysis writes a row to the decisions table (symbol, recommendation, confidence, reasoning, inputs_hash, fair_value, price_at_rec)"
    - "Running a second analysis for the same symbol injects past episodes into the Gemini prompt (the EPISODIC MEMORY block is present in the prompt string)"
    - "An episode can be saved with validUntil and macroRegime; expired or regime-mismatched episodes are NOT returned by getRelevantEpisodes()"
    - "The three outcome scoring cron jobs register at server startup with Africa/Cairo timezone and their names appear in server logs"
    - "A decision can be invalidated with one of THESIS_ERROR | MACRO_SHOCK | DATA_STALE | TIMING; any other value is rejected at the TypeScript layer"
  artifacts:
    - path: "server/memory/db.ts"
      provides: "Database singleton with WAL mode + busy_timeout set on raw better-sqlite3 instance before drizzle wraps it"
      contains: "sqlite.pragma('journal_mode = WAL')"
    - path: "server/memory/schema.ts"
      provides: "Drizzle table definitions for decisions, episodes, strategy_prompts"
      exports: ["decisions", "episodes", "strategyPrompts"]
    - path: "server/memory/memory-service.ts"
      provides: "MemoryService class — the single read/write interface for all memory operations"
      exports: ["MemoryService", "InvalidationReason"]
    - path: "server/jobs/scoring-jobs.ts"
      provides: "registerScoringJobs() that registers three node-cron jobs"
      exports: ["registerScoringJobs"]
    - path: "server/memory/__tests__/memory-service.test.ts"
      provides: "Smoke tests covering MEM-01 through MEM-05 using in-memory SQLite"
  key_links:
    - from: "server/routes.ts"
      to: "server/memory/memory-service.ts"
      via: "memoryService.saveDecision() called after response is sent (fire-and-forget via setImmediate)"
      pattern: "setImmediate.*saveDecision"
    - from: "server/routes.ts"
      to: "server/gemini-service.ts"
      via: "episodicContext string fetched before analyzeStockWithGemini() call"
      pattern: "getRelevantEpisodes.*analyzeStockWithGemini"
    - from: "server/gemini-service.ts"
      to: "EPISODIC MEMORY block in prompt"
      via: "episodicContext optional parameter prepended before STOCK DATA: section"
      pattern: "EPISODIC MEMORY"
    - from: "server/index.ts"
      to: "server/jobs/scoring-jobs.ts"
      via: "registerScoringJobs() called after registerRoutes()"
      pattern: "registerScoringJobs"
---

<objective>
Build the SQLite memory substrate that the entire production agent upgrade depends on.

Purpose: Every stock recommendation must be logged to a persistent audit trail, past lessons must be retrievable and injectable into future analyses, and outcome scoring must run automatically on a schedule. Without this, none of the subsequent phases (Critic Agent, Self-Learning, Multi-Agent) have the historical context they need to function.

Output:
- server/memory/ module (db.ts + schema.ts + memory-service.ts + migrations/)
- server/jobs/scoring-jobs.ts (three cron jobs for MEM-02)
- Modified server/gemini-service.ts (episodic injection via optional parameter)
- Modified server/routes.ts (save decision after response, inject episodes before analysis)
- Modified server/index.ts (register scoring jobs on startup)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/01-memory-foundation/01-RESEARCH.md
</context>

<interfaces>
<!-- Key contracts the executor needs. Extracted from existing codebase. -->

From server/gemini-service.ts (current signature to modify):
```typescript
export async function analyzeStockWithGemini(
  stockData: StockDataForAI,
  skipCache: boolean = false
): Promise<GeminiAnalysis | null>

export interface StockDataForAI {
  symbol: string;
  currentPrice: number;
  eps?: number | null;
  peRatio?: number | null;
  // ... (see full interface in gemini-service.ts lines 71-105)
}
```

From server/routes.ts (call site to modify, line ~896):
```typescript
const geminiAnalysis = await analyzeStockWithGemini(stockDataForAI, refresh);
```

From server/rag-service.ts (embedding pattern to reuse):
```typescript
// getQueryEmbedding is NOT exported — must be duplicated or rag-service.ts must export it
async function getQueryEmbedding(query: string): Promise<number[]>
// Uses: GEMINI_API_KEY + gemini-embedding-001 model via direct fetch
// Returns: number[] (768 dimensions)
```

From server/index.ts (startup hook to add to):
```typescript
const server = await registerRoutes(app);
// Add: registerScoringJobs() call here, after registerRoutes
```

From server/data/ (existing directory — safe to put equra-memory.db here):
```
server/data/lancedb/     ← existing LanceDB files
server/data/equra-memory.db   ← NEW SQLite file (created by db.ts on first import)
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Install dependencies, create DB singleton and schema</name>
  <files>
    package.json,
    drizzle.config.ts,
    server/memory/db.ts,
    server/memory/schema.ts,
    server/memory/migrations/
  </files>
  <action>
**Step 1 — Install packages:**
```bash
npm install better-sqlite3@12.8.0 drizzle-orm@0.45.2 node-cron@4.2.1
npm install -D @types/better-sqlite3@7.6.13 drizzle-kit@0.31.10
```

**Step 2 — Create drizzle.config.ts at project root:**
```typescript
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

**Step 3 — Create server/memory/schema.ts with all three tables:**

```typescript
import { sqliteTable, integer, text, real } from 'drizzle-orm/sqlite-core';

export const decisions = sqliteTable('decisions', {
  id:                    integer('id').primaryKey({ autoIncrement: true }),
  symbol:                text('symbol').notNull(),
  createdAt:             integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  recommendation:        text('recommendation').notNull(),
  confidence:            text('confidence').notNull(),
  reasoning:             text('reasoning').notNull(),
  inputsHash:            text('inputs_hash').notNull(),
  fairValue:             real('fair_value'),
  priceAtRec:            real('price_at_rec'),
  invalidationReason:    text('invalidation_reason').$type<'THESIS_ERROR' | 'MACRO_SHOCK' | 'DATA_STALE' | 'TIMING'>(),
  // Critic fields — nullable, Phase 2 will populate
  criticWeakness:        text('critic_weakness'),
  criticSeverity:        text('critic_severity').$type<'low' | 'medium' | 'high'>(),
  criticBlocking:        text('critic_blocking'),   // JSON.stringify(string[]) on write, JSON.parse on read
  // Outcome scoring windows (MEM-02)
  outcome5d:             real('outcome_5d'),
  outcome30d:            real('outcome_30d'),
  outcome90d:            real('outcome_90d'),
  scored5dAt:            integer('scored_5d_at', { mode: 'timestamp' }),
  scored30dAt:           integer('scored_30d_at', { mode: 'timestamp' }),
  scored90dAt:           integer('scored_90d_at', { mode: 'timestamp' }),
});

export const episodes = sqliteTable('episodes', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  symbol:         text('symbol').notNull(),
  createdAt:      integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lesson:         text('lesson').notNull(),           // agent-generated, max 200 tokens
  context:        text('context').notNull(),          // what setup triggered this lesson
  validUntil:     integer('valid_until', { mode: 'timestamp' }),
  macroRegime:    text('macro_regime'),               // 'HIGH_RATES' | 'RECOVERY' | 'CRISIS' | null
  decisionId:     integer('decision_id').references(() => decisions.id),
  lanceEpisodeId: text('lance_episode_id'),           // cross-reference to LanceDB episodic_memory table
});

export const strategyPrompts = sqliteTable('strategy_prompts', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  version:          integer('version').notNull(),
  promptText:       text('prompt_text').notNull(),
  createdAt:        integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  performanceScore: real('performance_score'),
  isActive:         integer('is_active', { mode: 'boolean' }).notNull().default(false),
});
```

**Step 4 — Create server/memory/db.ts:**

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as path from 'path';
import * as schema from './schema.js';

const DB_PATH = path.join(process.cwd(), 'server', 'data', 'equra-memory.db');

// WAL must be set on the raw Database instance before drizzle wraps it.
// Setting via migration SQL does NOT reliably persist (drizzle-orm issue #4968).
const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');   // 5s wait before SQLITE_BUSY error
sqlite.pragma('synchronous = normal'); // safe + faster than FULL

export const db = drizzle({ client: sqlite, schema });
export { sqlite };
```

**Step 5 — Generate and apply migrations:**
```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

This creates the migration SQL file in server/memory/migrations/ and applies it to server/data/equra-memory.db.

**DO NOT** set `journal_mode = WAL` inside the migration SQL file — it is already set on the Database instance in db.ts. Drizzle-kit may generate it; delete that pragma from the generated SQL before applying.
  </action>
  <verify>
    <automated>node -e "import('./server/memory/db.js').then(m => { const r = m.db.all('SELECT name FROM sqlite_master WHERE type=\'table\''); console.log('Tables:', r.map(t => t.name).join(', ')); process.exit(r.length >= 3 ? 0 : 1); }).catch(e => { console.error(e); process.exit(1); })"</automated>
  </verify>
  <done>
    - package.json has better-sqlite3, drizzle-orm, node-cron in dependencies
    - package.json has @types/better-sqlite3, drizzle-kit in devDependencies
    - drizzle.config.ts exists at project root
    - server/memory/schema.ts exports decisions, episodes, strategyPrompts
    - server/memory/db.ts creates Database with WAL pragma on the instance
    - server/memory/migrations/ contains at least one .sql migration file
    - server/data/equra-memory.db exists with decisions, episodes, strategy_prompts tables
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build MemoryService class with episodic LanceDB support</name>
  <files>
    server/memory/memory-service.ts,
    server/memory/__tests__/memory-service.test.ts
  </files>
  <behavior>
    - saveDecision({ symbol: 'COMI', recommendation: 'Buy', confidence: 'High', reasoning: 'solid P/E', inputsHash: 'abc123', priceAtRec: 25.5, fairValue: 30 }) inserts a row and returns a numeric id > 0
    - saveDecision() with invalidationReason: 'MACRO_SHOCK' stores the value; saveDecision() with invalidationReason: 'INVALID_VALUE' throws a TypeScript compile error (enum enforcement)
    - scoreOutcome(id, '5d', 8.5) updates outcome_5d = 8.5 and scored_5d_at to now; outcome_30d and outcome_90d remain null
    - saveEpisode({ symbol: 'COMI', lesson: 'P/E thesis correct', context: 'HIGH_RATES', validUntil: futureDate, macroRegime: 'HIGH_RATES' }) returns a numeric id and (when GEMINI_API_KEY is set) creates a row in LanceDB episodic_memory table
    - getRelevantEpisodes('COMI', 'HIGH_RATES', 3) does NOT return an episode whose validUntil is in the past
    - getRelevantEpisodes('COMI', 'RECOVERY', 3) does NOT return an episode tagged macroRegime: 'HIGH_RATES'
    - invalidateDecision(id, 'THESIS_ERROR') sets invalidation_reason = 'THESIS_ERROR' on that row
  </behavior>
  <action>
Create server/memory/__tests__/memory-service.test.ts first (RED phase). Use in-memory SQLite (`:memory:`) path by setting an environment variable `MEMORY_DB_PATH=:memory:` before importing MemoryService. Tests use direct tsx execution, no test runner.

```typescript
// server/memory/__tests__/memory-service.test.ts
// Run: npx tsx server/memory/__tests__/memory-service.test.ts

import assert from 'node:assert/strict';
process.env.MEMORY_DB_PATH = ':memory:';

const { MemoryService } = await import('../memory-service.js');
const svc = new MemoryService();

// MEM-01: saveDecision
const id = await svc.saveDecision({
  symbol: 'COMI',
  recommendation: 'Buy',
  confidence: 'High',
  reasoning: 'solid P/E ratio at 8x vs sector 12x',
  inputsHash: 'abc123abc123abc1',
  priceAtRec: 25.5,
  fairValue: 30.0,
});
assert.ok(typeof id === 'number' && id > 0, 'saveDecision should return numeric id');
console.log('PASS: MEM-01 saveDecision');

// MEM-02: scoreOutcome
await svc.scoreOutcome(id, '5d', 8.5);
const dec = await svc.getDecisionById(id);
assert.equal(dec?.outcome5d, 8.5, 'outcome_5d should be 8.5');
assert.equal(dec?.outcome30d, null, 'outcome_30d should still be null');
console.log('PASS: MEM-02 scoreOutcome');

// MEM-03: saveEpisode with validity
const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
const epId = await svc.saveEpisode({
  symbol: 'COMI',
  lesson: 'P/E thesis was correct; CBE rate cut came 3 months later than expected',
  context: 'HIGH_RATES regime, Q3 2025',
  validUntil: futureDate,
  macroRegime: 'HIGH_RATES',
  decisionId: id,
});
assert.ok(typeof epId === 'number' && epId > 0, 'saveEpisode should return numeric id');
console.log('PASS: MEM-03 saveEpisode');

// MEM-04: getRelevantEpisodes — expired episode filter
const pastDate = new Date(Date.now() - 1000);
await svc.saveEpisode({
  symbol: 'COMI',
  lesson: 'This lesson is stale and should not appear',
  context: 'stale context',
  validUntil: pastDate,
  macroRegime: 'HIGH_RATES',
});
// Regime-mismatched episode
await svc.saveEpisode({
  symbol: 'COMI',
  lesson: 'This lesson is for wrong regime',
  context: 'RECOVERY context',
  macroRegime: 'RECOVERY',
});

const episodes = await svc.getRelevantEpisodes('COMI', 'HIGH_RATES', 3);
const staleFound = episodes.some(e => e.lesson.includes('stale'));
const wrongRegimeFound = episodes.some(e => e.lesson.includes('wrong regime'));
assert.equal(staleFound, false, 'Expired episode must NOT be returned');
assert.equal(wrongRegimeFound, false, 'Wrong macroRegime episode must NOT be returned');
console.log('PASS: MEM-04 getRelevantEpisodes filters');

// MEM-05: invalidateDecision
await svc.invalidateDecision(id, 'THESIS_ERROR');
const invalidated = await svc.getDecisionById(id);
assert.equal(invalidated?.invalidationReason, 'THESIS_ERROR', 'invalidationReason should be THESIS_ERROR');
console.log('PASS: MEM-05 invalidateDecision');

console.log('\nAll memory-service tests PASSED');
```

Then create server/memory/memory-service.ts (GREEN phase):

```typescript
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as path from 'path';
import { eq, isNull, and, or, lt } from 'drizzle-orm';
import * as lancedb from '@lancedb/lancedb';
import * as schema from './schema.js';
import { decisions, episodes, strategyPrompts } from './schema.js';

// Support in-memory DB for tests
const DB_PATH = process.env.MEMORY_DB_PATH
  ? process.env.MEMORY_DB_PATH
  : path.join(process.cwd(), 'server', 'data', 'equra-memory.db');

export type InvalidationReason = 'THESIS_ERROR' | 'MACRO_SHOCK' | 'DATA_STALE' | 'TIMING';

const VALID_INVALIDATION_REASONS: InvalidationReason[] = [
  'THESIS_ERROR', 'MACRO_SHOCK', 'DATA_STALE', 'TIMING'
];

export interface NewDecision {
  symbol: string;
  recommendation: string;
  confidence: string;
  reasoning: string;
  inputsHash: string;
  fairValue?: number | null;
  priceAtRec?: number | null;
  invalidationReason?: InvalidationReason;
}

export interface NewEpisode {
  symbol: string;
  lesson: string;
  context: string;
  validUntil?: Date | null;
  macroRegime?: string | null;
  decisionId?: number | null;
}

export class MemoryService {
  private db: ReturnType<typeof drizzle>;

  constructor() {
    const sqlite = new Database(DB_PATH);
    if (DB_PATH !== ':memory:') {
      sqlite.pragma('journal_mode = WAL');
      sqlite.pragma('busy_timeout = 5000');
      sqlite.pragma('synchronous = normal');
    }
    // Run migrations inline for :memory: test instances; production uses drizzle-kit migrate
    if (DB_PATH === ':memory:') {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS decisions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          recommendation TEXT NOT NULL,
          confidence TEXT NOT NULL,
          reasoning TEXT NOT NULL,
          inputs_hash TEXT NOT NULL,
          fair_value REAL,
          price_at_rec REAL,
          invalidation_reason TEXT,
          critic_weakness TEXT,
          critic_severity TEXT,
          critic_blocking TEXT,
          outcome_5d REAL,
          outcome_30d REAL,
          outcome_90d REAL,
          scored_5d_at INTEGER,
          scored_30d_at INTEGER,
          scored_90d_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS episodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          symbol TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          lesson TEXT NOT NULL,
          context TEXT NOT NULL,
          valid_until INTEGER,
          macro_regime TEXT,
          decision_id INTEGER REFERENCES decisions(id),
          lance_episode_id TEXT
        );
        CREATE TABLE IF NOT EXISTS strategy_prompts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version INTEGER NOT NULL,
          prompt_text TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          performance_score REAL,
          is_active INTEGER NOT NULL DEFAULT 0
        );
      `);
    }
    this.db = drizzle({ client: sqlite, schema });
  }

  // MEM-01
  async saveDecision(input: NewDecision): Promise<number> {
    if (input.invalidationReason && !VALID_INVALIDATION_REASONS.includes(input.invalidationReason)) {
      throw new Error(`Invalid invalidationReason: ${input.invalidationReason}`);
    }
    const result = this.db
      .insert(decisions)
      .values({
        symbol: input.symbol,
        createdAt: new Date(),
        recommendation: input.recommendation,
        confidence: input.confidence,
        reasoning: input.reasoning,
        inputsHash: input.inputsHash,
        fairValue: input.fairValue ?? null,
        priceAtRec: input.priceAtRec ?? null,
        invalidationReason: input.invalidationReason ?? null,
      })
      .returning({ id: decisions.id })
      .get();
    return result.id;
  }

  // MEM-02
  async scoreOutcome(
    decisionId: number,
    window: '5d' | '30d' | '90d',
    outcomePercent: number
  ): Promise<void> {
    const now = new Date();
    if (window === '5d') {
      this.db.update(decisions)
        .set({ outcome5d: outcomePercent, scored5dAt: now })
        .where(eq(decisions.id, decisionId))
        .run();
    } else if (window === '30d') {
      this.db.update(decisions)
        .set({ outcome30d: outcomePercent, scored30dAt: now })
        .where(eq(decisions.id, decisionId))
        .run();
    } else {
      this.db.update(decisions)
        .set({ outcome90d: outcomePercent, scored90dAt: now })
        .where(eq(decisions.id, decisionId))
        .run();
    }
  }

  // MEM-03
  async saveEpisode(input: NewEpisode): Promise<number> {
    const result = this.db
      .insert(episodes)
      .values({
        symbol: input.symbol,
        createdAt: new Date(),
        lesson: input.lesson,
        context: input.context,
        validUntil: input.validUntil ?? null,
        macroRegime: input.macroRegime ?? null,
        decisionId: input.decisionId ?? null,
        lanceEpisodeId: null,
      })
      .returning({ id: episodes.id })
      .get();

    // Embed into LanceDB episodic_memory if API key available
    // Best-effort: never throw on embedding failure
    try {
      const lanceId = await this.embedEpisodeToLanceDB(result.id, input);
      if (lanceId) {
        this.db.update(episodes)
          .set({ lanceEpisodeId: lanceId })
          .where(eq(episodes.id, result.id))
          .run();
      }
    } catch (e) {
      console.warn('MemoryService: LanceDB episode embedding failed (non-fatal):', e);
    }

    return result.id;
  }

  // MEM-04
  async getRelevantEpisodes(
    symbol: string,
    currentMacroRegime: string | null,
    limit: number = 3
  ): Promise<typeof episodes.$inferSelect[]> {
    const now = new Date();

    // Fetch from SQLite with validity filters
    // Filter: validUntil IS NULL or validUntil > now
    // Filter: macroRegime IS NULL or macroRegime = currentMacroRegime
    const allEpisodes = this.db
      .select()
      .from(episodes)
      .all();

    const valid = allEpisodes
      .filter(e => !e.validUntil || e.validUntil > now)
      .filter(e => !e.macroRegime || !currentMacroRegime || e.macroRegime === currentMacroRegime)
      .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
      .slice(0, limit);

    // If LanceDB is available, re-rank by vector similarity
    // Fall back to recency order if LanceDB unavailable (e.g., no API key)
    try {
      if (process.env.GEMINI_API_KEY) {
        const reranked = await this.rerankByVectorSimilarity(symbol, valid, limit);
        return reranked;
      }
    } catch (e) {
      console.warn('MemoryService: LanceDB reranking failed, using recency order:', e);
    }

    return valid;
  }

  // MEM-05
  async invalidateDecision(
    decisionId: number,
    reason: InvalidationReason
  ): Promise<void> {
    if (!VALID_INVALIDATION_REASONS.includes(reason)) {
      throw new Error(`Invalid invalidationReason: ${reason}`);
    }
    this.db.update(decisions)
      .set({ invalidationReason: reason })
      .where(eq(decisions.id, decisionId))
      .run();
  }

  // Query helpers
  async getDecisionById(id: number): Promise<typeof decisions.$inferSelect | undefined> {
    return this.db.select().from(decisions).where(eq(decisions.id, id)).get();
  }

  async getDecisionsPendingOutcome(window: '5d' | '30d' | '90d'): Promise<typeof decisions.$inferSelect[]> {
    if (window === '5d') {
      return this.db.select().from(decisions).where(isNull(decisions.outcome5d)).all();
    } else if (window === '30d') {
      return this.db.select().from(decisions).where(isNull(decisions.outcome30d)).all();
    } else {
      return this.db.select().from(decisions).where(isNull(decisions.outcome90d)).all();
    }
  }

  async getLatestStrategyPrompt(): Promise<typeof strategyPrompts.$inferSelect | null> {
    const result = this.db
      .select()
      .from(strategyPrompts)
      .where(eq(strategyPrompts.isActive, true))
      .get();
    return result ?? null;
  }

  // Private: Embed episode to LanceDB episodic_memory table
  private async embedEpisodeToLanceDB(
    episodeId: number,
    input: NewEpisode
  ): Promise<string | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const LANCE_DB_PATH = path.join(process.cwd(), 'server', 'data', 'lancedb');
    const EPISODE_TABLE = 'episodic_memory';

    const lanceConn = await lancedb.connect(LANCE_DB_PATH);
    const tableNames = await lanceConn.tableNames();

    let table: Awaited<ReturnType<typeof lanceConn.openTable>>;
    if (tableNames.includes(EPISODE_TABLE)) {
      table = await lanceConn.openTable(EPISODE_TABLE);
    } else {
      // Create empty table; schema inferred from first insert
      table = await lanceConn.createEmptyTable(EPISODE_TABLE, {
        id: 'string',
        symbol: 'string',
        lesson: 'string',
        vector: new Float32Array(768), // gemini-embedding-001 produces 768 dims
        createdAt: 'double',
      } as any);
    }

    const queryText = `${input.symbol} stock analysis: ${input.lesson}`;
    const vector = await this.getEmbedding(queryText);
    if (!vector || vector.length === 0) return null;

    const lanceId = `ep_${episodeId}_${Date.now()}`;
    await table.add([{
      id: lanceId,
      symbol: input.symbol,
      lesson: input.lesson,
      vector,
      createdAt: Date.now(),
    }]);

    return lanceId;
  }

  // Private: Re-rank SQLite episode candidates by LanceDB vector similarity
  private async rerankByVectorSimilarity(
    symbol: string,
    candidates: typeof episodes.$inferSelect[],
    limit: number
  ): Promise<typeof episodes.$inferSelect[]> {
    if (candidates.length === 0) return candidates;

    const LANCE_DB_PATH = path.join(process.cwd(), 'server', 'data', 'lancedb');
    const EPISODE_TABLE = 'episodic_memory';

    const lanceConn = await lancedb.connect(LANCE_DB_PATH);
    const tableNames = await lanceConn.tableNames();
    if (!tableNames.includes(EPISODE_TABLE)) return candidates;

    const table = await lanceConn.openTable(EPISODE_TABLE);
    const queryVector = await this.getEmbedding(`${symbol} stock analysis lesson learned`);
    if (!queryVector || queryVector.length === 0) return candidates;

    const lanceResults = await table.vectorSearch(queryVector).limit(20).toArray();
    const lanceIdOrder = (lanceResults as any[]).map(r => r.id as string);

    // Re-order candidates by LanceDB similarity rank
    const withLanceIds = candidates.filter(e => e.lanceEpisodeId);
    const withoutLanceIds = candidates.filter(e => !e.lanceEpisodeId);

    const sorted = [
      ...lanceIdOrder
        .map(lid => withLanceIds.find(e => e.lanceEpisodeId === lid))
        .filter((e): e is typeof episodes.$inferSelect => Boolean(e)),
      ...withoutLanceIds,
    ].slice(0, limit);

    return sorted;
  }

  // Private: Get Gemini embedding vector — mirrors rag-service.ts pattern
  private async getEmbedding(text: string): Promise<number[] | null> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding?.values ?? null;
  }
}

// Singleton export for use across the application
export const memoryService = new MemoryService();
```

Run tests after implementation: `npx tsx server/memory/__tests__/memory-service.test.ts`
  </action>
  <verify>
    <automated>npx tsx server/memory/__tests__/memory-service.test.ts</automated>
  </verify>
  <done>
    - All 5 PASS lines print (MEM-01 through MEM-05)
    - "All memory-service tests PASSED" prints at end
    - saveDecision returns a number
    - scoreOutcome updates only the target window column
    - getRelevantEpisodes filters expired and regime-mismatched episodes
    - invalidateDecision sets invalidation_reason correctly
  </done>
</task>

<task type="auto">
  <name>Task 3: Wire episodic injection, decision logging, and scoring cron jobs</name>
  <files>
    server/gemini-service.ts,
    server/routes.ts,
    server/jobs/scoring-jobs.ts,
    server/index.ts
  </files>
  <action>
**Part A — Modify server/gemini-service.ts: add optional episodicContext parameter**

Change the signature of `analyzeStockWithGemini` (line 136) from:
```typescript
export async function analyzeStockWithGemini(stockData: StockDataForAI, skipCache: boolean = false): Promise<GeminiAnalysis | null>
```
to:
```typescript
export async function analyzeStockWithGemini(
  stockData: StockDataForAI,
  skipCache: boolean = false,
  episodicContext?: string   // MEM-04: injected by caller, optional
): Promise<GeminiAnalysis | null>
```

Inside the function, immediately before the `const prompt = \`You are an expert stock analyst...` line (~line 154), add:
```typescript
const episodicBlock = episodicContext
  ? `\n\nEPISODIC MEMORY (lessons from past analyses of similar setups):\n${episodicContext}\n`
  : '';
```

Then change the first line of the prompt from:
```typescript
const prompt = `You are an expert stock analyst specializing in the Egyptian Exchange (EGX). Provide a comprehensive investment analysis report.

STOCK DATA:
```
to:
```typescript
const prompt = `You are an expert stock analyst specializing in the Egyptian Exchange (EGX). Provide a comprehensive investment analysis report.${episodicBlock}

STOCK DATA:
```

No other changes to gemini-service.ts. This is a purely additive, backward-compatible change.

---

**Part B — Create server/jobs/scoring-jobs.ts: three outcome scoring cron jobs (MEM-02)**

```typescript
// server/jobs/scoring-jobs.ts
import cron from 'node-cron';
import { memoryService } from '../memory/memory-service.js';

// MEM-02: "last Friday of month" guard for 90-day window
function isLastFridayOfMonth(date: Date): boolean {
  const nextWeek = new Date(date);
  nextWeek.setDate(date.getDate() + 7);
  return nextWeek.getMonth() !== date.getMonth();
}

async function scoreOutcomeWindow(window: '5d' | '30d' | '90d'): Promise<void> {
  console.log(`[scoring-jobs] Running ${window} outcome scoring...`);
  try {
    const pending = await memoryService.getDecisionsPendingOutcome(window);
    console.log(`[scoring-jobs] ${pending.length} decisions pending ${window} scoring`);

    for (const decision of pending) {
      // Phase 1: scoring logic is a stub — actual price fetch and computation
      // added in Phase 3 (LEARN-01). Here we register the cron schedule only.
      // Phase 3 will call memoryService.scoreOutcome(decision.id, window, pct).
      console.log(`[scoring-jobs] Would score decision ${decision.id} (${decision.symbol}) for ${window}`);
    }
  } catch (e) {
    console.error(`[scoring-jobs] Error during ${window} scoring:`, e);
  }
}

export function registerScoringJobs(): void {
  // MEM-02: 5-day scoring — daily at 15:30 Cairo (after EGX close at 14:30)
  cron.schedule('30 15 * * *', async () => {
    await scoreOutcomeWindow('5d');
  }, { timezone: 'Africa/Cairo', name: 'score-5d' });

  // MEM-02: 30-day scoring — every Friday at 16:00 Cairo
  cron.schedule('0 16 * * 5', async () => {
    await scoreOutcomeWindow('30d');
  }, { timezone: 'Africa/Cairo', name: 'score-30d' });

  // MEM-02: 90-day scoring — last Friday of the month at 16:00 Cairo
  // node-cron v4 does not support "last Friday" natively — gate with isLastFridayOfMonth()
  cron.schedule('0 16 * * 5', async () => {
    if (isLastFridayOfMonth(new Date())) {
      await scoreOutcomeWindow('90d');
    }
  }, { timezone: 'Africa/Cairo', name: 'score-90d' });

  console.log('[scoring-jobs] Registered: score-5d (daily 15:30 Cairo), score-30d (Fri 16:00 Cairo), score-90d (last Fri 16:00 Cairo)');
}
```

---

**Part C — Modify server/routes.ts: fetch episodes before analysis, log decision after**

Locate the import line at the top of routes.ts (line ~6) and add:
```typescript
import { memoryService } from './memory/memory-service.js';
import { createHash } from 'node:crypto';
```

Locate the `analyzeStockWithGemini` call site (line ~896). The current code is:
```typescript
const geminiAnalysis = await analyzeStockWithGemini(stockDataForAI, refresh);
```

Replace with the following block:

```typescript
// MEM-04: Fetch relevant episodic context BEFORE calling Gemini
// macroRegime is null in Phase 1 (classifier added Phase 3/4)
let episodicContext: string | undefined;
try {
  const episodes = await memoryService.getRelevantEpisodes(symbol, null, 3);
  if (episodes.length > 0) {
    episodicContext = episodes
      .map((ep, i) => {
        const dateStr = ep.createdAt ? ep.createdAt.toISOString().split('T')[0] : 'unknown';
        return `${i + 1}. [${dateStr}] ${ep.symbol} — ${ep.context}: ${ep.lesson}`;
      })
      .join('\n');
  }
} catch (e) {
  console.warn('Memory episodic fetch failed (non-fatal):', e);
}

const geminiAnalysis = await analyzeStockWithGemini(stockDataForAI, refresh, episodicContext);

// MEM-01: Log decision to memory AFTER analysis, fire-and-forget (don't block response)
if (geminiAnalysis) {
  setImmediate(() => {
    const inputsHash = createHash('sha256')
      .update(JSON.stringify({
        symbol: stockDataForAI.symbol,
        price: stockDataForAI.currentPrice,
        eps: stockDataForAI.eps,
        peRatio: stockDataForAI.peRatio,
      }))
      .digest('hex')
      .slice(0, 16);

    memoryService.saveDecision({
      symbol,
      recommendation: geminiAnalysis.recommendation,
      confidence: geminiAnalysis.confidence,
      reasoning: geminiAnalysis.reasoning.slice(0, 2000), // cap at 2000 chars
      inputsHash,
      fairValue: geminiAnalysis.fairValueEstimate ?? null,
      priceAtRec: stockDataForAI.currentPrice,
    }).catch(e => console.error('Memory saveDecision failed:', e));
  });
}
```

---

**Part D — Modify server/index.ts: register scoring jobs at startup**

Locate the line `const server = await registerRoutes(app);` (line ~245) and add after it:
```typescript
// MEM-02: Register outcome scoring cron jobs (node-cron, Africa/Cairo timezone)
import { registerScoringJobs } from './jobs/scoring-jobs.js';
registerScoringJobs();
```

Since this is a top-level module, add the import at the top of the file with other imports:
```typescript
import { registerScoringJobs } from './jobs/scoring-jobs.js';
```
And call it after `registerRoutes`:
```typescript
const server = await registerRoutes(app);
registerScoringJobs();
```
  </action>
  <verify>
    <automated>npx tsx -e "
import { memoryService } from './server/memory/memory-service.js';
process.env.MEMORY_DB_PATH = ':memory:';
const id = await memoryService.saveDecision({ symbol: 'TEST', recommendation: 'Buy', confidence: 'High', reasoning: 'test', inputsHash: 'test1234test1234', priceAtRec: 10 });
console.log('saveDecision id:', id);
process.exit(id > 0 ? 0 : 1);
"</automated>
  </verify>
  <done>
    - analyzeStockWithGemini accepts optional third parameter episodicContext?: string
    - When episodicContext is provided, the prompt contains "EPISODIC MEMORY" block before "STOCK DATA:"
    - routes.ts calls getRelevantEpisodes() before analyzeStockWithGemini()
    - routes.ts calls saveDecision() in a setImmediate() fire-and-forget after the response is assembled (does not await)
    - scoring-jobs.ts exports registerScoringJobs() with three cron.schedule calls using Africa/Cairo timezone
    - server starts without error and logs the three cron job registration lines
    - Existing API endpoints (/api/analyze, /api/portfolio, /api/compare, /api/deploy-capital) return the same response shape as before — no new fields added, no breaking changes
  </done>
</task>

</tasks>

<verification>
After all three tasks are complete, run this end-to-end check:

1. Start the server: `npm run dev`
2. Verify startup logs include:
   - `[scoring-jobs] Registered: score-5d (daily 15:30 Cairo), score-30d (Fri 16:00 Cairo), score-90d (last Fri 16:00 Cairo)`
3. Trigger an analysis: `curl -X POST http://localhost:5000/api/analyze -H "Content-Type: application/json" -d '{"symbol":"COMI"}'`
4. Wait 2 seconds for the fire-and-forget write, then inspect the DB:
   ```bash
   node -e "
   import Database from 'better-sqlite3';
   const db = new Database('./server/data/equra-memory.db');
   const rows = db.prepare('SELECT id, symbol, recommendation, confidence FROM decisions').all();
   console.log('decisions:', rows);
   "
   ```
5. Verify a row exists for COMI with recommendation and confidence fields populated.
6. Run smoke tests: `npx tsx server/memory/__tests__/memory-service.test.ts`
7. Verify all 5 PASS lines and "All memory-service tests PASSED".
</verification>

<success_criteria>
- `npx tsx server/memory/__tests__/memory-service.test.ts` exits 0 with all 5 PASS lines
- Server starts without errors; cron registration logged
- POST /api/analyze writes a decisions row to SQLite within 2 seconds of response
- A second POST /api/analyze for the same symbol passes an EPISODIC MEMORY block to Gemini (visible in console if `console.log(prompt)` added temporarily in gemini-service.ts)
- getRelevantEpisodes() with expired or wrong-regime episodes returns empty array (proven by test)
- No existing API endpoints return 500 or changed response shapes
- server/data/equra-memory.db exists with three tables: decisions, episodes, strategy_prompts
</success_criteria>

<output>
After completion, create `.planning/phases/01-memory-foundation/01-memory-foundation-01-SUMMARY.md` with:
- What was built (files created/modified)
- Key decisions made during implementation
- Any deviations from this plan and why
- Patterns established (singleton pattern, fire-and-forget write, episode filter logic)
- Pitfalls encountered and how they were handled
</output>
