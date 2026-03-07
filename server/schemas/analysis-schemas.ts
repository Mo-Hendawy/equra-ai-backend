import { z } from "zod";

// ─── Shared ───

const zoneSchema = z.object({
  min: z.number(),
  max: z.number(),
});

const fairValueRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
});

// ─── Stock Analysis (GeminiAnalysis) ───
// Use transforms to accept LLM variations (e.g. "undervalued", "Slightly Undervalued")

const recommendationSchema = z.string().transform((s) => {
  const v = (s || "").toLowerCase();
  if (v.includes("strong") && v.includes("buy")) return "Strong Buy";
  if (v.includes("strong") && v.includes("sell")) return "Strong Sell";
  if (v === "buy") return "Buy";
  if (v === "sell") return "Sell";
  if (v === "hold") return "Hold";
  return "Hold";
});

const confidenceSchema = z.string().transform((s) => {
  const v = (s || "").toLowerCase();
  if (v.includes("high")) return "High";
  if (v.includes("low")) return "Low";
  return "Medium";
});

const riskLevelSchema = z.string().transform((s) => {
  const v = (s || "").toLowerCase();
  if (v.includes("high")) return "High";
  if (v.includes("low")) return "Low";
  return "Medium";
});

const valuationStatusSchema = z.string().transform((s) => {
  const v = (s || "").toLowerCase();
  if (v.includes("under")) return "Undervalued";
  if (v.includes("over")) return "Overvalued";
  return "Fair";
});

export const geminiAnalysisSchema = z.object({
  fairValueEstimate: z.number().nullable(),
  fairValueRange: fairValueRangeSchema.nullable(),
  strongBuyZone: zoneSchema.nullable(),
  buyZone: zoneSchema.nullable(),
  holdZone: zoneSchema.nullable(),
  sellZone: zoneSchema.nullable(),
  strongSellZone: zoneSchema.nullable(),
  firstTarget: z.number().nullable(),
  secondTarget: z.number().nullable(),
  thirdTarget: z.number().nullable(),
  recommendation: recommendationSchema,
  confidence: confidenceSchema,
  reasoning: z.string().min(1),
  reasoningSteps: z.union([z.array(z.string()), z.undefined()]).transform((a) => a ?? []),
  riskLevel: riskLevelSchema,
  keyPoints: z.union([z.array(z.string()), z.undefined()]).transform((a) => a ?? []),
  analysisMethod: z.string().default(""),
  valuationStatus: valuationStatusSchema,
  simpleExplanation: z.union([z.array(z.string()), z.undefined()]).transform((a) => a ?? []),
  riskSignals: z.union([z.array(z.string()), z.undefined()]).transform((a) => a ?? []),
});

export type GeminiAnalysisValidated = z.infer<typeof geminiAnalysisSchema>;

// ─── Portfolio Analysis ───

const overallHealthSchema = z.enum(["Strong", "Good", "Fair", "Weak"]);

const diversificationScoreSchema = z.enum([
  "Well Diversified",
  "Moderately Diversified",
  "Concentrated",
]);

export const portfolioAnalysisResultSchema = z.object({
  overallHealth: overallHealthSchema,
  summary: z.string().min(1),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  recommendations: z.array(z.string()),
  diversificationScore: diversificationScoreSchema,
  riskLevel: riskLevelSchema,
  sectorBreakdown: z.string(),
  topPerformers: z.array(z.string()),
  underperformers: z.array(z.string()),
  reasoningSteps: z.union([z.array(z.string()), z.undefined()]).transform((a) => a ?? []),
});

export type PortfolioAnalysisResultValidated = z.infer<
  typeof portfolioAnalysisResultSchema
>;

// ─── Deploy Capital ───

const allocationSchema = z.object({
  symbol: z.string(),
  nameEn: z.string(),
  amountEGP: z.number(),
  percentage: z.number(),
  reason: z.string(),
  isNewPosition: z.boolean(),
  buyZone: z
    .object({ low: z.number(), high: z.number() })
    .optional()
    .nullable(),
});

export const deployCapitalResultSchema = z.object({
  strategy: z.string().min(1),
  allocations: z.array(allocationSchema),
  reasoning: z.string().min(1),
  reasoningSteps: z.union([z.array(z.string()), z.undefined()]).transform((a) => a ?? []),
  riskNote: z.string(),
});

export type DeployCapitalResultValidated = z.infer<
  typeof deployCapitalResultSchema
>;

// ─── Compare Stocks ───

const actionSchema = z.enum([
  "buy_one",
  "split",
  "existing_stock",
  "dry_powder",
  "mixed",
]);

const buyUrgencySchema = z.enum(["Buy Now", "Can Wait", "Avoid"]);

const rankingSchema = z.object({
  symbol: z.string(),
  nameEn: z.string(),
  growthScore: z.number(),
  longTermScore: z.number(),
  buyUrgency: buyUrgencySchema,
  summary: z.string(),
});

const compareAllocationSchema = z.object({
  symbol: z.string(),
  nameEn: z.string(),
  amountEGP: z.number(),
  percentage: z.number(),
  isFromCompared: z.boolean(),
});

export const compareStocksResultSchema = z.object({
  verdict: z.string().min(1),
  action: actionSchema,
  rankings: z.array(rankingSchema),
  allocation: z.array(compareAllocationSchema).optional(),
  reasoning: z.string().min(1),
  reasoningSteps: z.union([z.array(z.string()), z.undefined()]).transform((a) => a ?? []),
  riskNote: z.string(),
});

export type CompareStocksResultValidated = z.infer<
  typeof compareStocksResultSchema
>;

// ─── Validation helpers ───

export type SchemaType =
  | "stock"
  | "portfolio"
  | "deploy"
  | "compare";

const schemas: Record<SchemaType, z.ZodTypeAny> = {
  stock: geminiAnalysisSchema,
  portfolio: portfolioAnalysisResultSchema,
  deploy: deployCapitalResultSchema,
  compare: compareStocksResultSchema,
};

export interface ValidationResult<T> {
  success: true;
  data: T;
}

export interface ValidationError {
  success: false;
  errors: string[];
  raw: unknown;
}

export function validateAnalysis<T>(
  type: SchemaType,
  raw: unknown
): ValidationResult<T> | ValidationError {
  const schema = schemas[type];

  const result = schema.safeParse(raw);

  if (result.success) {
    return { success: true, data: result.data as T };
  }

  const errs = result.error?.errors;
  const errors = Array.isArray(errs)
    ? errs.map((e: any) => `${(e.path || []).join(".")}: ${e.message}`)
    : [String(result.error)];

  return {
    success: false,
    errors,
    raw,
  };
}

export function logValidationFailure(
  type: SchemaType,
  context: string,
  error: ValidationError
): void {
  console.error(
    `[Schema validation failed] type=${type} context=${context}`,
    error.errors
  );
  if (process.env.NODE_ENV === "development") {
    console.error("Raw response:", JSON.stringify(error.raw, null, 2).slice(0, 500));
  }
}
