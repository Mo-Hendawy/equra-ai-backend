# Pitfalls Research — AI Agent Production Upgrade

**Research Date:** 2026-04-04

## Critical Pitfalls (Will Break the System If Ignored)

### C1 — Memory That Poisons Its Own Feedback Loop
**Phase:** 1 (Memory) + 3 (Self-Learning)
**Problem:** Audit log labels a macro-shock outcome as a strategy failure. Agent recommended BUY CIB based on solid P/E analysis, then CBE raised rates unexpectedly and the stock dropped. The self-learning loop learns the wrong lesson — "avoid P/E-based bank analysis" — when the thesis was correct but an external event invalidated it.
**Warning signs:** Meta-Agent starts avoiding entire sectors or signal types after macro shocks.
**Prevention:** Add `invalidationReason` enum to decisions table: `THESIS_ERROR | MACRO_SHOCK | DATA_STALE | TIMING`. Only `THESIS_ERROR` entries feed the meta-agent strategy evolution. Everything else is logged but excluded from learning.

### C2 — Critic Agent That Always Agrees
**Phase:** 2 (Critic)
**Problem:** Structural sycophancy. If Critic and Analysis share the same model, temperature, and information set, the Critic produces adversarial theatre — it sounds critical but doesn't actually challenge the thesis.
**Warning signs:** Critic severity is always "low". Critic never causes a confidence downgrade. Critic's counter-scenario is always implausible.
**Prevention:** Force the Critic to argue the opposing position FIRST (if Analysis says BUY, Critic must argue SELL before judging). Use a different model or higher temperature. Add a hard `counterRecommendation` field and `blockingIssues` array to the schema — empty arrays should be flagged.

### C3 — Stale Memory Injection at Query Time
**Phase:** 1 (Memory)
**Problem:** Embedding similarity on financial text doesn't capture temporal validity. A 6-month-old episode about HRHO during a high-CBE-rate regime gets injected during a low-CBE-rate regime because the text is semantically similar.
**Warning signs:** Agent cites old episodes that contradict current macro conditions. Recommendations become overly conservative because old failure episodes dominate.
**Prevention:** Add `validUntil` date and `macroRegime` tag to every episode. Before injection, check: (1) episode not expired, (2) macro regime matches current. Discard stale episodes even if embedding similarity is high.

### C4 — Orchestrator Deadlock Under Multi-Agent Fanout
**Phase:** 5 (Multi-Agent Architecture)
**Problem:** Data Agent → Analysis Agent → Critic Agent is sequential but expressed as implicit async dependencies. Without explicit timeouts, the orchestrator hangs if any agent stalls. Incomplete audit log writes from partial runs corrupt the self-learning data.
**Warning signs:** API requests that never return. Partial entries in decisions table (recommendation without critic feedback).
**Prevention:** Declare agent DAG explicitly. 30-second per-agent timeout with partial result fallback. DecisionAgent validates all inputs are present before writing to audit log — reject partial data.

### C5 — Autonomous Scheduler Causing EGX Data Hazards
**Phase:** 3 (Self-Learning) + 4 (Monitoring)
**Problem:** Autonomous analysis triggered too close to EGX market open (10:00 Cairo) or close (14:30 Cairo) gets stale EODHD prices because EODHD has 30-60 minute ingestion lag. Users receive recommendations based on yesterday's price.
**Warning signs:** Morning recommendations show yesterday's closing price. Price in analysis doesn't match user's trading app.
**Prevention:** Run all autonomous analyses AFTER 15:30 Cairo time (UTC+2). Assert price data timestamp freshness (< 2 hours old) before every run. If stale, skip and retry in 30 minutes.

### C6 — SQLite Write Contention Under Concurrent Agents
**Phase:** 1 (Memory) + 5 (Multi-Agent)
**Problem:** If multiple agents write to SQLite audit log concurrently, `SQLITE_BUSY` errors. Fast agents get over-represented in the learning sample (their writes succeed, slow agents' fail).
**Warning signs:** Intermittent `SQLITE_BUSY` errors in logs. Audit log has gaps (some recommendations missing).
**Prevention:** Single-writer pattern — only DecisionAgent writes to SQLite, through a serialized in-process write queue. Enable WAL mode with 5-second busy timeout. No direct SQLite writes from other agents.

---

## Moderate Pitfalls (Will Degrade Quality)

### M1 — Phantom P/E From FRA Disclosure Lag
**Phase:** 2 (Critic) + 3 (Self-Learning)
**Problem:** FRA allows 45-day filing window. Agent calculates P/E using earnings from the previous quarter because current quarter hasn't been filed yet. Recommendation looks data-driven but is based on stale fundamentals.
**Prevention:** Tag every P/E calculation with `earningsAsOf` date. If earnings are >60 days old, Critic should flag it and confidence gets a 10% discount. Display staleness in output.

### M2 — Circuit Breaker False Positives in Monitoring
**Phase:** 4 (Monitoring)
**Problem:** EGX allows 8%+ moves on extremely thin volume (3,000 EGP). Monitoring triggers re-analysis on what looks like a major move but is actually noise from a single trade.
**Prevention:** Price alert triggers must include minimum volume threshold. A 6% move on < 50% of 30-day average volume is NOT a trigger — it's noise.

### M3 — Backtesting Survivorship Bias
**Phase:** 3 (Self-Learning)
**Problem:** Only backtesting stocks that are still listed. Delisted stocks (which were likely the worst performers) are excluded, making the agent's track record look better than it is.
**Prevention:** Keep all decisions in audit log forever, including delisted stocks. Mark delisted stocks with `status: DELISTED` instead of deleting.

### M4 — Meta-Agent Overfitting to Recent Data
**Phase:** 3 (Self-Learning)
**Problem:** Weekly Meta-Agent reviews only last 30 decisions. If 25 of those were bank stocks during a CBE rate cut, the strategy becomes "always buy banks" — then rates reverse.
**Prevention:** Meta-Agent should review a balanced sample: last 30 decisions PLUS 10 random historical decisions from different macro regimes. Include regime diversity in the sample.

### M5 — Feature Flag Drift
**Phase:** 5 (Multi-Agent Architecture)
**Problem:** Feature flag that toggles new pipeline vs old path becomes permanent tech debt. Both paths diverge, bugs fixed in one path but not the other.
**Prevention:** Time-box the feature flag to 2 weeks. After validation, remove the old path entirely. Don't maintain two parallel analysis pipelines.

### M6 — Prompt Injection via User Input
**Phase:** 1 (Memory) + 2 (Critic)
**Problem:** If user input (stock symbol, analysis request) flows into episodic memory and later gets injected into prompts, a crafted input could manipulate the agent's future behavior.
**Prevention:** Sanitize all user inputs before storing in memory. Episode lessons should be agent-generated summaries, never raw user text.

---

## Minor Pitfalls (Nice to Avoid)

### L1 — Token Bloat from Episodic Injection
Injecting too many episodes inflates prompt tokens. Limit to top-3 most relevant episodes, max 200 tokens each.

### L2 — Critic Latency Doubling Response Time
Critic adds a second LLM call. Use Groq (fast inference) for Critic, not Gemini. Set strict 10-second timeout.

### L3 — Monitoring Alert Fatigue
If every 5% move triggers full re-analysis, users get spammed. Implement cooldown: max 1 alert per stock per 24 hours.

### L4 — Schema Migration on Railway
better-sqlite3 on Railway needs prebuilt binaries for the correct Node.js version. Pin Node.js version in `engines` field and test deploy before writing migration code.

---

## Phase-by-Phase Warning Table

| Phase | Critical Watch | Key Prevention |
|-------|---------------|----------------|
| 1. Memory | C1 (poisoned feedback), C3 (stale injection), C6 (write contention) | invalidationReason enum, validUntil dates, single-writer |
| 2. Critic | C2 (sycophantic critic), M1 (phantom P/E) | Different model/temp, forced counter-position, earnings staleness flag |
| 3. Self-Learning | C5 (data hazards), M3 (survivorship bias), M4 (overfitting) | Post-market scheduling, keep delisted, balanced sample |
| 4. Monitoring | M2 (circuit breaker noise), L3 (alert fatigue) | Volume threshold, 24h cooldown |
| 5. Multi-Agent | C4 (deadlock), C6 (write contention), M5 (feature flag drift) | Explicit DAG, per-agent timeouts, time-box flag |
| 6. Autonomy | C5 (data hazards), L3 (alert fatigue) | Post-market runs, cooldown per stock |
