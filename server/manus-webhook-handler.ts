import { Request, Response } from "express";
import { saveManusAnalysisResult, updateManusTaskStatus } from "./manus-service";

// Placeholder for extracting symbol from task ID or metadata
function extractSymbolFromTask(task: any): string | null {
  // Assuming task_id format or metadata will contain the symbol
  // For now, let's assume the prompt contains the symbol
  const prompt = task.instructions || "";
  const match = prompt.match(/\((\w+)\)/); // Extract symbol from (SYMBOL)
  return match ? match[1] : null;
}

export async function manusWebhookHandler(req: Request, res: Response) {
  const event = req.body;
  console.log("Received Manus webhook event:", event.event_type, event.task_id);

  if (!event.task_id || !event.event_type || !event.task) {
    return res.status(400).send("Missing task_id, event_type, or task in webhook payload");
  }

  const { task_id, event_type, task } = event;
  const symbol = extractSymbolFromTask(task);

  if (!symbol) {
    console.error(`Could not extract symbol from Manus task ${task_id}. Skipping.`);
    return res.status(400).send("Could not extract symbol from task");
  }

  try {
    if (event_type === "task.completed") {
      // Extract the relevant output from the task object
      const rawOutput = task.output?.map((msg: any) => msg.content?.[0]?.text || "").join("\n").trim();

      // Basic attempt to parse structured data from markdown. Manus should ideally return structured JSON.
      // For now, we'll store the full markdown report and try to extract a summary.
      const summaryMatch = rawOutput.match(/## Summary\n\n([\s\S]*?)(?:\n##|$)/);
      const summary = summaryMatch ? summaryMatch[1].trim() : rawOutput.substring(0, 200) + "...";

      // Attempt to extract recommendation and fair value (will need more robust parsing later)
      const recommendationMatch = rawOutput.match(/Recommendation:\s*([\w\s]+)/i);
      const fairValueMatch = rawOutput.match(/Fair Value Estimate:\s*([\d.,]+)\s*EGP/i);
      
      const result = {
        status: "completed",
        taskId: task_id,
        summary,
        detailedReport: rawOutput,
        recommendation: recommendationMatch ? recommendationMatch[1].trim() : "N/A",
        fairValueEstimate: fairValueMatch ? parseFloat(fairValueMatch[1].replace(/,/g, '')) : null,
      };
      await saveManusAnalysisResult(symbol, result);
      console.log(`Manus task ${task_id} for ${symbol} completed. Result saved.`);

    } else if (event_type === "task.failed") {
      await updateManusTaskStatus(symbol, "failed", task_id);
      console.warn(`Manus task ${task_id} for ${symbol} failed. Status updated.`);
    } else if (event_type === "task.updated") {
      await updateManusTaskStatus(symbol, task.status, task_id);
      console.log(`Manus task ${task_id} for ${symbol} updated to status: ${task.status}.`);
    }

    res.status(200).send("Webhook received and processed");
  } catch (error) {
    console.error(`Error processing Manus webhook for task ${task_id}:`, error);
    res.status(500).send("Internal server error");
  }
}
