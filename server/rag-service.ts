import * as path from "path";
import * as lancedb from "@lancedb/lancedb";
import { getExpandedQueries } from "./rag/query-expansion";
import { mergeAndRerank } from "./rag/hybrid-retrieval";
import type { RagTaskType } from "./rag/query-expansion";

const DB_PATH = path.join(process.cwd(), "server", "data", "lancedb");
const EMBED_MODEL = "gemini-embedding-001";

// RAG improvements: set RAG_HYBRID_ENABLED=false in env to fall back to legacy vector-only
const USE_HYBRID_RAG = process.env.RAG_HYBRID_ENABLED !== "false";
const CANDIDATES_PER_QUERY = 8;
const STOCK_FINAL_LIMIT = 6;
const MULTI_FINAL_LIMIT = 3;

let dbConnection: lancedb.Connection | null = null;

async function getDb(): Promise<lancedb.Connection> {
  if (!dbConnection) {
    dbConnection = await lancedb.connect(DB_PATH);
  }
  return dbConnection;
}

async function getQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return [];

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: { parts: [{ text: query }] } }),
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.embedding?.values ?? [];
}

/**
 * Vector search only - returns raw chunks for a single query.
 */
async function getVectorResults(
  symbol: string,
  query: string,
  limit: number
): Promise<string[]> {
  try {
    const db = await getDb();
    const tableName = `financial_reports_${symbol.toLowerCase()}`;
    const tableNames = await db.tableNames();
    if (!tableNames.includes(tableName)) return [];

    const table = await db.openTable(tableName);
    const vector = await getQueryEmbedding(query);
    if (vector.length === 0) return [];

    const results = await table
      .vectorSearch(vector)
      .limit(limit)
      .toArray();

    return (results as any[])
      .map((r) => r.text)
      .filter((t): t is string => typeof t === "string");
  } catch (e) {
    console.warn("RAG getVectorResults error:", e);
    return [];
  }
}

/**
 * Hybrid retrieval: query expansion + vector search per variant + RRF merge + keyword re-rank.
 */
async function getRelevantContextHybrid(
  symbol: string,
  baseQuery: string,
  taskType: RagTaskType,
  finalLimit: number
): Promise<string[]> {
  const queries = getExpandedQueries(symbol, taskType);
  const vectorResults: string[][] = [];

  for (const q of queries) {
    const chunks = await getVectorResults(symbol, q, CANDIDATES_PER_QUERY);
    if (chunks.length > 0) vectorResults.push(chunks);
  }

  if (vectorResults.length === 0) return [];

  return mergeAndRerank(vectorResults, baseQuery, finalLimit);
}

/**
 * Retrieve relevant financial report chunks for a stock symbol.
 * Uses hybrid retrieval (query expansion + RRF + keyword re-rank) when enabled.
 */
export async function getRelevantContext(
  symbol: string,
  query: string,
  limit = 5
): Promise<string[]> {
  if (USE_HYBRID_RAG) {
    return getRelevantContextHybrid(symbol, query, "stock", limit);
  }
  return getVectorResults(symbol, query, limit);
}

/**
 * Get context for stock analysis - optimized query for valuation/financials.
 */
export async function getStockAnalysisContext(symbol: string): Promise<string> {
  const baseQuery = `${symbol} financial performance revenue profit margin earnings quarterly annual report valuation`;
  const chunks = USE_HYBRID_RAG
    ? await getRelevantContextHybrid(symbol, baseQuery, "stock", STOCK_FINAL_LIMIT)
    : await getVectorResults(symbol, baseQuery, STOCK_FINAL_LIMIT);

  if (chunks.length === 0) return "";

  return `\n\nRELEVANT EXCERPTS FROM COMPANY FINANCIAL REPORTS (${symbol}):\n${chunks
    .map((c, i) => `--- Excerpt ${i + 1} ---\n${c}`)
    .join("\n\n")}`;
}

/**
 * Get RAG context for multiple symbols (portfolio, compare, deploy).
 * Uses hybrid retrieval when enabled.
 */
export async function getMultiStockContext(
  symbols: string[],
  taskType: RagTaskType = "portfolio"
): Promise<{ context: string; symbolsWithData: string[] }> {
  const symbolsWithData: string[] = [];
  const parts: string[] = [];

  for (const symbol of symbols) {
    const baseQuery = `${symbol} financial performance revenue profit earnings valuation`;
    const chunks = USE_HYBRID_RAG
      ? await getRelevantContextHybrid(symbol, baseQuery, taskType, MULTI_FINAL_LIMIT)
      : await getVectorResults(symbol, baseQuery, MULTI_FINAL_LIMIT);

    if (chunks.length > 0) {
      symbolsWithData.push(symbol);
      parts.push(`\n--- ${symbol} Financial Report Excerpts ---\n${chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n")}`);
    }
  }

  if (parts.length === 0) return { context: "", symbolsWithData: [] };

  return {
    context: `\n\nFINANCIAL REPORT DATA (from company filings for: ${symbolsWithData.join(", ")}):\n${parts.join("\n")}`,
    symbolsWithData,
  };
}
