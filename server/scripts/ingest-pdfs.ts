import * as fs from 'fs';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';
import * as lancedb from '@lancedb/lancedb';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env') });

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("GEMINI_API_KEY is not set in .env");
    process.exit(1);
}

const EMBED_MODEL = "gemini-embedding-001";

// The location where we manually downloaded all the PDFs
const REPORTS_DIR = "C:\\Repos\\Financial-Reports";
// The local database directory
const DB_PATH = path.join(process.cwd(), "server", "data", "lancedb");

const DELAY_MS = 300;
const MAX_RETRIES = 5;

async function getEmbedding(text: string): Promise<number[]> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        content: { parts: [{ text }] },
                    }),
                }
            );
            if (res.status === 429) {
                const waitMs = Math.min(60000, Math.pow(2, attempt) * 5000);
                console.warn(`    Rate limited (429). Waiting ${waitMs / 1000}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
                await new Promise(r => setTimeout(r, waitMs));
                continue;
            }
            if (!res.ok) throw new Error(`Embed API ${res.status}: ${await res.text()}`);
            const data = await res.json();
            return data.embedding?.values ?? [];
        } catch (e) {
            if (attempt === MAX_RETRIES - 1) throw e;
            const waitMs = Math.pow(2, attempt) * 2000;
            console.warn(`    Embed error, retry in ${waitMs / 1000}s...`);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    throw new Error("Max retries exceeded");
}

// Simple text chunker: split by paragraphs, then group up to maxChars
function chunkText(text: string, maxChars = 1000): string[] {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const p of paragraphs) {
        // Clean up whitespace and newlines
        const cleanP = p.replace(/\s+/g, ' ').trim();
        if (!cleanP) continue;
        
        if ((currentChunk.length + cleanP.length) > maxChars && currentChunk.length > 0) {
            chunks.push(currentChunk.trim());
            currentChunk = cleanP;
        } else {
            currentChunk += (currentChunk ? " " : "") + cleanP;
        }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
}

interface FileIngestionResult {
    filename: string;
    chunksExtracted: number;
    chunksSkipped: number;
    chunksEmbedded: number;
    chunksFailed: number;
    status: "full" | "partial" | "empty" | "error";
    error?: string;
}

interface CompanyIngestionResult {
    symbol: string;
    pdfCount: number;
    files: FileIngestionResult[];
    totalChunksExtracted: number;
    totalChunksEmbedded: number;
    totalChunksFailed: number;
    totalChunksSkipped: number;
    vectorsInLanceDB: number;
    status: "full" | "partial" | "empty" | "error";
    tableName: string;
}

async function processCompany(symbol: string, db: lancedb.Connection): Promise<CompanyIngestionResult | null> {
    const companyDir = path.join(REPORTS_DIR, symbol);
    if (!fs.existsSync(companyDir)) return null;

    const files = fs.readdirSync(companyDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    if (files.length === 0) return null;

    console.log(`\nProcessing ${symbol}... found ${files.length} PDFs.`);
    
    const records: Array<{ vector: number[], text: string, symbol: string, filename: string }> = [];
    const fileResults: FileIngestionResult[] = [];

    for (const file of files) {
        const filePath = path.join(companyDir, file);
        console.log(`  Reading ${file}...`);
        let chunksExtracted = 0;
        let chunksSkipped = 0;
        let chunksEmbedded = 0;
        let chunksFailed = 0;
        let fileError: string | undefined;

        try {
            const dataBuffer = fs.readFileSync(filePath);
            const parser = new PDFParse({ data: dataBuffer });
            const result = await parser.getText();
            const text = result.text;
            await parser.destroy();
            
            const chunks = chunkText(text);
            chunksExtracted = chunks.length;
            console.log(`    Extracted ${chunks.length} chunks. Generating embeddings...`);
            
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                if (chunk.length < 50) {
                    chunksSkipped++;
                    continue;
                }
                
                try {
                    const vector = await getEmbedding(chunk);
                    records.push({
                        vector,
                        text: chunk,
                        symbol,
                        filename: file
                    });
                    chunksEmbedded++;
                } catch (err) {
                    chunksFailed++;
                    console.error(`    Failed to embed chunk ${i+1}/${chunks.length} of ${file}`);
                }
                
                await new Promise(r => setTimeout(r, DELAY_MS));
            }

            let status: FileIngestionResult["status"] = "full";
            if (chunksFailed > 0 && chunksEmbedded > 0) status = "partial";
            else if (chunksEmbedded === 0) status = chunksFailed > 0 ? "empty" : "empty";
            fileResults.push({
                filename: file,
                chunksExtracted,
                chunksSkipped,
                chunksEmbedded,
                chunksFailed,
                status,
            });
        } catch (error: any) {
            fileError = error?.message || String(error);
            console.error(`  Error processing ${file}:`, error);
            fileResults.push({
                filename: file,
                chunksExtracted: 0,
                chunksSkipped: 0,
                chunksEmbedded: 0,
                chunksFailed: 0,
                status: "error",
                error: fileError,
            });
        }
    }

    const tableName = `financial_reports_${symbol.toLowerCase()}`;
    let vectorsInLanceDB = 0;

    if (records.length > 0) {
        console.log(`  Saving ${records.length} vectors to LanceDB table: ${tableName}...`);
        try {
            const tableNames = await db.tableNames();
            if (tableNames.includes(tableName)) {
                console.log(`  Dropping existing table ${tableName} to replace it...`);
                await db.dropTable(tableName);
            }
            await db.createTable(tableName, records);
            vectorsInLanceDB = records.length;
            console.log(`  ✅ Successfully created table ${tableName}!`);
        } catch (error) {
            console.error(`  Error saving to DB:`, error);
        }
    }

    const totalChunksExtracted = fileResults.reduce((s, f) => s + f.chunksExtracted, 0);
    const totalChunksEmbedded = fileResults.reduce((s, f) => s + f.chunksEmbedded, 0);
    const totalChunksFailed = fileResults.reduce((s, f) => s + f.chunksFailed, 0);
    const totalChunksSkipped = fileResults.reduce((s, f) => s + f.chunksSkipped, 0);

    let status: CompanyIngestionResult["status"] = "full";
    if (vectorsInLanceDB === 0) status = totalChunksFailed > 0 ? "empty" : "empty";
    else if (totalChunksFailed > 0 || fileResults.some(f => f.status === "partial")) status = "partial";
    else if (fileResults.some(f => f.status === "error")) status = "partial";

    return {
        symbol,
        pdfCount: files.length,
        files: fileResults,
        totalChunksExtracted,
        totalChunksEmbedded,
        totalChunksFailed,
        totalChunksSkipped,
        vectorsInLanceDB,
        status,
        tableName,
    };
}

const MANIFEST_PATH = path.join(process.cwd(), "server", "data", "rag-manifest.json");
const HISTORY_PATH = path.join(process.cwd(), "server", "data", "RAG_HISTORY.md");

function writeRagManifest(results: CompanyIngestionResult[]) {
    const manifest = {
        generatedAt: new Date().toISOString(),
        sourceDir: REPORTS_DIR,
        lancedbPath: DB_PATH,
        embedModel: EMBED_MODEL,
        companies: results,
        summary: {
            totalCompanies: results.length,
            full: results.filter(r => r.status === "full").length,
            partial: results.filter(r => r.status === "partial").length,
            empty: results.filter(r => r.status === "empty").length,
            error: results.filter(r => r.status === "error").length,
            totalVectors: results.reduce((s, r) => s + r.vectorsInLanceDB, 0),
            totalChunksExtracted: results.reduce((s, r) => s + r.totalChunksExtracted, 0),
            totalChunksEmbedded: results.reduce((s, r) => s + r.totalChunksEmbedded, 0),
            totalChunksFailed: results.reduce((s, r) => s + r.totalChunksFailed, 0),
        },
    };
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`\n📄 Manifest written: ${MANIFEST_PATH}`);
}

function writeRagHistory(results: CompanyIngestionResult[]) {
    const lines: string[] = [
        "# RAG Ingestion History",
        "",
        `**Last run:** ${new Date().toISOString()}`,
        `**Source:** \`${REPORTS_DIR}\``,
        `**LanceDB:** \`${DB_PATH}\``,
        `**Embedding model:** ${EMBED_MODEL}`,
        "",
        "---",
        "",
        "## Summary",
        "",
        "| Status | Count |",
        "|--------|-------|",
        `| Full (all chunks embedded) | ${results.filter(r => r.status === "full").length} |`,
        `| Partial (some chunks failed) | ${results.filter(r => r.status === "partial").length} |`,
        `| Empty (no vectors stored) | ${results.filter(r => r.status === "empty").length} |`,
        `| Error | ${results.filter(r => r.status === "error").length} |`,
        "",
        `**Total vectors in LanceDB:** ${results.reduce((s, r) => s + r.vectorsInLanceDB, 0)}`,
        `**Total chunks extracted:** ${results.reduce((s, r) => s + r.totalChunksExtracted, 0)}`,
        `**Total chunks embedded:** ${results.reduce((s, r) => s + r.totalChunksEmbedded, 0)}`,
        `**Total chunks failed (e.g. rate limit):** ${results.reduce((s, r) => s + r.totalChunksFailed, 0)}`,
        "",
        "---",
        "",
        "## Per-Company Details",
        "",
    ];

    for (const c of results) {
        const statusBadge = c.status === "full" ? "✅ FULL" : c.status === "partial" ? "⚠️ PARTIAL" : c.status === "empty" ? "❌ EMPTY" : "🔴 ERROR";
        lines.push(`### ${c.symbol} — ${statusBadge}`);
        lines.push("");
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| PDF files | ${c.pdfCount} |`);
        lines.push(`| Table name | \`${c.tableName}\` |`);
        lines.push(`| Vectors in LanceDB | ${c.vectorsInLanceDB} |`);
        lines.push(`| Chunks extracted | ${c.totalChunksExtracted} |`);
        lines.push(`| Chunks embedded | ${c.totalChunksEmbedded} |`);
        lines.push(`| Chunks failed | ${c.totalChunksFailed} |`);
        lines.push(`| Chunks skipped (<50 chars) | ${c.totalChunksSkipped} |`);
        lines.push("");
        lines.push("#### Per-file breakdown");
        lines.push("");
        lines.push("| File | Extracted | Embedded | Failed | Skipped | Status |");
        lines.push("|------|-----------|----------|--------|---------|--------|");
        for (const f of c.files) {
            const fStatus = f.status === "full" ? "✅" : f.status === "partial" ? "⚠️" : f.status === "empty" ? "❌" : "🔴";
            lines.push(`| ${f.filename} | ${f.chunksExtracted} | ${f.chunksEmbedded} | ${f.chunksFailed} | ${f.chunksSkipped} | ${fStatus} |`);
        }
        if (c.files.some(f => f.error)) {
            lines.push("");
            lines.push("**Errors:**");
            for (const f of c.files) {
                if (f.error) lines.push(`- \`${f.filename}\`: ${f.error}`);
            }
        }
        lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push("*Generated by `server/scripts/ingest-pdfs.ts`*");

    fs.writeFileSync(HISTORY_PATH, lines.join("\n"), "utf-8");
    console.log(`📄 History written: ${HISTORY_PATH}`);
}

async function main() {
    console.log("🚀 Starting Equra AI - PDF RAG Ingestion Pipeline");
    console.log(`📂 Source Directory: ${REPORTS_DIR}`);
    console.log(`💾 LanceDB Path: ${DB_PATH}`);
    
    if (!fs.existsSync(path.dirname(DB_PATH))) {
        fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    }

    const db = await lancedb.connect(DB_PATH);
    
    if (!fs.existsSync(REPORTS_DIR)) {
        console.error(`Source directory not found: ${REPORTS_DIR}`);
        process.exit(1);
    }

    const items = fs.readdirSync(REPORTS_DIR);
    const results: CompanyIngestionResult[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const itemPath = path.join(REPORTS_DIR, item);
        if (fs.statSync(itemPath).isDirectory()) {
            const result = await processCompany(item, db);
            if (result) results.push(result);
            if (i < items.length - 1) {
                console.log(`  Pausing 2s before next company...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    if (results.length > 0) {
        writeRagManifest(results);
        writeRagHistory(results);
    }
    
    console.log("\n🎉 ALL DONE! Vectors are stored locally in LanceDB.");
}

main().catch(console.error);
