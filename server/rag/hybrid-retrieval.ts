/**
 * Hybrid retrieval: vector search + query expansion + keyword re-ranking.
 * - Query expansion: multiple query variants for better recall
 * - Vector search: run for each variant, merge with RRF
 * - Keyword re-rank: score chunks by term overlap with query
 */

import type { RagTaskType } from "./query-expansion";
import { expandQuery } from "./query-expansion";

const RRF_K = 60; // Reciprocal Rank Fusion constant
const RETRIEVE_CANDIDATES = 20; // Fetch more for re-ranking
const FINAL_LIMIT = 6;

interface ChunkScore {
  text: string;
  rrfScore: number;
  keywordScore: number;
}

/**
 * Reciprocal Rank Fusion: merge ranked lists into a single score.
 * score(d) = sum over all lists of 1 / (k + rank(d))
 */
function reciprocalRankFusion(
  rankedLists: string[][]
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const list of rankedLists) {
    list.forEach((text, rank) => {
      const rrf = 1 / (RRF_K + rank + 1);
      scores.set(text, (scores.get(text) ?? 0) + rrf);
    });
  }

  return scores;
}

/**
 * Tokenize for simple keyword matching (lowercase, split on non-alphanumeric).
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by", "from", "as", "is", "was", "are", "were", "been", "be", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "can", "this", "that", "these", "those", "it", "its",
]);

/**
 * Score chunk by keyword overlap with query terms.
 */
function keywordOverlapScore(chunkText: string, query: string): number {
  const queryTerms = tokenize(query).filter((t) => !STOP_WORDS.has(t));
  const chunkTerms = new Set(tokenize(chunkText));
  if (queryTerms.length === 0) return 0;
  const matches = queryTerms.filter((t) => chunkTerms.has(t)).length;
  return matches / queryTerms.length;
}

/**
 * Merge and re-rank chunks from vector search results.
 */
export function mergeAndRerank(
  vectorResults: string[][],
  query: string,
  limit = FINAL_LIMIT
): string[] {
  const rrfScores = reciprocalRankFusion(vectorResults);
  const seen = new Set<string>();
  const combined: ChunkScore[] = [];

  for (const [text, rrf] of rrfScores) {
    if (seen.has(text)) continue;
    seen.add(text);
    const kwScore = keywordOverlapScore(text, query);
    combined.push({ text, rrfScore: rrf, keywordScore: kwScore });
  }

  // Combined score: RRF (0.7) + keyword overlap (0.3)
  const weightRrf = 0.7;
  const weightKw = 0.3;
  const maxRrf = Math.max(...combined.map((c) => c.rrfScore), 1e-6);

  combined.sort((a, b) => {
    const scoreA = weightRrf * (a.rrfScore / maxRrf) + weightKw * a.keywordScore;
    const scoreB = weightRrf * (b.rrfScore / maxRrf) + weightKw * b.keywordScore;
    return scoreB - scoreA;
  });

  return combined.slice(0, limit).map((c) => c.text);
}

/**
 * Get expanded queries for a symbol and task type.
 */
export function getExpandedQueries(symbol: string, taskType: RagTaskType): string[] {
  return expandQuery(symbol, taskType);
}
