/**
 * Query expansion for RAG - generates multiple query variants to improve recall.
 */

export type RagTaskType = "stock" | "portfolio" | "compare" | "deploy";

/**
 * Expand a base query into multiple variants for better retrieval coverage.
 */
export function expandQuery(symbol: string, taskType: RagTaskType): string[] {
  const base = `${symbol} financial performance revenue profit earnings valuation`;
  const variants: string[] = [base];

  switch (taskType) {
    case "stock":
      variants.push(
        `${symbol} valuation fair value P/E earnings growth dividend`,
        `${symbol} quarterly annual report revenue margin net income`,
        `${symbol} balance sheet assets liabilities equity cash flow`
      );
      break;
    case "portfolio":
    case "compare":
    case "deploy":
      variants.push(
        `${symbol} earnings growth revenue profit margin`,
        `${symbol} dividend yield payout ratio`
      );
      break;
  }

  return [...new Set(variants)];
}
