/**
 * Quick sanity test for a single-company RAG table.
 * Usage:  npx tsx server/scripts/test-rag-query.ts OLFI "What was FY2025 revenue?"
 * Prints top matches with distance score and a text snippet.
 */
import * as lancedb from "@lancedb/lancedb";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY missing in .env");
  process.exit(1);
}

const DB_PATH = path.join(process.cwd(), "server", "data", "lancedb");
const EMBED_MODEL = "gemini-embedding-001";
const TOP_K = 6;

async function embed(text: string): Promise<number[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
      }),
    }
  );
  if (!res.ok) throw new Error(`Embed failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.embedding?.values ?? [];
}

async function main() {
  const [symbol, ...queryParts] = process.argv.slice(2);
  if (!symbol || queryParts.length === 0) {
    console.error('Usage: npx tsx server/scripts/test-rag-query.ts SYMBOL "query text"');
    process.exit(1);
  }
  const query = queryParts.join(" ");
  const tableName = `financial_reports_${symbol.toLowerCase()}`;

  console.log(`🔎 Table: ${tableName}`);
  console.log(`❓ Query: "${query}"\n`);

  const db = await lancedb.connect(DB_PATH);
  const names = await db.tableNames();
  if (!names.includes(tableName)) {
    console.error(`Table "${tableName}" not found. Available: ${names.join(", ")}`);
    process.exit(1);
  }

  const table = await db.openTable(tableName);
  const totalRows = await table.countRows();
  console.log(`📊 Table has ${totalRows} vectors\n`);

  console.log("⏳ Embedding query...");
  const queryVec = await embed(query);
  console.log(`   vector dim: ${queryVec.length}\n`);

  const results = await table
    .search(queryVec)
    .limit(TOP_K)
    .toArray();

  console.log(`🎯 Top ${results.length} matches:\n`);
  results.forEach((r: any, i: number) => {
    const dist = typeof r._distance === "number" ? r._distance.toFixed(4) : "?";
    const snippet = (r.text ?? "").replace(/\s+/g, " ").slice(0, 220);
    console.log(`${i + 1}. [${dist}] (${r.filename})`);
    console.log(`   ${snippet}${snippet.length >= 220 ? "…" : ""}\n`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
