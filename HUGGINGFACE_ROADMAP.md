# Hugging Face Integration Roadmap for Equra AI

This document outlines the phased integration of Hugging Face models and tools to upgrade Equra AI's capabilities, reduce costs, and improve accuracy specifically for financial data.

## Phase 1: Local Free Vector Embeddings (The "No-Brainer" Upgrade)
*Status: Pending*

Currently, we rely on the Gemini API (`gemini-embedding-001`) to generate embeddings for our financial PDFs before storing them in LanceDB. This costs API credits, is subject to rate limits, and requires external network calls.

**Implementation Steps:**
1. Install `@xenova/transformers` (a JavaScript port of Hugging Face transformers that runs natively in Node.js, no Python required).
2. Download a lightweight, highly-rated embedding model like `Xenova/all-MiniLM-L6-v2` directly to the Railway server.
3. Refactor `server/scripts/ingest-pdfs.ts` to use this local model for chunking and embedding.
4. Refactor `server/rag-service.ts` to use the same local model when a user queries the vector database.

**Benefits:** 
- 100% free vectorization forever.
- Zero API rate limits (no more 429 errors during ingestion).
- Instantly fast local execution.
- True offline capability for the Vector DB layer.

---

## Phase 2: Financial Sentiment Dashboard (FinBERT)
*Status: Pending*

Add a "Market Sentiment" gauge to the Stock Details page in the mobile app, providing an instant read on the market's mood without reading articles.

**Implementation Steps:**
1. Connect to a free financial news API or build a lightweight scraper to pull the 5 most recent news headlines or company press releases for a specific EGX stock.
2. Route these texts through **FinBERT** (a Hugging Face model trained specifically on financial text) via the Hugging Face Inference API.
3. Calculate an aggregate "Sentiment Score" (e.g., 75% Bullish, 20% Neutral, 5% Bearish).
4. Update the React Native UI to display a visual Sentiment Gauge on the `StockAnalysis` screen.

**Benefits:** 
- FinBERT is domain-specific; it understands that "debt increased" is negative while "revenue increased" is positive, unlike general sentiment analyzers.

---

## Phase 3: Zero-Shot KPI Extraction (LayoutLM / Donut)
*Status: Pending*

Currently, we parse raw text from PDFs and ask general LLMs to "find the revenue." This is highly prone to hallucination when dealing with complex, multi-column EGX financial tables.

**Implementation Steps:**
1. Utilize a Document AI model from Hugging Face (such as `Donut` or `LayoutLMv3`).
2. Instead of extracting raw text, pass the actual *image* of the EGX Income Statement page to the model.
3. Prompt the model to return a strict JSON schema: `{"Q3_Revenue": ..., "Q3_Net_Profit": ...}` based on visual layout.
4. Save this highly accurate, structured JSON alongside the PDFs in our repository for instant prompt injection.

**Benefits:** 
- Enterprise-grade accuracy.
- Complete elimination of LLM hallucinations when pulling exact numerical figures out of financial tables.

---

## Phase 4: Open-Source Financial LLMs (FinGPT / Llama-3-Fin)
*Status: Pending*

Reduce reliance on general-purpose models (Gemini/DeepSeek) for deep financial reasoning by utilizing specialized, open-source financial models.

**Implementation Steps:**
1. Connect to Hugging Face's serverless inference endpoints.
2. Create a new provider in `server/ai-providers.ts` for a finance-specific model (e.g., a FinGPT variant).
3. Route our `deploy`, `portfolio`, and `stock` analysis prompts to this model as an additional tab in the mobile UI.

**Benefits:** 
- Highly specialized advice. Models trained exclusively on finance generate more professional, "Bloomberg-style" commentary without being distracted by general knowledge data.
