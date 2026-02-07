import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

export interface ExtractedTransaction {
  type: "buy" | "sell";
  shares: number;
  price: number;
  date: string;
  time: string;
  status: "Fulfilled" | "Cancelled";
}

export async function extractTransactionsFromImage(imageBase64: string): Promise<ExtractedTransaction[]> {
  if (!genAI || !GEMINI_API_KEY) {
    throw new Error("Gemini API key not configured");
  }

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-lite",
    });

    const prompt = `You are analyzing a screenshot of stock trading transactions. Extract ALL transactions visible in the image.

For each transaction, extract:
- Type: "buy" or "sell"
- Number of shares
- Price per share (in EGP)
- Date (format: DD MMM YY, e.g., "08 Jan 26")
- Time (format: HH:MM AM/PM, e.g., "02:21PM")
- Status: "Fulfilled" or "Cancelled"

IMPORTANT:
- Only extract FULFILLED transactions (ignore Cancelled ones)
- Extract the exact numbers as shown
- Prices are in EGP (Egyptian Pounds)
- Format: "Buy • 113 shares @ EGP 98.460 Fulfilled"

Return ONLY a JSON array with this exact structure:
[
  {
    "type": "buy",
    "shares": 113,
    "price": 98.46,
    "date": "05 Jan 26",
    "time": "01:45PM",
    "status": "Fulfilled"
  }
]

Extract ALL visible fulfilled transactions. Return empty array [] if no fulfilled transactions found.
Respond ONLY with valid JSON array, no markdown formatting.`;

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: "image/png",
      },
    };

    console.log("Requesting Gemini Vision analysis...");
    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    const text = response.text();

    // Parse JSON response
    let cleanedText = text.trim();
    if (cleanedText.startsWith('```json')) {
      cleanedText = cleanedText.substring(7);
    } else if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.substring(3);
    }
    if (cleanedText.endsWith('```')) {
      cleanedText = cleanedText.substring(0, cleanedText.length - 3);
    }
    cleanedText = cleanedText.trim();

    const transactions: ExtractedTransaction[] = JSON.parse(cleanedText);
    
    console.log(`Extracted ${transactions.length} transactions from image`);
    return transactions;

  } catch (error) {
    console.error("Vision analysis error:", error);
    throw new Error("Failed to extract transactions from image");
  }
}
