# Founder Review: Equra AI Features

**Date:** March 2026  
**Mode:** **SCOPE EXPANSION** (user chose A)  
**Scope:** AI-AGENT-IMPROVEMENT-PLAN, HUGGINGFACE_ROADMAP, current features

---

## Executive Summary

| Lens | Verdict | Top Action |
|------|---------|------------|
| **EXPANSION** | Aim for 10-star product | One-tap decision, track record, "Why this number?" |
| HOLD | Plan is solid; close gaps | RAG/FinBERT failure visibility, calculator tools |
| REDUCTION | Minimum viable | Calculator tools + recommendation audit only |

**Primary focus:** SCOPE EXPANSION — dream big. What delivers 10x value for 2x effort?

### Recommendation

**Do E1 (One-tap summary) first.** It transforms the core loop: user taps stock → sees Buy/Hold/Sell + confidence in one view. No scroll, no multi-provider toggle. Then E2 ("Why this number?") and E3 (audit log) unlock trust and track record. Total ~2 weeks for the highest-impact 10x moves.

---

## Step 0: Nuclear Scope Challenge

### Premise Challenge

**Is this the right problem?** Yes. EGX retail investors need better tools.

**Reframe:** The job is not "AI stock analysis" — it's **"Help people make better EGX investment decisions with limited time and data."** The 10-star product answers: "Should I buy COMI now?" in 30 seconds with a clear, data-backed answer.

### What Already Exists (Shipped)

| Plan Item | Status | Location |
|-----------|--------|----------|
| Chain-of-Thought (reasoningSteps) | ✅ DONE | `ai-providers.ts`, `analysis-schemas.ts` |
| Hybrid RAG (query expansion, RRF, keyword re-rank) | ✅ DONE | `rag/hybrid-retrieval.ts`, `rag/query-expansion.ts` |
| Zod schema validation | ✅ DONE | `schemas/analysis-schemas.ts` |
| Self-correction retry | ✅ DONE | `gemini-service.ts` |
| Price fallback (EODHD → TradingView → CNBC) | ✅ DONE | `routes.ts` |
| FinBERT sentiment in analysis | ✅ DONE | API flows |

### Dream State (12 Months)

```
CURRENT                          PLAN                          12-MONTH IDEAL
─────────────────────────────────────────────────────────────────────────────
EGX analysis, portfolio,         More tools, backtesting,      User opens app →
deploy capital, RAG, FinBERT     HuggingFace local models      "Should I buy COMI?"
                                                               → Clear answer in 30s
                                                               with sources, risk,
                                                               portfolio impact,
                                                               and track record
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EQURA AI — CURRENT ARCHITECTURE                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Mobile App (React Native)                                                  │
│       │                                                                     │
│       ▼                                                                     │
│  Express API ──┬── Gemini 2.5 Pro (analysis, CoT)                          │
│                ├── EODHD → TradingView → CNBC (price cascade)               │
│                ├── LanceDB + Hybrid RAG (query expansion, RRF, re-rank)    │
│                ├── FinBERT API (sentiment)                                  │
│                └── BBC RSS (macro news)                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow (Happy + Shadow Paths)

```
PRICE REQUEST
    │
    ├─ EODHD OK ──────────────────► Return price
    ├─ EODHD 402 ─► TradingView ─► OK? Return : CNBC
    └─ All fail ──► Stale cache + warning

RAG REQUEST
    │
    ├─ Embedding OK + LanceDB OK ─► Return chunks
    ├─ Embedding fail ────────────► [] (empty) — analysis proceeds without RAG
    └─ LanceDB fail ──────────────► [] (catch) — analysis proceeds without RAG

FINBERT
    │
    ├─ API OK ───────────────────► Sentiment in analysis
    └─ API fail ──────────────────► null → analysis without sentiment (OK)
```

---

## Error & Rescue Registry

| Codepath | What Can Go Wrong | Rescued? | User Sees |
|----------|-------------------|----------|-----------|
| `getVectorResults` | LanceDB error | Y (try/catch) | Analysis without RAG context |
| `getQueryEmbedding` | API fail, no key | Y (returns []) | Analysis without RAG context |
| `analyzeStockWithGemini` | JSON parse fail | Y (retry + validation) | Fallback or error |
| `analyzeStockWithGemini` | Malformed reasoningSteps | Y (Zod default []) | Degraded |
| Price cascade | All sources fail | Y | Stale + warning |
| FinBERT API | 429, timeout | Y (catch → null) | Analysis without sentiment (OK) |

---

## Failure Modes Registry

| Codepath | Failure Mode | Rescued? | Test? | User Sees? |
|----------|--------------|----------|-------|------------|
| RAG retrieve | LanceDB down | Y | ? | Analysis without RAG (OK) |
| RAG retrieve | Embedding API fail | Y | ? | Analysis without RAG (OK) |
| FinBERT | API 429/timeout | Y | ? | Analysis without sentiment (OK) |
| Gemini | Malformed JSON | Y | Y | Retry → fallback |
| Price | All fail | Y | ? | Stale + warning |

**OK:** FinBERT returns null on failure; analysis proceeds without sentiment (graceful degradation).

---

## Mode A: SCOPE EXPANSION (10-Star Product)

**Commitment:** This review is in SCOPE EXPANSION mode. We push scope up to find the 10-star product.

### 10x Check

| Current | 10x Version | Effort |
|---------|-------------|--------|
| Multi-provider analysis, long scroll | **One-tap decision:** User taps stock → Buy/Hold/Sell + confidence in one view, no scroll | 2–3 days |
| FinBERT sentiment (raw score) | **Sentiment + narrative:** "Market cautious on banks; COMI is outlier because…" | 1 day |
| RAG from PDFs only | **Live context:** Earnings + news + sector + PDFs in one unified view | 2–3 days |
| Backtesting (internal script) | **Transparent track record:** "Our Buy calls: 58% hit rate over 90 days" — visible in app | 3–4 days |
| Calculator tools (planned) | **Explainable math:** "Fair value = 37.5 EGP because…" (tap to expand formula) | 2 days |
| Single analysis per stock | **Compare to last week:** "COMI was Strong Buy; now Hold. Here's what changed." | 1–2 days |
| No portfolio-level action | **Portfolio pulse:** "Your banks overweight; consider trimming COMI" | 2 days |

### Delight Opportunities (<30 min each)

1. **"Why this number?"** — Tap P/E, fair value, zone → see formula + inputs (expandable card)
2. **"Compare to last week"** — "COMI was Strong Buy; now Hold. Here's what changed."
3. **Sector pulse** — One-line: "Banks +2%, Telecom flat" (header or banner)
4. **"What would make this a Buy?"** — "If COMI drops to 8.2 EGP, enters Buy zone"
5. **Export to PDF** — One-tap export of analysis (share sheet)
6. **Confidence badge** — Color-coded pill: High (green), Medium (yellow), Low (orange)
7. **Quick action chips** — "Add to watchlist" / "Set alert at 8.2" from analysis screen

### EXPANSION Implementation Roadmap

| Phase | Scope | Effort | Impact |
|-------|-------|--------|--------|
| **E1** | One-tap decision view (compact summary) | 2 days | 10x UX |
| **E2** | "Why this number?" tap-to-expand | 1 day | Trust |
| **E3** | Track record badge ("58% Buy hit rate") | 3 days | Credibility |
| **E4** | "Compare to last week" (store prior analysis) | 2 days | Context |
| **E5** | Sector pulse (aggregate EGX sectors) | 1–2 days | Market awareness |
| **E6** | Calculator tools + explainable math | 2 days | Accuracy + trust |
| **E7** | Export to PDF | 0.5 day | Shareability |

### EXPANSION Review Sections

#### 1. Architecture (EXPANSION impact)

New components for 10-star product:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EQURA AI — EXPANSION ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Mobile App                                                                 │
│       │                                                                     │
│       ├── One-tap summary (new) ──► /api/stock/:symbol/summary (new)       │
│       ├── Prior analysis store (new) ──► AsyncStorage + optional sync      │
│       └── Track record (new) ──► /api/backtest/summary (new)                │
│                                                                             │
│  Backend (existing + new)                                                   │
│       ├── Gemini, RAG, FinBERT (unchanged)                                  │
│       ├── Calculator tools (new) ──► server/tools/valuation-tools.ts       │
│       ├── Recommendation audit (new) ──► enables backtest                   │
│       └── Backtest summary API (new) ──► hit rate, zone accuracy            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Dependency graph:** Summary API depends on full analysis; backtest depends on audit log. No circular deps.

#### 2. Security (EXPANSION)

| New Surface | Threat | Mitigation |
|-------------|--------|------------|
| `/api/stock/:symbol/summary` | Symbol injection | Validate against EGX list |
| `/api/backtest/summary` | Info disclosure | Aggregate only; no PII |
| Prior analysis (AsyncStorage) | Local only | No sync = no server exposure |
| Export PDF | XSS in generated content | Sanitize analysis text |

**OK:** No new auth boundaries; existing API auth applies.

#### 3. Data Flow & Interaction Edge Cases (EXPANSION)

| Scenario | Handled? | How |
|----------|----------|-----|
| User taps stock while summary loading | ? | Add loading skeleton; debounce |
| "Compare to last week" but no prior analysis | ? | Show "First analysis — check back next week" |
| Track record with <10 recommendations | ? | "Insufficient data" or hide badge |
| Export PDF while analysis still streaming | ? | Disable export until complete |
| Double-tap "Add to watchlist" | ? | Idempotent; check existing |

**GAP:** These edge cases need explicit handling in EXPANSION features.

#### 4. Test Coverage (EXPANSION)

| New Flow | Unit | Integration | E2E |
|----------|------|-------------|-----|
| Summary API | Y | Y | Manual |
| Calculator tools | Y (deterministic) | Y | — |
| Backtest summary | Y | Y | — |
| "Why this number?" tap | — | — | Manual |
| Export PDF | — | Y (mock) | Manual |

**2am Friday confidence:** Calculator tools + summary API have unit tests. Backtest has integration test.

#### 5. Performance (EXPANSION)

| Concern | Mitigation |
|---------|------------|
| Summary API = full analysis? | Cache; or lighter prompt (summary-only) |
| Backtest summary computation | Pre-compute weekly; cache result |
| Prior analysis storage | Limit to last 4 per symbol; prune old |
| PDF export | Client-side generation (react-native-html-to-pdf) |

#### 6. Observability (EXPANSION)

| Metric | Purpose |
|--------|---------|
| `summary_api_latency_ms` | Track one-tap speed |
| `backtest_recommendation_count` | Track audit log growth |
| `export_pdf_count` | Engagement |
| `why_this_number_tap_count` | Delight feature usage |

#### 7. Deployment & Rollback (EXPANSION)

- **Feature flags:** `ONE_TAP_SUMMARY`, `TRACK_RECORD_BADGE`, `EXPORT_PDF`
- **Rollback:** Disable flags; no DB migrations for E1–E7
- **Post-deploy:** Verify summary returns in <5s; backtest summary returns

---

## Mode B: HOLD SCOPE (Bulletproof)

### Remaining Gaps to Close

1. ~~FinBERT failure handling~~ — Already OK (catch → null, analysis without sentiment)
2. **Calculator tools** — P/E fair value, Graham, zones, Sharpe (deterministic, no hallucination)
3. **Recommendation audit log** — Log every recommendation (PII-free) for backtesting
4. **Update AI-AGENT-IMPROVEMENT-PLAN** — Mark CoT, hybrid RAG, Zod, retry as DONE

### NOT in Scope (Defer)

| Item | Rationale |
|------|-----------|
| A/B testing for prompts | Optimize after core quality is solid |
| LayoutLM/Donut KPI extraction | High effort; text extraction sufficient for now |
| FinGPT as primary model | Gemini sufficient; test as secondary later |
| Full multi-turn agentic loop | Single-turn + retry sufficient for v1 |
| Data lookup tools (model-initiated) | Pre-fetch is simpler; defer |

---

## Mode C: SCOPE REDUCTION (Minimum Viable)

### Ruthless Cut — Ship Only

1. **Calculator tools** — Fair value, zones, Sharpe. Highest impact, reduces hallucination.
2. **RAG/FinBERT failure visibility** — Both degrade gracefully (empty/null). Optional: add logging for monitoring.
3. **Recommendation audit** — Log for future backtesting. No dashboard yet.

### Defer Everything Else

- Few-shot examples
- Re-ranking (cross-encoder)
- Multi-turn loop
- Backtesting dashboard
- Hugging Face Phase 1–4
- A/B testing

---

## Implementation Priority (SCOPE EXPANSION)

**Do E1 first.** One-tap decision is the highest-leverage 10x move.

| Phase | Scope | Effort | Impact | Status |
|-------|-------|--------|--------|--------|
| **E1** | One-tap summary view | 2 days | 10x UX | TODO |
| **E2** | "Why this number?" tap-to-expand | 1 day | Trust | TODO |
| **E3** | Recommendation audit log | 1 day | Enables E4 | TODO |
| **E4** | Track record badge | 3 days | Credibility | TODO |
| **E5** | Calculator tools | 2 days | Accuracy | TODO |
| **E6** | "Compare to last week" | 2 days | Context | TODO |
| **E7** | Export to PDF | 0.5 day | Shareability | TODO |
| P2 | Few-shot examples | 1–2 days | Medium | TODO |
| P3 | Sector pulse, "What would make this a Buy?" | 2 days | Delight | TODO |
| Defer | Re-ranking, multi-turn, A/B, Hugging Face | — | Lower | Defer |

---

## Required Outputs Summary

### NOT in Scope

- A/B testing (defer)
- LayoutLM/Donut (defer)
- FinGPT primary (defer)
- Full multi-turn agentic loop (defer)
- Data lookup tools (defer)

### What Already Exists

- CoT, hybrid RAG, Zod, self-correction, price fallback, FinBERT sentiment

### Diagrams

- Architecture: above
- Data flow: above
- Error flow: Error & Rescue Registry

### Unresolved Decisions

- Hugging Face Phase 1 (local embeddings) — cost vs complexity tradeoff
- **EXPANSION:** Summary API — full analysis cached, or lighter summary-only prompt? (Recommend: cache full analysis; summary = first 3 fields)
- **EXPANSION:** Prior analysis storage — AsyncStorage only, or optional backend sync for cross-device?

---

*Generated by plan-ceo-review skill. Mode: SCOPE EXPANSION. Last updated: March 2026.*
