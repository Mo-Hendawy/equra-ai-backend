# Equra AI Backend

Backend API server for Equra AI mobile app - Egyptian Stock Exchange (EGX) portfolio management.

## Features
- Real-time stock price fetching from EOD Historical Data API
- AI-powered stock analysis using Google Gemini
- **RAG (Retrieval-Augmented Generation)** – financial PDFs embedded for context-aware analysis
- Batch price updates
- Caching for performance

## Environment Variables
- `GEMINI_API_KEY` – Google Gemini API key (AI + embeddings)
- `EODHD_API_TOKEN` – EOD Historical Data API token (prices, news, historical data)
- `PORT` – Server port (default: 5000)
- `NODE_ENV` – Environment (development/production)
- `RAG_HYBRID_ENABLED` – Set to `false` to disable hybrid RAG (query expansion + keyword re-ranking). Default: enabled.

## RAG: Financial Reports

Stock analysis uses RAG to inject relevant chunks from company financial PDFs into prompts.

**RAG improvements (hybrid retrieval):**
- **Query expansion** – Multiple query variants (valuation, earnings, balance sheet) for better recall
- **RRF merge** – Reciprocal Rank Fusion to combine results from each variant
- **Keyword re-ranking** – Score chunks by term overlap with query for better precision

### Setup

1. **Place PDFs** in `C:\Repos\Financial-Reports\{SYMBOL}\` (one folder per ticker, e.g. `ABUK`, `COMI`).
2. **Ingest** to build embeddings and store in LanceDB:
   ```bash
   npx tsx server/scripts/ingest-pdfs.ts
   ```
3. Ensure `GEMINI_API_KEY` is set in `.env` (used for embeddings).

### Paths

| Item | Path |
|------|------|
| PDF source | `C:\Repos\Financial-Reports\{SYMBOL}\` |
| LanceDB | `server/data/lancedb` |
| Manifest | `server/data/rag-manifest.json` |
| History | `server/data/RAG_HISTORY.md` |

### Commands

| Command | Description |
|---------|-------------|
| `npx tsx server/scripts/ingest-pdfs.ts` | Ingest PDFs → embeddings → LanceDB |
| `npx tsx server/scripts/rag-status.ts` | Regenerate manifest/history from LanceDB |
| `GET /api/rag/status` | Return RAG manifest JSON |

### Current Status (as of last ingestion)

| Company | Vectors |
|---------|---------|
| ABUK | 52 |
| COMI | 136 |
| EFID | 30 |
| EGAL | 7 |
| ETEL | 7 |
| JUFO | 13 |
| MICH | 33 |
| SWDY | 30 |

**Total:** 308 vectors across 8 companies. See `server/data/RAG_HISTORY.md` for details.

## Deploy to Railway
1. Connect this repo to Railway
2. Set environment variables: `GEMINI_API_KEY`, `EODHD_API_TOKEN`
3. Railway will auto-deploy

## Local Development
```bash
npm install
npm run dev
```
