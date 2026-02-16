import OpenAI from "openai";
import * as dotenv from "dotenv";
import * as path from "path";
import { setCache, getCached } from "./api-cache";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const MANUS_API_KEY = process.env.MANUS_API_KEY || "";
const MANUS_BASE_URL = "https://api.manus.ai";

// We need the Railway public URL to register the webhook
const RAILWAY_PUBLIC_URL = process.env.RAILWAY_PUBLIC_URL || "";

const getManusClient = () => {
  if (!MANUS_API_KEY) {
    console.error("Manus API key not configured");
    return null;
  }
  return new OpenAI({
    apiKey: MANUS_API_KEY,
    baseURL: MANUS_BASE_URL,
  });
};

export interface ManusAnalysisRequest {
  symbol: string;
  companyName: string;
  currentPrice: number;
  eps: number | null;
  peRatio: number | null;
  bookValue: number | null;
  dividendYield: number | null;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  historicalPrices: number[];
  priceChange30d: number | null;
  priceChange90d: number | null;
  priceSource?: string;
  fundamentalsSource?: string;
}

export interface ManusAnalysisResult {
  status: "pending" | "running" | "completed" | "failed";
  taskId: string;
  summary: string;
  detailedReport: string;
  recommendation: string;
  fairValueEstimate: number | null;
  // ... other structured data Manus might return
}

// Placeholder for caching Manus task status and results
const MANUS_TASK_CACHE_KEY = (symbol: string) => `manus_analysis_task_${symbol}`;
const MANUS_RESULT_CACHE_KEY = (symbol: string) => `manus_analysis_result_${symbol}`;

/**
 * Registers our webhook URL with Manus AI.
 * This should be called once on backend startup or when RAILWAY_PUBLIC_URL is known.
 */
export async function registerManusWebhook() {
  if (!RAILWAY_PUBLIC_URL) {
    console.warn("RAILWAY_PUBLIC_URL is not set. Cannot register Manus webhook.");
    return;
  }
  if (!MANUS_API_KEY) {
    console.warn("Manus API key not configured. Cannot register Manus webhook.");
    return;
  }

  const client = getManusClient();
  if (!client) return;

  const webhookUrl = `${RAILWAY_PUBLIC_URL}/api/manus/webhook`;

  try {
    // First, list existing webhooks to avoid duplicates
    const existingWebhooks = await client.webhooks.list(); // Assuming a list endpoint exists
    const webhookExists = existingWebhooks.data.some((wh: any) => wh.url === webhookUrl);

    if (!webhookExists) {
      await client.webhooks.create({
        url: webhookUrl,
        event_types: ["task.completed", "task.failed", "task.updated"], // Listen for relevant events
      });
      console.log(`Manus webhook registered: ${webhookUrl}`);
    } else {
      console.log(`Manus webhook already registered: ${webhookUrl}`);
    }
  } catch (error) {
    console.error("Failed to register Manus webhook:", error);
  }
}

export async function createManusAnalysis(symbol: string, stockData: ManusAnalysisRequest): Promise<{ taskId: string; taskUrl: string; } | null> {
  const client = getManusClient();
  if (!client) return null;

  const prompt = `Perform a deep dive investment analysis on the Egyptian Exchange (EGX) stock: ${stockData.companyName} (${symbol}).

Here is the current basic data:
${JSON.stringify(stockData, null, 2)}

Your analysis should cover:
1. Comprehensive company overview and business model.
2. In-depth financial health analysis (balance sheet, income statement, cash flow, debt).
3. Competitive landscape and industry positioning within the EGX.
4. Macroeconomic factors impacting the stock in Egypt.
5. Valuation using multiple advanced models (e.g., DCF, comparable companies, residual income) - if data is available.
6. Clear fair value estimate with a range, detailed entry/exit zones, and price targets.
7. Detailed risk assessment and potential red flags.
8. Actionable investment recommendation (Buy, Hold, Sell) with strong reasoning.
9. Provide sources for data used in analysis.

Output ONLY a well-structured markdown report, including key sections and a summary table for financial metrics and valuation results.
Ensure all numbers are clearly cited.`;

  try {
    const response = await client.tasks.create({
      prompt,
      agentProfile: "manus-1.6", // Use the most capable agent profile
      taskMode: "agent",        // Enable full autonomous agent capabilities
      createShareableLink: true, // Optionally create a shareable link
    });

    const taskId = response.task_id;
    const taskUrl = response.task_url || "";

    // Cache the task status as pending
    await setCache(MANUS_TASK_CACHE_KEY(symbol), { taskId, status: "pending", taskUrl, createdAt: Date.now() });

    console.log(`Manus analysis task created for ${symbol}: ${taskId}`);
    return { taskId, taskUrl };
  } catch (error) {
    console.error(`Failed to create Manus analysis task for ${symbol}:`, error);
    return null;
  }
}

export async function getManusAnalysisResult(symbol: string): Promise<ManusAnalysisResult | null> {
  return getCached<ManusAnalysisResult>(MANUS_RESULT_CACHE_KEY(symbol));
}

export async function getManusTaskStatus(symbol: string): Promise<{ taskId: string; status: string; taskUrl?: string; } | null> {
  return getCached<{ taskId: string; status: string; taskUrl?: string; }>(MANUS_TASK_CACHE_KEY(symbol));
}

export async function updateManusTaskStatus(symbol: string, status: string, taskId: string, taskUrl?: string) {
  await setCache(MANUS_TASK_CACHE_KEY(symbol), { taskId, status, taskUrl, updatedAt: Date.now() });
}

export async function saveManusAnalysisResult(symbol: string, result: ManusAnalysisResult) {
  await setCache(MANUS_RESULT_CACHE_KEY(symbol), result);
  await updateManusTaskStatus(symbol, "completed", result.taskId);
}
