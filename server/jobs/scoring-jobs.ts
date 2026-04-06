// server/jobs/scoring-jobs.ts
import cron from 'node-cron';
import { memoryService } from '../memory/memory-service.js';

// MEM-02: "last Friday of month" guard for 90-day window
function isLastFridayOfMonth(date: Date): boolean {
  const nextWeek = new Date(date);
  nextWeek.setDate(date.getDate() + 7);
  return nextWeek.getMonth() !== date.getMonth();
}

// LEARN-01: Fetch current price from EODHD for backtest scoring
async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  const token = process.env.EODHD_API_TOKEN || '';
  if (!token) {
    console.warn('[scoring-jobs] EODHD_API_TOKEN not set — cannot fetch price');
    return null;
  }
  try {
    const url = `https://eodhd.com/api/eod/${symbol}.EGX?api_token=${token}&fmt=json&period=d&order=d`;
    const res = await fetch(url, { headers: { 'User-Agent': 'equra-ai/1.0' } });
    if (!res.ok) {
      console.warn(`[scoring-jobs] EODHD ${symbol} HTTP ${res.status}`);
      return null;
    }
    const data = await res.json() as Array<{ close: string; date: string }>;
    if (!Array.isArray(data) || data.length === 0) return null;
    const isDescending = data.length > 1 && new Date(data[0].date) > new Date(data[1].date);
    const latest = isDescending ? data[0] : data[data.length - 1];
    const price = latest.close ? parseFloat(latest.close) : NaN;
    return isNaN(price) || price <= 0 ? null : price;
  } catch (e) {
    console.error(`[scoring-jobs] fetchCurrentPrice error for ${symbol}:`, e);
    return null;
  }
}

async function scoreOutcomeWindow(window: '5d' | '30d' | '90d'): Promise<void> {
  console.log(`[scoring-jobs] Running ${window} outcome scoring...`);
  try {
    const pending = await memoryService.getDecisionsPendingOutcome(window);
    console.log(`[scoring-jobs] ${pending.length} decisions pending ${window} scoring`);

    for (const decision of pending) {
      try {
        // Pitfall M3: never delete delisted — just log and skip if price unavailable
        if (!decision.priceAtRec) {
          console.log(`[scoring-jobs] Skipping ${decision.symbol} (${decision.id}) — no priceAtRec recorded`);
          continue;
        }
        const currentPrice = await fetchCurrentPrice(decision.symbol);
        if (currentPrice === null) {
          console.log(`[scoring-jobs] Could not fetch price for ${decision.symbol} — skipping (may be delisted or API unavailable)`);
          continue;
        }
        const outcomePercent = ((currentPrice - decision.priceAtRec) / decision.priceAtRec) * 100;
        await memoryService.scoreOutcome(decision.id, window, outcomePercent);
        console.log(`[scoring-jobs] Scored ${decision.symbol} (${decision.id}) ${window}: ${outcomePercent.toFixed(2)}%`);
        // AUTO-04: auto-generate episode for bad outcomes (pitfall C1 filter inside method)
        await memoryService.autoEpisodeFromOutcome(decision, window, outcomePercent);
      } catch (e) {
        console.error(`[scoring-jobs] Error scoring decision ${decision.id}:`, e);
        // continue to next — one failure must not abort the run
      }
    }
  } catch (e) {
    console.error(`[scoring-jobs] Error during ${window} scoring:`, e);
  }
}

export function registerScoringJobs(): void {
  // MEM-02: 5-day scoring — daily at 15:30 Cairo (after EGX close at 14:30)
  cron.schedule('30 15 * * *', async () => {
    await scoreOutcomeWindow('5d');
  }, { timezone: 'Africa/Cairo', name: 'score-5d' });

  // MEM-02: 30-day scoring — every Friday at 16:00 Cairo
  cron.schedule('0 16 * * 5', async () => {
    await scoreOutcomeWindow('30d');
  }, { timezone: 'Africa/Cairo', name: 'score-30d' });

  // MEM-02: 90-day scoring — last Friday of the month at 16:00 Cairo
  // node-cron v4 does not support "last Friday" natively — gate with isLastFridayOfMonth()
  cron.schedule('0 16 * * 5', async () => {
    if (isLastFridayOfMonth(new Date())) {
      await scoreOutcomeWindow('90d');
    }
  }, { timezone: 'Africa/Cairo', name: 'score-90d' });

  console.log('[scoring-jobs] Registered: score-5d (daily 15:30 Cairo), score-30d (Fri 16:00 Cairo), score-90d (last Fri 16:00 Cairo)');
}
