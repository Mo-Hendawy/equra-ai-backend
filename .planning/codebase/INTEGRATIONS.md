# External Integrations

**Analysis Date:** 2026-04-03

## APIs & External Services

### AI/LLM Providers

**Google Gemini (Primary):**
- Used for: Stock analysis, portfolio analysis, capital deployment, stock comparison, behavior analysis, vision (transaction/dividend extraction from screenshots), embeddings for RAG
- SDK/Client:  ^0.24.1
- Auth env var: - Models used:
  -  - Fast multi-provider analysis ()
  -  - Legacy detailed stock analysis ()
  -  - Vision/image processing ()
  -  - RAG embeddings via REST (, )
- Embedding endpoint (raw fetch, not SDK): - Retry logic: Exponential backoff on 429/503 errors, max 3-5 retries depending on service
- Files: , , , 