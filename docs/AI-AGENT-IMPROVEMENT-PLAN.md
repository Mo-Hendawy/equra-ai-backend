# Equra AI Agent Improvement Plan

A roadmap to close the gaps identified in the current AI agent and move from "above average" to "cutting-edge" for EGX stock analysis.

---

## 1. Prompt Engineering Upgrades

### 1.1 Chain-of-Thought (CoT) Reasoning

**Current:** Single-shot prompts with output format requirements.

**Target:** Explicit reasoning steps before final recommendation.

| Task | Approach |
|------|----------|
| Stock Analysis | Add `"reasoningSteps": ["<step 1>", "<step 2>", ...]` to JSON schema. Instruct model to show valuation math, zone derivation, risk logic before conclusion. |
| Portfolio Analysis | Require `"analysisChain": [...]` where each step explains one dimension (diversification, sector risk, etc.). |
| Compare Stocks | Add `"decisionPath": "<why A over B, why now vs wait>"` before verdict. |

**Implementation:**
- Extend `GeminiAnalysis`, `PortfolioAnalysisResult`, `CompareStocksResult` interfaces with optional `reasoningSteps` / `analysisChain`.
- Update prompts: "First reason step-by-step. Then provide your final JSON."
- Optionally use Gemini's native thinking mode if available.

### 1.2 Few-Shot Examples

**Current:** Zero-shot prompts only.

**Target:** 1–2 in-context examples per task type to anchor format and reasoning style.

| Task | Example Type |
|------|--------------|
| Stock Analysis | One example: undervalued bank stock with clear fair value math. |
| Deploy Capital | One example: allocation across 3 stocks with buy zones. |
| Compare Stocks | One example: "Buy one, skip others" with reasoning. |

**Implementation:**
- Create `server/prompts/examples/` with sanitized (anonymized) example inputs + outputs.
- Inject into prompts: `EXAMPLE:\n${example}\n\nNOW ANALYZE:\n${actualData}`.
- Keep examples short to avoid token bloat (~200–400 tokens each).

### 1.3 Structured Reasoning Templates

**Current:** Free-form reasoning text.

**Target:** Templates that enforce consistency.

```
REASONING TEMPLATE (stock analysis):
1. Data check: [what we have / what's missing]
2. Valuation: [method A] → [result], [method B] → [result]
3. Zone derivation: [Strong Buy = X% below fair value because...]
4. Risk: [Sharpe/Sortino/volatility interpretation]
5. Conclusion: [recommendation with confidence rationale]
```

**Implementation:**
- Add `REASONING_TEMPLATE` constants in `gemini-service.ts` or `server/prompts/`.
- Reference in prompts: "Follow this reasoning structure before your JSON."

---

## 2. Tool Use & Function Calling

### 2.1 Calculator / Math Tools

**Current:** Model does all math in text (P/E, fair value, zones).

**Target:** Offload numeric work to deterministic tools.

| Tool | Purpose | Input | Output |
|------|---------|-------|--------|
| `calculate_fair_value_pe` | P/E-based fair value | eps, peRatio, targetPE | fairValue |
| `calculate_graham_value` | Graham formula | eps, bookValue | fairValue |
| `calculate_zone` | Entry zone from fair value | fairValue, discountPercent | { min, max } |
| `calculate_sharpe_interpretation` | Risk level from Sharpe | sharpeRatio | riskLevel |

**Implementation:**
- Use Gemini/OpenAI function calling (or OpenRouter equivalent).
- Define tool schemas in `server/tools/` (e.g., `valuation-tools.ts`).
- In `gemini-service.ts`: if model returns `tool_calls`, execute tools, inject results, optionally re-call for final answer.
- Fallback: if tool use fails, keep current single-call behavior.

### 2.2 Data Lookup Tools

**Current:** All data pre-fetched and dumped into prompt.

**Target:** Let model request specific data when needed.

| Tool | Purpose |
|------|---------|
| `get_historical_prices` | Fetch N-day history for symbol |
| `get_sentiment_summary` | Aggregate sentiment for symbol |
| `get_rag_context` | Fetch RAG chunks for a query |

**Implementation:**
- Expose as callable functions; model decides when to invoke.
- Reduces prompt size and allows iterative data gathering.

---

## 3. RAG Improvements

### 3.1 Hybrid Retrieval

**Current:** Vector-only search.

**Target:** Combine vector + keyword (BM25) for better recall.

| Component | Role |
|-----------|------|
| Vector (Gemini embeddings) | Semantic similarity |
| BM25 / keyword | Exact term matches (e.g., "revenue", "Q3 2024") |

**Implementation:**
- Add `server/rag/hybrid-retrieval.ts`.
- Use LanceDB for vectors; add simple keyword index (e.g., `flexsearch` or `minisearch`) over chunk text.
- Merge results: reciprocal rank fusion (RRF) or weighted combination.
- Config: `HYBRID_WEIGHT_VECTOR=0.7`, `HYBRID_WEIGHT_KEYWORD=0.3`.

### 3.2 Re-Ranking

**Current:** Top-K by similarity only.

**Target:** Re-rank retrieved chunks by relevance to the specific query.

| Approach | Complexity | Benefit |
|----------|------------|---------|
| Cross-encoder (e.g., ms-marco) | Medium | Better precision |
| LLM-as-judge (Gemini) | Low | Query-specific relevance score |

**Implementation:**
- Retrieve top 15–20 chunks.
- Re-rank with lightweight cross-encoder or Gemini: "Rate 1–5 how relevant this excerpt is to: [query]."
- Return top 5–6 after re-ranking.

### 3.3 Query Expansion

**Current:** Fixed query: `"${symbol} financial performance revenue profit..."`.

**Target:** Generate multiple query variants, search each, merge.

**Implementation:**
- `expandQuery(symbol, task)`: e.g., ["valuation", "earnings growth", "dividend policy"].
- Run vector search for each; deduplicate and merge by RRF.

---

## 4. Agentic Flow & Iterative Refinement

### 4.1 Multi-Turn Analysis Loop

**Current:** Single request → single response.

**Target:** Allow 2–3 turns for clarification or refinement.

| Turn | Purpose |
|------|---------|
| 1 | Initial analysis + confidence score |
| 2 | If confidence < threshold: "What additional data would help?" → fetch → re-analyze |
| 3 | Final recommendation |

**Implementation:**
- Add `confidenceThreshold` (e.g., 0.7).
- If `confidence === "Low"`, optionally trigger a second call with: "You said confidence is low. What's missing? We can fetch: [list of available tools]."
- Limit to 2–3 turns to control latency and cost.

### 4.2 Self-Correction / Validation Pass

**Current:** Trust first response.

**Target:** Optional validation step before returning.

| Check | Action |
|-------|--------|
| JSON validity | Parse; if fail, ask model to fix |
| Numeric consistency | Allocations sum to 100%? Zones overlap? |
| Recommendation vs data | Does "Strong Buy" match stated fair value discount? |

**Implementation:**
- `validateAnalysis(result, inputData)`: returns `{ valid: boolean, errors: string[] }`.
- If invalid: one retry with "Your previous response had these issues: [errors]. Please correct."
- Log validation failures for monitoring.

---

## 5. JSON Parsing Robustness

### 5.1 Schema Validation

**Current:** `JSON.parse(cleanJsonResponse(text))` with ad-hoc repair.

**Target:** Validate against JSON Schema; auto-fix common issues.

| Step | Implementation |
|------|----------------|
| Parse | Use `cleanJsonResponse` (keep existing). |
| Validate | `ajv` or `zod` against expected schema. |
| Fix | If missing required fields: inject defaults or prompt for retry. |
| Log | Track parse/validation failure rate. |

### 5.2 Streaming + Structured Output

**Target:** Use model-native structured output when available.

- Gemini: `responseSchema` in `generationConfig` (if supported).
- OpenAI/OpenRouter: `response_format: { type: "json_schema" }`.
- Reduces malformed JSON significantly.

**Implementation:**
- Check Gemini/OpenRouter docs for structured output.
- Add `useStructuredOutput: true` flag; fallback to current flow if unsupported.

---

## 6. Validation & Backtesting

### 6.1 Recommendation Audit Log

**Current:** No systematic tracking of recommendations.

**Target:** Log every recommendation with full context for later analysis.

| Field | Purpose |
|-------|---------|
| timestamp, symbol, recommendation | Time-series of advice |
| inputData (hash/summary) | Reproducibility |
| model, provider | A/B comparison |
| userFeedback (optional) | Thumbs up/down |

**Implementation:**
- Extend `recommendation_history.json` or add `recommendation_audit` table.
- Ensure PII-free; store symbol, prices, fundamentals summary, not user identity.

### 6.2 Backtesting Framework

**Target:** Simulate "if user had followed recommendation at T, what would happen at T+30d?"

| Metric | How |
|--------|-----|
| Hit rate | % of "Buy" that went up in 30 days |
| Fair value accuracy | Predicted vs actual price movement |
| Zone accuracy | Did price enter "Buy Zone" as predicted? |

**Implementation:**
- `server/scripts/backtest-recommendations.ts`: load historical recommendations + price data (EODHD historical), compute metrics.
- Run weekly; store results in `backtest_results.json`.
- Dashboard (optional): simple HTML or internal tool to view trends.

### 6.3 A/B Testing for Prompts

**Target:** Compare prompt variants by outcome.

| Variant | Metric |
|---------|--------|
| A: Current prompt | User engagement, recommendation acceptance |
| B: CoT prompt | Same + reasoning quality (manual sample) |
| C: Few-shot prompt | Parse success rate, consistency |

**Implementation:**
- Add `promptVariant` to config; hash user/session to assign.
- Log variant with each recommendation.
- Analyze after 2–4 weeks.

---

## 7. Implementation Priority

| Phase | Scope | Effort | Impact |
|-------|-------|--------|--------|
| **P1** | JSON schema validation + structured output | 1–2 days | High (reliability) |
| **P1** | Self-correction / validation pass | 1 day | High (quality) |
| **P2** | Chain-of-thought in prompts | 2–3 days | High (transparency) |
| **P2** | Calculator tools (fair value, zones) | 2–3 days | High (accuracy) |
| **P3** | Few-shot examples | 1–2 days | Medium |
| **P3** | Hybrid RAG + re-ranking | 3–4 days | Medium |
| **P4** | Multi-turn agentic loop | 3–5 days | Medium |
| **P4** | Recommendation audit + backtesting | 2–3 days | Medium (long-term) |
| **P5** | Query expansion, A/B testing | 2–3 days | Lower |

---

## 8. Success Metrics

| Metric | Current (Baseline) | Target |
|--------|--------------------|--------|
| JSON parse success rate | ~95% | >99% |
| Recommendation consistency (same input → similar output) | Unknown | >90% |
| User-reported "helpful" (if collected) | N/A | >70% |
| Backtest "Buy" hit rate (30d) | N/A | >55% |
| RAG relevance (manual sample) | Subjective | Top-3 relevant in 80%+ of queries |

---

## 9. Files to Create/Modify

| File | Action |
|------|--------|
| `server/tools/valuation-tools.ts` | Create – calculator tools |
| `server/tools/index.ts` | Create – tool registry + executor |
| `server/prompts/examples/` | Create – few-shot examples |
| `server/prompts/templates.ts` | Create – reasoning templates |
| `server/rag/hybrid-retrieval.ts` | Create – hybrid search |
| `server/rag/re ranker.ts` | Create – re-ranking logic |
| `server/gemini-service.ts` | Modify – CoT, tools, validation |
| `server/ai-providers.ts` | Modify – structured output, tool handling |
| `server/scripts/backtest-recommendations.ts` | Create – backtesting |
| `docs/AI-AGENT-IMPROVEMENT-PLAN.md` | This document |

---

## 10. Dependencies to Add

```json
{
  "ajv": "^8.x",
  "zod": "^3.x",
  "minisearch": "^4.x"
}
```

Optional for cross-encoder re-ranking:
```json
{
  "@xenova/transformers": "^2.x"
}
```

---

*Last updated: February 2026*
