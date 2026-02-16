import { Request, Response } from "express";
import { saveManusAnalysisResult, updateManusTaskStatus, extractManusOutput, parseManusReport } from "./manus-service";

function extractSymbolFromTask(task: any): string | null {
  // Try metadata first, then instructions/prompt
  const prompt = task.instructions || task.prompt || "";
  // Match (SYMBOL) pattern - e.g. "Telecom Egypt (ETEL)"
  const match = prompt.match(/\(([A-Z]{3,5})\)/);
  if (match) return match[1];

  // Try extracting from output messages (assistant might mention it)
  if (task.output && Array.isArray(task.output)) {
    for (const msg of task.output) {
      if (msg.role === "user" && msg.content) {
        const text = Array.isArray(msg.content) ? msg.content[0]?.text || "" : msg.content;
        const m = text.match(/\(([A-Z]{3,5})\)/);
        if (m) return m[1];
      }
    }
  }

  return null;
}

export async function manusWebhookHandler(req: Request, res: Response) {
  const event = req.body;
  console.log("Received Manus webhook event:", JSON.stringify(event).substring(0, 500));

  const task_id = event.task_id || event.id;
  const event_type = event.event_type || event.type;
  const task = event.task || event;

  if (!task_id || !event_type) {
    return res.status(400).send("Missing task_id or event_type in webhook payload");
  }

  const symbol = extractSymbolFromTask(task);

  if (!symbol) {
    console.error(`Could not extract symbol from Manus task ${task_id}. Payload keys: ${Object.keys(task).join(", ")}`);
    return res.status(400).send("Could not extract symbol from task");
  }

  try {
    if (event_type === "task.completed") {
      const output = task.output;
      const rawOutput = extractManusOutput(output);

      if (rawOutput && rawOutput.length > 50) {
        const result = parseManusReport(rawOutput, task_id);
        await saveManusAnalysisResult(symbol, result);
        console.log(`Manus webhook: task ${task_id} for ${symbol} completed. Saved ${rawOutput.length} chars.`);
      } else {
        console.warn(`Manus webhook: task ${task_id} for ${symbol} completed but output is empty/short.`);
        await updateManusTaskStatus(symbol, "completed", task_id);
      }

    } else if (event_type === "task.failed") {
      await updateManusTaskStatus(symbol, "failed", task_id);
      console.warn(`Manus webhook: task ${task_id} for ${symbol} failed.`);
    } else if (event_type === "task.updated") {
      const newStatus = task.status || "running";
      await updateManusTaskStatus(symbol, newStatus, task_id);
      console.log(`Manus webhook: task ${task_id} for ${symbol} updated to: ${newStatus}`);
    }

    res.status(200).send("Webhook received and processed");
  } catch (error) {
    console.error(`Error processing Manus webhook for task ${task_id}:`, error);
    res.status(500).send("Internal server error");
  }
}
