import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as path from 'path';
import { eq, isNull } from 'drizzle-orm';
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
  // Phase 2: Critic Agent fields
  criticWeakness?: string | null;
  criticSeverity?: 'low' | 'medium' | 'high' | null;
  criticBlocking?: string[] | null;
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
    // Run inline DDL for :memory: test instances; production uses drizzle-kit migrate
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

  // MEM-01: Write a new decision
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
        criticWeakness: input.criticWeakness ?? null,
        criticSeverity: input.criticSeverity ?? null,
        criticBlocking: input.criticBlocking ? JSON.stringify(input.criticBlocking) : null,
      })
      .returning({ id: decisions.id })
      .get();
    return result.id;
  }

  // MEM-02: Score outcome for a specific window
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

  // MEM-03: Save an episode (lesson learned)
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

  // MEM-04: Retrieve top-N relevant episodes for a symbol
  async getRelevantEpisodes(
    symbol: string,
    currentMacroRegime: string | null,
    limit: number = 3
  ): Promise<typeof episodes.$inferSelect[]> {
    const now = new Date();

    // Fetch all from SQLite then filter validity conditions:
    // validUntil IS NULL or validUntil > now
    // macroRegime IS NULL or macroRegime = currentMacroRegime
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
    // Fall back to recency order if LanceDB unavailable (e.g., no API key or :memory: mode)
    try {
      if (process.env.GEMINI_API_KEY && DB_PATH !== ':memory:') {
        const reranked = await this.rerankByVectorSimilarity(symbol, valid, limit);
        return reranked;
      }
    } catch (e) {
      console.warn('MemoryService: LanceDB reranking failed, using recency order:', e);
    }

    return valid;
  }

  // MEM-05: Mark a decision as invalidated
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
    const data = await res.json() as { embedding?: { values?: number[] } };
    return data.embedding?.values ?? null;
  }
}

// Singleton export for use across the application
export const memoryService = new MemoryService();
