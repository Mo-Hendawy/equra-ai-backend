# EQU-5: One-Tap Summary View — Test Cases & QA Checklist

## Affected Scenarios

| Area | Scenario | Impact |
|------|----------|--------|
| **Stock Search** | User taps a stock from search results | Now shows summary card first, then expandable full analysis |
| **Stock Search** | User selects stock for first time (no cache) | Summary loads after full analysis (~3–8s); shows skeleton during load |
| **Stock Search** | User selects stock with cached analysis | Summary loads quickly (<200ms from cache) |
| **Stock Search** | User taps "Full Analysis" expandable | Expands to show existing StockAnalysis (multi-provider) |
| **Stock Search** | User taps "Back to Search" | Clears selection and collapses full analysis state |
| **API** | `GET /api/stock/:symbol/summary` | New endpoint; used by StockSummaryCard |
| **API** | `GET /api/prices/:symbol` | Now used by StockSearchScreen (was `/prices/`) |
| **Price fetch** | Stock price loading | Header card shows price; summary fetches independently |

---

## Backend API Test Cases

### TC-B1: Summary endpoint — valid symbol, cache hit
- **Precondition:** Symbol COMI has cached Gemini analysis (<24h old)
- **Action:** `GET /api/stock/COMI/summary`
- **Expected:** 200, JSON with `recommendation`, `confidence`, `currentPrice`, `fairValueEstimate`, `headline`, `currentZone`, `inEntryZone`, `analysisAge`, etc.
- **Verify:** `analysisAge` is a number (minutes); `headline` is non-empty

### TC-B2: Summary endpoint — valid symbol, cache miss
- **Precondition:** Symbol has no cached analysis (or cache expired)
- **Action:** `GET /api/stock/COMI/summary`
- **Expected:** 200 after ~3–8s; full analysis runs, summary derived
- **Verify:** Same shape as TC-B1; `analysisAge` may be 0 or from fresh cache

### TC-B3: Summary endpoint — refresh bypass
- **Action:** `GET /api/stock/COMI/summary?refresh=true`
- **Expected:** 200; bypasses cache, runs fresh analysis
- **Verify:** Response is fresh (e.g. different `analysisAge` if previously cached)

### TC-B4: Summary endpoint — invalid symbol
- **Action:** `GET /api/stock/INVALID/summary`
- **Expected:** 400, `{ "error": "Unknown EGX symbol" }`

### TC-B5: Summary endpoint — lowercase symbol
- **Action:** `GET /api/stock/comi/summary`
- **Expected:** 200; symbol normalized to COMI

### TC-B6: Summary — fair value null
- **Precondition:** Analysis returns `fairValueEstimate: null`
- **Expected:** 200; `fairValueEstimate: null`, `discountPercent: null`; mobile shows "Fair value unavailable"

### TC-B7: Summary — simpleExplanation empty
- **Precondition:** Analysis has empty `simpleExplanation`
- **Expected:** 200; `headline` falls back to first 100 chars of reasoning

### TC-B8: Summary — analysisAge from cache
- **Precondition:** Cache exists for symbol
- **Action:** `GET /api/stock/COMI/summary`
- **Expected:** `analysisAge` > 0 (minutes since cache write)

---

## Mobile Test Cases

### TC-M1: Stock tap → summary card loads
- **Precondition:** App on Stock Search tab, backend running
- **Action:** Tap a stock (e.g. COMI)
- **Expected:** Header card (symbol, name, price) + StockSummaryCard with recommendation badge, valuation bar, confidence/risk pills, headline, entry zone
- **Verify:** No blank sections; recommendation color matches type (green=Buy, red=Sell, etc.)

### TC-M2: Loading state
- **Action:** Tap stock; observe during fetch
- **Expected:** Skeleton placeholder in summary area; no crash
- **Verify:** Skeleton approximates card layout

### TC-M3: Error state + retry
- **Precondition:** Backend down or network off
- **Action:** Tap stock
- **Expected:** Error message + "Retry" button
- **Action:** Tap Retry (with backend up)
- **Expected:** Summary loads successfully

### TC-M4: Full Analysis expandable
- **Precondition:** Summary card visible
- **Action:** Tap "Full Analysis" row
- **Expected:** Section expands; StockAnalysis component loads (providers, run analysis, etc.)
- **Action:** Tap again
- **Expected:** Section collapses

### TC-M5: Back to Search clears state
- **Precondition:** Stock selected, Full Analysis expanded
- **Action:** Tap "Back to Search"
- **Expected:** Returns to search list; `showFullAnalysis` reset; no stale state on next tap

### TC-M6: Stale analysis warning
- **Precondition:** `analysisAge` > 24 hours (e.g. cache from yesterday)
- **Expected:** "Last updated X hours ago. Refresh recommended." + refresh icon
- **Action:** Tap refresh icon
- **Expected:** Refetches with `?refresh=true`; summary updates

### TC-M7: Valuation bar — fair value available
- **Precondition:** Summary has `fairValueEstimate` and `currentPrice`
- **Expected:** Horizontal bar showing current vs fair value; discount/above text

### TC-M8: Valuation bar — fair value unavailable
- **Precondition:** `fairValueEstimate` is null
- **Expected:** "Fair value unavailable" text; no bar

### TC-M9: Entry zone indicator — in zone
- **Precondition:** `inEntryZone: true` (price in Buy or Strong Buy zone)
- **Expected:** Check icon + "In entry zone (Buy)" or similar

### TC-M10: Entry zone indicator — above zone
- **Precondition:** `inEntryZone: false`
- **Expected:** Up arrow + zone name (e.g. "Hold zone")

### TC-M11: Price API path
- **Action:** Tap stock
- **Expected:** Header price loads from `GET /api/prices/:symbol` (not `/prices/`)
- **Verify:** Network tab shows correct URL

### TC-M12: Navigate away during load
- **Action:** Tap stock, immediately tap "Back to Search" before summary loads
- **Expected:** No crash; AbortController cancels fetch; no zombie requests

---

## QA Browse Checklist (Manual / Simulator)

**Scope:** EQU-5 One-Tap Summary View  
**App:** Equra AI Mobile (Expo)  
**Backend:** Equra AI Backend (e.g. `https://equra-ai-backend-production-3be3.up.railway.app` or local)

### Setup
- [ ] Backend running and reachable
- [ ] Mobile app built/running (Expo Go, iOS Simulator, or Android Emulator)
- [ ] Logged in or in guest mode (if required)

### Navigation & Core Flows

**Stock Search → Summary flow:**
- [ ] Open app → Stock Search tab
- [ ] Search or scroll to a stock (e.g. COMI, ETEL)
- [ ] Tap stock
- [ ] Header card shows: symbol, name, price, change %
- [ ] Summary card shows below: recommendation badge, valuation, confidence/risk, headline, entry zone
- [ ] No blank sections; no red errors in console

**Full Analysis expandable:**
- [ ] Tap "Full Analysis" row
- [ ] Section expands; full StockAnalysis loads
- [ ] Tap again; section collapses

**Back to Search:**
- [ ] Tap "Back to Search"
- [ ] Returns to search list
- [ ] Tap another stock; summary loads correctly (no stale expand state)

### Inspection

- [ ] **Console:** No unhandled errors when tapping stocks, expanding, or going back
- [ ] **Network:** `GET /api/stock/:symbol/summary` returns 200; `GET /api/prices/:symbol` returns 200
- [ ] **Layout:** Summary card readable on phone size; no overflow or cut-off text
- [ ] **Empty/Error:** With backend off, error state + Retry works

### Edge Cases

- [ ] Invalid symbol (if testable): 400 from summary endpoint
- [ ] Stale cache: "Last updated X hours ago" + refresh button appears
- [ ] Fair value null: "Fair value unavailable" shown

### Summary Template

```
QA Pass Summary: [Backend URL] + Mobile App
- Stock tap → Summary: [PASS/FAIL] — [notes]
- Full Analysis expand: [PASS/FAIL] — [notes]
- Back to Search: [PASS/FAIL] — [notes]
- Console errors: [none / list]
- Layout: [OK / issues]
- Blockers: [list or "None"]
```

---

## QA Pass Results (Playwright — Web Browser)

**Date:** 2026-03-14  
**URL:** http://localhost:8082 (Expo web)  
**Backend:** https://equra-ai-backend-production-3be3.up.railway.app

### Results

| Flow | Pass | Notes |
|------|------|-------|
| Stock tap → Summary | PASS | Skeleton loads briefly; summary card loads with recommendation, valuation, confidence, headline, entry zone |
| Full Analysis expand | PASS | Expands to show AI Stock Analysis with Run Analysis |
| Back to Search | PASS | Returns to stock list; state cleared |
| Network | PASS | `GET /api/stock/ABUK/summary` 200, `GET /api/prices/ABUK` 200 |
| Console | PASS | 0 errors, 2 warnings (deprecation only) |

### Screenshots (Playwright)

- `equ-5-stock-search-abuk-selected.png` — Loading state (skeleton + spinner)
- `equ-5-summary-loaded-abuk.png` — Summary loaded (Strong Buy, valuation bar, 35.7% below fair value, entry zone)
- `equ-5-full-analysis-expanded.png` — Full Analysis expanded
- `equ-5-back-to-search.png` — Back to search list
