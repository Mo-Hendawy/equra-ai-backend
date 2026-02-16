import * as dotenv from "dotenv";
import * as path from "path";
import { setCache, getCached, getStaleCache } from "./api-cache";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const MANUS_API_KEY = process.env.MANUS_API_KEY || "";
const MANUS_BASE_URL = "https://api.manus.ai";

// We need the Railway public URL to register the webhook
const RAILWAY_PUBLIC_URL = process.env.RAILWAY_PUBLIC_URL || "";

// Use native fetch for Manus API, as it's not OpenAI-compatible endpoint-wise
async function manusApiFetch<T>(endpoint: string, method: string, data?: any): Promise<T> {
  const headers: Record<string, string> = {
    "API_KEY": MANUS_API_KEY,
    "Content-Type": "application/json",
  };

  const response = await fetch(`${MANUS_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Manus API Error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

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

const MANUS_TASK_CACHE_KEY = (symbol: string) => `manus_analysis_task_${symbol}`;
const MANUS_RESULT_CACHE_KEY = (symbol: string) => `manus_analysis_result_${symbol}`;

/**
 * Extract assistant-only text from a Manus task output array.
 * Manus output is: TaskMessage[] where each has role ("user"|"assistant")
 * and content: MessageContent[] with type ("output_text"|"output_file") and text.
 * We only want assistant output_text, NOT the user prompt.
 */
export function extractManusOutput(output: any): string {
  if (!output) return "";

  if (typeof output === "string") return output;

  if (!Array.isArray(output)) return JSON.stringify(output);

  // Filter for assistant messages only (skip user messages which contain the prompt)
  const assistantMessages = output.filter((msg: any) => msg.role === "assistant");

  // Extract text content from each assistant message
  const textParts: string[] = [];
  for (const msg of assistantMessages) {
    if (!msg.content || !Array.isArray(msg.content)) continue;
    for (const item of msg.content) {
      if (item.type === "output_text" && item.text) {
        textParts.push(item.text);
      }
    }
  }

  // If we got text from structured messages, return it
  if (textParts.length > 0) {
    return textParts.join("\n\n").trim();
  }

  // Fallback: try getting text from any content field (less strict)
  const fallbackParts: string[] = [];
  for (const msg of assistantMessages.length > 0 ? assistantMessages : output) {
    if (msg.content && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        const text = item.text || item.content;
        if (text && typeof text === "string") fallbackParts.push(text);
      }
    } else if (msg.text && typeof msg.text === "string") {
      fallbackParts.push(msg.text);
    }
  }

  return fallbackParts.join("\n\n").trim() || JSON.stringify(output);
}

/**
 * Parse structured fields (summary, recommendation, fair value) from a Manus report.
 */
export function parseManusReport(rawOutput: string, taskId: string): any {
  // Try multiple summary patterns
  const summaryPatterns = [
    /## (?:Executive )?Summary\n\n([\s\S]*?)(?:\n## |$)/i,
    /# (?:Executive )?Summary\n\n([\s\S]*?)(?:\n# |$)/i,
    /\*\*Summary\*\*[:\s]*([\s\S]*?)(?:\n## |\n# |\n\*\*|$)/i,
  ];
  let summary = "";
  for (const pat of summaryPatterns) {
    const match = rawOutput.match(pat);
    if (match) { summary = match[1].trim(); break; }
  }
  if (!summary) {
    // Use first ~500 chars as summary, cut at sentence boundary
    const truncated = rawOutput.substring(0, 600);
    const lastPeriod = truncated.lastIndexOf(".");
    summary = lastPeriod > 100 ? truncated.substring(0, lastPeriod + 1) : truncated + "...";
  }

  // Extract recommendation
  const recPatterns = [
    /(?:Investment |Overall )?Recommendation[:\s]*\*?\*?(Strong Buy|Buy|Hold|Sell|Strong Sell|Overweight|Underweight|Neutral|Accumulate)/i,
    /\*\*(?:Investment |Overall )?Recommendation[:\s]*\*?\*?\s*(Strong Buy|Buy|Hold|Sell|Strong Sell|Overweight|Underweight|Neutral|Accumulate)/i,
    /(?:we recommend|our recommendation is|rating:)\s*(Strong Buy|Buy|Hold|Sell|Strong Sell|Overweight|Underweight|Neutral|Accumulate)/i,
  ];
  let recommendation = "N/A";
  for (const pat of recPatterns) {
    const match = rawOutput.match(pat);
    if (match) { recommendation = match[1].trim(); break; }
  }

  // Extract fair value
  const fvPatterns = [
    /Fair Value(?:\s*Estimate)?[:\s]*(?:EGP\s*)?([\d.,]+)/i,
    /(?:Intrinsic|Target)\s*(?:Value|Price)[:\s]*(?:EGP\s*)?([\d.,]+)/i,
    /(?:EGP\s*)([\d.,]+)\s*(?:per share|\/share)/i,
  ];
  let fairValueEstimate: number | null = null;
  for (const pat of fvPatterns) {
    const match = rawOutput.match(pat);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ""));
      if (!isNaN(val) && val > 0) { fairValueEstimate = val; break; }
    }
  }

  return {
    status: "completed" as const,
    taskId,
    summary,
    detailedReport: rawOutput,
    recommendation,
    fairValueEstimate,
  };
}

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

  const webhookUrl = `${RAILWAY_PUBLIC_URL}/api/manus/webhook`;

  try {
    // Manus API does not have a /v1/webhooks GET endpoint for listing, based on previous testing.
    // We will attempt to create the webhook. If it already exists, Manus will return an error.
    await manusApiFetch("/v1/webhooks", "POST", {
      webhook: {
        url: webhookUrl,
        event_types: ["task.completed", "task.failed", "task.updated"],
      },
    });
    console.log(`Manus webhook registered: ${webhookUrl}`);
  } catch (error: any) {
    if (error.message.includes("webhook URL already exists")) {
      console.log(`Manus webhook already registered: ${webhookUrl}`);
    } else {
      console.error("Failed to register Manus webhook:", error);
    }
  }
}

export async function createManusAnalysis(symbol: string, stockData: ManusAnalysisRequest): Promise<{ taskId: string; taskUrl: string; } | null> {
  if (!MANUS_API_KEY) {
    console.error("Manus API key not configured. Cannot create task.");
    return null;
  }

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
    const response: any = await manusApiFetch("/v1/tasks", "POST", {
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
  // First check cache
  const cached = await getCached<{ taskId: string; status: string; taskUrl?: string; }>(MANUS_TASK_CACHE_KEY(symbol));

  // Also check stale cache in case the 24h cache expired but we still have the task info
  const staleOrCached = cached || await getStaleCache<{ taskId: string; status: string; taskUrl?: string; }>(MANUS_TASK_CACHE_KEY(symbol));

  if (!staleOrCached) return null;

  // If task is still pending/running, actively poll the Manus API for the real status
  if (staleOrCached.status === "pending" || staleOrCached.status === "running") {
    const liveStatus = await pollManusTaskFromAPI(symbol, staleOrCached.taskId, staleOrCached.taskUrl);
    if (liveStatus) return liveStatus;
  }

  return staleOrCached;
}

async function pollManusTaskFromAPI(symbol: string, taskId: string, taskUrl?: string): Promise<{ taskId: string; status: string; taskUrl?: string; } | null> {
  if (!MANUS_API_KEY || !taskId) return null;

  try {
    const response: any = await manusApiFetch(`/v1/tasks/${taskId}`, "GET");
    const status = response.status || response.task?.status;

    if (!status) return null;

    console.log(`Manus live poll for ${symbol} (${taskId}): status=${status}`);

    // Update our cache with the real status
    await setCache(MANUS_TASK_CACHE_KEY(symbol), { taskId, status, taskUrl, updatedAt: Date.now() });

    // If completed, extract assistant output and save
    if (status === "completed") {
      const output = response.output || response.task?.output;
      const rawOutput = extractManusOutput(output);

      if (rawOutput && rawOutput.length > 50) {
        const result = parseManusReport(rawOutput, taskId);
        await saveManusAnalysisResult(symbol, result);
        console.log(`Manus live poll: saved completed result for ${symbol} (${rawOutput.length} chars)`);
      } else {
        console.warn(`Manus live poll: task completed but output is empty/short for ${symbol}`);
      }
    }

    return { taskId, status, taskUrl };
  } catch (error: any) {
    console.error(`Manus live poll failed for ${symbol}:`, error.message);
    return null;
  }
}

export async function updateManusTaskStatus(symbol: string, status: string, taskId: string, taskUrl?: string) {
  await setCache(MANUS_TASK_CACHE_KEY(symbol), { taskId, status, taskUrl, updatedAt: Date.now() });
}

export async function saveManusAnalysisResult(symbol: string, result: ManusAnalysisResult) {
  await setCache(MANUS_RESULT_CACHE_KEY(symbol), result);
  await updateManusTaskStatus(symbol, "completed", result.taskId);
}
