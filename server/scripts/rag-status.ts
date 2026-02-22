/**
 * Generate RAG manifest and history from existing LanceDB data.
 * Run this when you want to document current RAG state without re-ingesting.
 *
 * Usage: npx tsx server/scripts/rag-status.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as lancedb from "@lancedb/lancedb";

const DB_PATH = path.join(process.cwd(), "server", "data", "lancedb");
const REPORTS_DIR = "C:\\Repos\\Financial-Reports";
const MANIFEST_PATH = path.join(process.cwd(), "server", "data", "rag-manifest.json");
const HISTORY_PATH = path.join(process.cwd(), "server", "data", "RAG_HISTORY.md");

interface TableStats {
  symbol: string;
  tableName: string;
  vectorCount: number;
  filenames: string[];
  status: "full" | "partial" | "empty";
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error("LanceDB not found at:", DB_PATH);
    process.exit(1);
  }

  const db = await lancedb.connect(DB_PATH);
  const tableNames = await db.tableNames();
  const financialTables = tableNames.filter((t) => t.startsWith("financial_reports_"));

  const results: TableStats[] = [];

  for (const tableName of financialTables) {
    const symbol = tableName.replace("financial_reports_", "").toUpperCase();
    const table = await db.openTable(tableName);
    const rows = await table.query().limit(100000).toArray();
    const vectorCount = rows.length;

    const filenames = [...new Set((rows as any[]).map((r) => r.filename).filter(Boolean))];

    results.push({
      symbol,
      tableName,
      vectorCount,
      filenames,
      status: vectorCount > 0 ? "full" : "empty",
    });
  }

  // Check source folder for companies we might have missed
  if (fs.existsSync(REPORTS_DIR)) {
    const dirs = fs.readdirSync(REPORTS_DIR);
    for (const d of dirs) {
      const dirPath = path.join(REPORTS_DIR, d);
      if (fs.statSync(dirPath).isDirectory()) {
        const existing = results.find((r) => r.symbol.toUpperCase() === d.toUpperCase());
        if (!existing) {
          const pdfs = fs.readdirSync(dirPath).filter((f) => f.toLowerCase().endsWith(".pdf"));
          results.push({
            symbol: d.toUpperCase(),
            tableName: `financial_reports_${d.toLowerCase()}`,
            vectorCount: 0,
            filenames: pdfs,
            status: "empty",
          });
        }
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: "rag-status.ts (read from LanceDB)",
    sourceDir: REPORTS_DIR,
    lancedbPath: DB_PATH,
    companies: results,
    summary: {
      totalCompanies: results.length,
      withVectors: results.filter((r) => r.vectorCount > 0).length,
      empty: results.filter((r) => r.vectorCount === 0).length,
      totalVectors: results.reduce((s, r) => s + r.vectorCount, 0),
    },
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
  console.log("Manifest written:", MANIFEST_PATH);

  const lines: string[] = [
    "# RAG Ingestion History",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Source:** Read from existing LanceDB (\`rag-status.ts\`)`,
    `**LanceDB:** \`${DB_PATH}\``,
    "",
    "---",
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Companies with vectors | ${manifest.summary.withVectors} |`,
    `| Companies empty | ${manifest.summary.empty} |`,
    `| Total vectors | ${manifest.summary.totalVectors} |`,
    "",
    "---",
    "",
    "## Per-Company Details",
    "",
  ];

  for (const c of results) {
    const badge = c.vectorCount > 0 ? "✅" : "❌ EMPTY";
    lines.push(`### ${c.symbol} — ${badge}`);
    lines.push("");
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Table | \`${c.tableName}\` |`);
    lines.push(`| Vectors | ${c.vectorCount} |`);
    lines.push(`| Source PDFs (from filenames in DB) | ${c.filenames.join(", ") || "—"} |`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("*Run `npx tsx server/scripts/ingest-pdfs.ts` to re-ingest. Run `npx tsx server/scripts/rag-status.ts` to refresh this from existing DB.*");

  fs.writeFileSync(HISTORY_PATH, lines.join("\n"), "utf-8");
  console.log("History written:", HISTORY_PATH);
}

main().catch(console.error);
