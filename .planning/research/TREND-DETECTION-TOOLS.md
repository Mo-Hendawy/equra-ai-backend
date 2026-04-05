# Trend Detection Tools — Free Tools Evaluation

**Created:** 2026-04-04
**Status:** Forward planning for Phase 5 (Monitoring & Autonomy)
**Decision:** Research now, implement during Phase 5. Memory + Critic + Self-Learning must come first so the agent can learn which signals are false alarms.

---

## Tier 1: HIGH VALUE — Integrate These

### 1. yahoo-finance2 (npm package)

| | |
|---|---|
| **Cost** | Free, no API key needed |
| **Install** | `npm install yahoo-finance2` — native TypeScript |
| **EGX Support** | YES — EGX tickers via `.CA` suffix (e.g., `COMI.CA`) |

**Use Cases:**
- **Trending tickers detection** — `trending()` for regional markets. Poll daily, diff against yesterday → detect momentum shifts
- **Earnings calendar** — `quoteSummary(symbol, {modules: ["calendarEvents"]})` → pre-earnings re-analysis trigger
- **Key statistics change detection** — Compare P/E, market cap, 52-week range daily. Significant changes → trigger re-analysis
- **Sector performance** — Track sector indices to detect rotation (banking → real estate → telecom)

**Why #1:** Only free tool with direct EGX ticker support, TypeScript SDK, and zero API key friction.

---

### 2. GDELT Project (REST API)

| | |
|---|---|
| **Cost** | Free, no API key |
| **Integration** | REST API (`api.gdeltproject.org`) — HTTP calls from Express |
| **EGX Relevance** | Egypt-specific event monitoring, CBE mentions, political/economic events |

**Use Cases:**
- **CBE rate decision detection** — Query DOC API with `("Central Bank of Egypt" OR "CBE") AND ("interest rate" OR "monetary policy")`. Poll every 6 hours. Article spike → re-analyze bank stocks (COMI, ADIB, CIEB)
- **Egypt macro event monitoring** — Track GDELT "tone" score for Egypt. Negative tone shift → market risk alert
- **Emerging theme extraction** — GDELT `theme` field auto-classifies events (ECON_PRICE_INCREASE, ECON_DEVALUATION). New Egypt themes = emerging trend
- **EGP devaluation signals** — Monitor "Egyptian pound" + "devalue/float/pressure" clusters

**Why #2:** Only free tool with structured event data, tone analysis, geographic filtering to Egypt, and thematic classification — all without an API key.

---

### 3. Google Trends (via `google-trends-api` npm)

| | |
|---|---|
| **Cost** | Free, no API key (unofficial, rate-limited) |
| **Install** | `npm install google-trends-api` — Node.js compatible |

**Use Cases:**
- **Retail herd detection** — Monitor search interest for EGX company names in Egypt. Search spike = retail attention → often precedes price moves in thin markets
- **Macro fear/greed signals** — Track searches for "سعر الدولار" (dollar price), "بورصة مصر" (Egypt stock exchange), "شهادات بنكية" (bank certificates). Rising bank certificates + falling بورصة = risk-off
- **Sector interest rotation** — Compare search trends across sectors. Divergence = sector rotation signal
- **IPO/listing buzz** — Detect interest spikes for companies rumored for listing

**Why #3:** In a retail-driven market like EGX, Google search behavior IS the leading indicator.

---

### 4. EODHD Economic Calendar (already subscribed)

| | |
|---|---|
| **Cost** | $0 — included in existing EODHD subscription |
| **Integration** | REST API, same auth token already in use |

**Use Cases:**
- **Earnings date detection** — `/api/calendar/earnings` → scheduled earnings → pre-earnings analysis trigger
- **CBE meeting dates** — Economic calendar includes central bank meetings → pre-meeting rate-sensitive stock analysis
- **Dividend ex-dates** — Upcoming ex-dividend dates → alert users holding those stocks
- **IPO calendar** — New listings → opportunity detection

**Why important:** Already paying for this but not using calendar endpoints. Zero additional cost or dependency.

---

## Tier 2: USEFUL — Add After Tier 1

### 5. Alpha Vantage (Free Tier)

| | |
|---|---|
| **Cost** | Free (5 calls/min, 500/day) |
| **Needs** | Free API key registration |

**Use Cases:**
- **Technical indicator monitoring** — RSI, MACD, Bollinger Bands via API. RSI < 30 = oversold alert, RSI > 70 = overbought
- **Sector performance API** — Pre-built sector performance data for rotation detection

**Limitation:** EGX coverage is spotty. Test `COMI.CA` before committing.

---

### 6. Reddit API (Free Tier)

| | |
|---|---|
| **Cost** | Free (100 queries/min with OAuth) |
| **Install** | `snoowrap` npm package |

**Use Cases:**
- **Egyptian investor sentiment** — Monitor r/egypt, r/EgyptExpatriates for investment discussions
- **Contrarian signal** — Extreme retail bullishness/bearishness historically inverts

**Limitation:** EGX-specific Reddit activity is low. Supplementary signal only.

---

### 7. EventRegistry (Free Tier)

| | |
|---|---|
| **Cost** | Free (200 articles/day) |

**Use Cases:**
- **Concept-level trending** — Track "concepts" not keywords: Egyptian economy, Suez Canal, tourism sector
- **Company-level news clustering** — Group news by entity, detect unusual volume

**Limitation:** 200 articles/day is tight. Targeted monitoring only.

---

## Tier 3: SKIP

| Tool | Why Skip |
|------|----------|
| Twitter/X API | Free tier = 1,500 tweets/month. Useless for monitoring |
| Stocktwits API | Zero EGX coverage. US-only |
| Finviz | No API, US-only |
| Unusual Whales | Options-focused, no EGX options market |
| BERTopic/Gensim | Python-only. Violates TypeScript constraint |

---

## Architecture: How These Fit Into Phase 5

```
┌─────────────────────────────────────────────────────────────────┐
│                    TREND DETECTION LAYER                        │
│                    (Phase 5 — Monitoring)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ Price Monitor │  │ News Monitor │  │ Search Trend Monitor │  │
│  │              │  │              │  │                      │  │
│  │ yahoo-fin2   │  │ GDELT API    │  │ google-trends-api    │  │
│  │ EODHD prices │  │ BBC RSS ←──── already have            │  │
│  │ (existing)   │  │ Google RSS ← already have             │  │
│  │              │  │ EODHD News ← already have             │  │
│  │              │  │ EODHD Cal ←  already have             │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         ▼                 ▼                      ▼              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              EVENT BUS (EventEmitter)                       ││
│  │  Events: price_spike | sentiment_shift | cbe_signal |      ││
│  │          earnings_upcoming | search_spike | sector_rot     ││
│  └────────────────────────┬────────────────────────────────────┘│
│                           │                                     │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌───────────────────────────────────────────────────────────┐
│                 EXISTING AGENT PIPELINE                    │
│  Memory (P1) → Analysis → Critic (P2) → Decision          │
│  Trend events trigger RE-ANALYSIS for affected stocks     │
└───────────────────────────────────────────────────────────┘
```

---

## Use Case Matrix

| Signal to Detect | Tool | Trigger Condition | Agent Action |
|------------------|------|-------------------|--------------|
| Price spike (>5%) | yahoo-finance2 + EODHD | Δ price > 5% AND volume > avg | Re-analyze stock |
| CBE rate decision | GDELT + EODHD Calendar | CBE keyword cluster spike | Re-analyze all bank stocks |
| Earnings surprise | EODHD Calendar + GDELT | Earnings date approaching | Pre-earnings analysis |
| Retail herd forming | Google Trends | Search interest ↑ 200%+ for ticker | Alert + analysis with "retail attention" flag |
| EGP pressure | GDELT | "devaluation" + "Egyptian pound" tone shift | Re-analyze all stocks (macro regime change) |
| Sector rotation | yahoo-finance2 | Sector A ↑ while Sector B ↓ over 5 days | Flag sector shift |
| Sentiment collapse | FinBERT (existing) + GDELT | Negative tone ↑ 50% week-over-week | Risk alert to portfolio holders |
| New regulation/law | GDELT themes | FRA/regulation theme spike for Egypt | Flag regulatory risk |
| Dividend announcement | EODHD Calendar | Ex-date within 14 days | Alert holders |
| IPO/listing buzz | Google Trends | New company name trending in Egypt | Opportunity detection |

---

## Implementation Order (when Phase 5 starts)

1. **EODHD Calendar** — zero work, already have API key
2. **yahoo-finance2** — `npm install`, immediate trending + stats
3. **GDELT** — HTTP calls, no auth, Egypt event monitoring
4. **Google Trends** — retail herd detection
5. **Alpha Vantage** — technical indicators (only if yahoo-finance2 doesn't cover EGX technicals)

---

## Cost Summary

| Tool | Monthly Cost | API Key? | TypeScript? |
|------|-------------|----------|-------------|
| yahoo-finance2 | $0 | No | Yes |
| GDELT | $0 | No | REST |
| Google Trends | $0 | No | JS |
| EODHD Calendar | $0 (included) | Already have | REST |
| Alpha Vantage | $0 | Yes (free) | JS |
| Reddit | $0 | Yes (free) | JS |
| EventRegistry | $0 | Yes (free) | REST |
| **Total** | **$0/month** | | |

---
*Evaluated 2026-04-04. Re-validate tool availability and EGX coverage before Phase 5 implementation.*
