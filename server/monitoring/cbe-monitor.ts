// MON-02: CBE rate decision detector
import cron from 'node-cron';
import { monitoringBus } from './monitoring-bus.js';
import { monitorLogger as log } from '../logger.js';

// Bank stocks affected by CBE rate decisions
const BANK_STOCKS = ['COMI', 'CIEB', 'QNBA', 'ADIB', 'FBAL', 'ASGR'];

// CBE-related keywords in news headlines
const CBE_KEYWORDS = ['central bank', 'CBE', 'interest rate', 'monetary policy', 'rate cut', 'rate hike', 'rate decision'];
const CBE_EMERGENCY_KEYWORDS = ['emergency meeting', 'unscheduled meeting', 'extraordinary session'];

async function checkCbeNews(): Promise<void> {
  const token = process.env.EODHD_API_TOKEN || '';
  if (!token) return;

  try {
    // Check EGX-wide news for CBE mentions
    const url = `https://eodhd.com/api/news?s=COMI.EGX&api_token=${token}&fmt=json&limit=10`;
    const res = await fetch(url, { headers: { 'User-Agent': 'equra-ai/1.0' } });
    if (!res.ok) return;

    const articles = await res.json() as Array<{ title: string; date: string }>;
    if (!Array.isArray(articles)) return;

    // Only check articles from the last 24 hours
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const article of articles) {
      const articleDate = new Date(article.date).getTime();
      if (articleDate < oneDayAgo) continue;

      const titleLower = article.title.toLowerCase();

      // Check for emergency CBE keywords first (higher priority)
      const isEmergency = CBE_EMERGENCY_KEYWORDS.some(kw => titleLower.includes(kw));
      if (isEmergency) {
        for (const symbol of BANK_STOCKS) {
          monitoringBus.emitAlert({
            type: 'CBE_EMERGENCY',
            symbol,
            detail: `CBE emergency detected: "${article.title}"`,
          });
        }
        continue;
      }

      // Check for regular CBE keywords
      const isCbe = CBE_KEYWORDS.some(kw => titleLower.includes(kw));
      if (isCbe) {
        for (const symbol of BANK_STOCKS) {
          monitoringBus.emitAlert({
            type: 'CBE_DECISION',
            symbol,
            detail: `CBE news detected: "${article.title}"`,
          });
        }
      }
    }
  } catch (e) {
    log.error({ err: e }, 'CBE news check failed');
  }
}

export function startCbeMonitor(): void {
  // Check every hour during business hours (Sun-Thu 8:00-17:00 Cairo)
  cron.schedule('0 8-17 * * 0-4', async () => {
    await checkCbeNews();
  }, { timezone: 'Africa/Cairo', name: 'cbe-monitor' });

  log.info('CBE monitor registered: hourly during business hours (Sun-Thu 8:00-17:00 Cairo)');
}
