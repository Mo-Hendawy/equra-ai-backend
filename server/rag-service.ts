import * as path from "path";
import * as lancedb from "@lancedb/lancedb";

const DB_PATH = path.join(process.cwd(), "server", "data", "lancedb");
const EMBED_MODEL = "gemini-embedding-001";

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
 * Retrieve relevant financial report chunks for a stock symbol.
 * Returns top N chunks most similar to a query about the stock.
 */
export async function getRelevantContext(
  symbol: string,
  query: string,
  limit = 5
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
    console.warn("RAG getRelevantContext error:", e);
    return [];
  }
}

/**
 * Get context for stock analysis - optimized query for valuation/financials.
 */
export async function getStockAnalysisContext(symbol: string): Promise<string> {
  const query = `${symbol} financial performance revenue profit margin earnings quarterly annual report valuation`;
  const chunks = await getRelevantContext(symbol, query, 6);
  if (chunks.length === 0) return "";

  return `\n\nRELEVANT EXCERPTS FROM COMPANY FINANCIAL REPORTS (${symbol}):\n${chunks
    .map((c, i) => `--- Excerpt ${i + 1} ---\n${c}`)
    .join("\n\n")}`;
}

/**
 * Get RAG context for multiple symbols (portfolio, compare, deploy).
 * Fetches top 3 chunks per symbol to keep total context manageable.
 */
export async function getMultiStockContext(symbols: string[]): Promise<{ context: string; symbolsWithData: string[] }> {
  const symbolsWithData: string[] = [];
  const parts: string[] = [];

  for (const symbol of symbols) {
    const query = `${symbol} financial performance revenue profit earnings valuation`;
    const chunks = await getRelevantContext(symbol, query, 3);
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
