# RAG Ingestion History

**Generated:** 2026-04-16T04:10:01.263Z
**Source:** Read from existing LanceDB (`rag-status.ts`)
**LanceDB:** `C:\Repos\equra-ai-backend\server\data\lancedb`

---

## Summary

| Metric | Value |
|--------|-------|
| Companies with vectors | 10 |
| Companies empty | 1 |
| Total vectors | 852 |

---

## Per-Company Details

### ABUK — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_abuk` |
| Vectors | 52 |
| Source PDFs (from filenames in DB) | ABUK-Annual-Budget-2025.pdf, ABUK-Q1-2026.pdf, ABUK-Q2-2025.pdf, ABUK-Q3-2025.pdf |

### CIEB — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_cieb` |
| Vectors | 236 |
| Source PDFs (from filenames in DB) | CIEB-Q1-2025-Separate.pdf, CIEB-Q2-2025-Separate.pdf, CIEB-Q3-2025-Separate.pdf, CIEB-Q4-2025-Separate.pdf |

### COMI — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_comi` |
| Vectors | 136 |
| Source PDFs (from filenames in DB) | CIB Condensed Financial Statements Standalone March25 ENGLISH.pdf, CIB Separate Condensed financial statements December 2025 English.pdf, CIB Separate Condensed financial statements June 2025 English.pdf, CIB Separate Condensed financial statements September 2025 English.pdf |

### EFID — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_efid` |
| Vectors | 43 |
| Source PDFs (from filenames in DB) | 2025-q2-earnings-en.pdf, Edita-1Q2025-Earnings-release-E-vf.pdf, Edita-3Q2025-Earnings-Release-E-FINAL.pdf, Edita-4Q2025-Earnings-Release.pdf, Edita-FY2025-Consolidated.pdf, Edita-FY2025-Standalone.pdf |

### EGAL — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_egal` |
| Vectors | 7 |
| Source PDFs (from filenames in DB) | 9 Months -- 2025.pdf, Annual -- 2025.pdf, EGAL-Q1.pdf, Quarter -- 2025.pdf, Quarter -- 2026.pdf, Semi-annual -- 2025.pdf |

### ETEL — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_etel` |
| Vectors | 14 |
| Source PDFs (from filenames in DB) | Earnings_Release-Q2-2025.pdf, Earnings_Release-Q3-2025.pdf, Earnings_Release-Q4-2025.pdf, Earnings_Releasea-Q1-2025.pdf |

### ISPH — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_isph` |
| Vectors | 155 |
| Source PDFs (from filenames in DB) | ISPH-FY2025-Earnings.pdf, ISPH-Q1-2025-Earnings.pdf, ISPH-Q1-2025-Standalone.pdf, ISPH-Q2-2025-Standalone.pdf, ISPH-Q3-2025-Earnings.pdf, ISPH-Q3-2025-Standalone.pdf, ISPH-Q4-2025-Standalone.pdf |

### JUFO — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_jufo` |
| Vectors | 136 |
| Source PDFs (from filenames in DB) | JUFO-4Q25-Earnings-Release.pdf, JUFO-FY2025-Consolidated.pdf, JUFO-FY2025-Standalone.pdf, JUFO-Q1-2025.pdf, JUFO-Q2-2025.pdf, JUFO-Q3-2025.pdf |

### MICH — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_mich` |
| Vectors | 33 |
| Source PDFs (from filenames in DB) | Misr Chemical Industries Annual 2025.pdf, Misr Chemical Industries First Quarter 2025.pdf, Misr Chemical Industries second Quarter 2025.pdf, Misr Chemical Industries Second Quarter 2026.pdf, Misr Chemical Industries Third Quarter 2025.pdf |

### SWDY — ✅

| Metric | Value |
|--------|-------|
| Table | `financial_reports_swdy` |
| Vectors | 40 |
| Source PDFs (from filenames in DB) | Elsewedy-Electric-ER-1Q2025.pdf, Elsewedy-Electric-ER-2Q2025-E-.pdf, Elsewedy-Electric-ER-3Q2025-E-.pdf, Elsewedy-Electric-ER-4Q2025-E.pdf |

### ADCI — ❌ EMPTY

| Metric | Value |
|--------|-------|
| Table | `financial_reports_adci` |
| Vectors | 0 |
| Source PDFs (from filenames in DB) | — |

---

*Run `npx tsx server/scripts/ingest-pdfs.ts` to re-ingest. Run `npx tsx server/scripts/rag-status.ts` to refresh this from existing DB.*