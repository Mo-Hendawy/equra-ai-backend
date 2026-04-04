# Technology Stack

**Analysis Date:** 2026-04-03

## Languages

**Primary:**
- TypeScript ~5.9.2 - All server-side code (`server/**/*.ts`)

**Secondary:**
- JavaScript (ESM) - One-off script: `server/download-financial-reports.mjs`

## Runtime

**Environment:**
- Node.js >= 18.0.0 (specified in `package.json` engines field)
- ESM modules (`"type": "module"` in `package.json`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present (lockfileVersion 3)

## Frameworks

**Core:**
- Express 5.0.1 - HTTP server and REST API (`server/index.ts`)
  - Note: Express **v5** (not v4). Uses `express.json()`, `express.urlencoded()`, custom CORS middleware.
  - Type definitions: `@types/express` ^5.0.0

**AI/ML:**
- `@google/generative-ai` ^0.24.1 - Google Gemini SDK for text generation, vision, and embeddings
- `openai` ^6.22.0 - OpenAI-compatible SDK used as client for Groq, Cerebras, HuggingFace, and OpenRouter

**Validation:**
- Zod ^4.3.6 - Runtime schema validation for all AI response parsing (`server/schemas/analysis-schemas.ts`)

**Vector Database:**
- `@lancedb/lancedb` ^0.26.2 - Local embedded vector database for RAG (`server/data/lancedb/`)

**PDF Processing:**
- `pdf-parse` ^2.4.5 - PDF text extraction for RAG ingestion (`server/scripts/ingest-pdfs.ts`)

**Build/Dev:**
- `tsx` ^4.20.6 - TypeScript execution without compilation step (both dev and production)
- TypeScript ~5.9.2 - Type checking (devDependency)

## Key Dependencies

**Critical (runtime):**
- `@google/generative-ai` ^0.24.1 - Core AI analysis engine (Gemini 2.5 Flash + Gemini 2.5 Pro)
- `openai` ^6.22.0 - Multi-provider AI client (Groq, Cerebras, HuggingFace via OpenAI-compatible API)
- `@lancedb/lancedb` ^0.26.2 - RAG vector storage and similarity search
- `express` ^5.0.1 - HTTP server
- `zod` ^4.3.6 - AI response validation
- `dotenv` ^16.4.7 - Environment variable loading

**Dev only:**
- `@types/express` ^5.0.0
- `@types/node` 24.10.0
- `@types/pdf-parse` ^1.1.5
- `typescript` ~5.9.2

**Not used in backend (legacy from monorepo split):**
- `package.json.original` contains Expo/React Native dependencies from the original monorepo. The current `package.json` is backend-only.

## Configuration

**Environment:**
- Configuration via `.env` file in project root (loaded by `dotenv`)
- `.env` file present (contains API keys and configuration - not readable for security)
- Required env vars for core functionality:
  - `GEMINI_API_KEY` - Google Gemini API key (AI analysis + embeddings + vision)
  - `EODHD_API_TOKEN` - EOD Historical Data API token (stock prices, historical data, news)
  - `PORT` - Server port (default: 5000)
  - `NODE_ENV` - Environment mode (development/production)
- Optional env vars for additional AI providers:
  - `GROQ_API_KEY` - Groq cloud inference
  - `CEREBRAS_API_KEY` - Cerebras cloud inference
  - `HUGGINGFACE_API_KEY` - HuggingFace Inference API (Qwen model + FinBERT sentiment)
  - `OPENROUTER_API_KEY` - OpenRouter API (defined but not in active provider list)
  - `MANUS_API_KEY` - Manus AI deep analysis agent
  - `RAILWAY_PUBLIC_URL` - Public URL for Manus webhook registration
  - `RAG_HYBRID_ENABLED` - Set to `false` to disable hybrid RAG (default: enabled)
  - `REPLIT_DEV_DOMAIN` / `REPLIT_DOMAINS` - Replit-specific CORS origins

**Build:**
- No build step required. `tsx` runs TypeScript directly at runtime.
- `npm run start` = `NODE_ENV=production tsx server/index.ts`
- `npm run dev` = `NODE_ENV=development tsx server/index.ts`
- No `tsconfig.json` present in the backend repo (relies on tsx defaults)

## Platform Requirements

**Development:**
- Node.js >= 18.0.0
- npm
- `.env` file with at minimum `GEMINI_API_KEY`
- For RAG: PDF files in external directory (`C:\Repos\Financial-Reports\{SYMBOL}\`) and run ingestion script

**Production:**
- Node.js >= 18.0.0
- Deployment target: Railway (indicated by `RAILWAY_PUBLIC_URL` env var and webhook patterns)
- Originally developed on Replit (CORS config references `REPLIT_DEV_DOMAIN`, `REPLIT_DOMAINS`)
- No Docker or container configuration present
- No CI/CD pipeline files present

## AI Models Used

| Provider | Model ID | Purpose | SDK |
|----------|----------|---------|-----|
| Google Gemini | `gemini-2.5-flash` | Multi-provider analysis (fast) | `@google/generative-ai` |
| Google Gemini | `gemini-2.5-pro` | Legacy single-stock analysis (via `gemini-service.ts`) | `@google/generative-ai` |
| Google Gemini | `gemini-2.5-flash-lite` | Vision: transaction/dividend extraction from images | `@google/generative-ai` |
| Google Gemini | `gemini-embedding-001` | RAG embeddings (via REST API, not SDK) | `fetch` |
| Groq | `meta-llama/llama-4-scout-17b-16e-instruct` | Alternative AI analysis provider | `openai` SDK |
| Cerebras | `gpt-oss-120b` | Alternative AI analysis provider | `openai` SDK |
| HuggingFace | `Qwen/Qwen2.5-72B-Instruct` | Alternative AI analysis provider | `openai` SDK |
| HuggingFace | `ProsusAI/finbert` | Financial sentiment analysis (via Inference API) | `fetch` |
| Manus AI | `manus-1.6` | Deep-dive autonomous agent analysis | `fetch` |

---

*Stack analysis: 2026-04-03*
