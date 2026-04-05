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
