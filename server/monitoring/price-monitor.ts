// MON-01: Price alert monitor — polls EODHD every 15 minutes
import cron from 'node-cron';
import { monitoringBus } from './monitoring-bus.js';
import { monitorLogger as log } from '../logger.js';

// Symbols to monitor — configurable via env
function getWatchlistSymbols(): string[] {
  const envSymbols = process.env.WATCHLIST_SYMBOLS;
  if (envSymbols) return envSymbols.split(',').map(s => s.trim());
  // Default EGX blue chips
  return ['COMI', 'ETEL', 'EFID', 'SWDY', 'ABUK', 'HRHO', 'TMGH', 'EKHO'];
}

interface PriceSnapshot {
  price: number;
  volume: number;
  avgVolume30d: number;
  timestamp: Date;
}

// Track last known prices for change detection
const lastPrices = new Map<string, PriceSnapshot>();

async function fetchPriceAndVolume(symbol: string): Promise<PriceSnapshot | null> {
  const token = process.env.EODHD_API_TOKEN || '';
  if (!token) return null;

  try {
    const url = `https://eodhd.com/api/eod/${symbol}.EGX?api_token=${token}&fmt=json&period=d&order=d&from=${getDateNDaysAgo(35)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'equra-ai/1.0' } });
    if (!res.ok) return null;

    const data = await res.json() as Array<{ close: string; volume: string; date: string }>;
    if (!Array.isArray(data) || data.length < 2) return null;

    const latest = data[0]; // descending order
    const price = parseFloat(latest.close);
    const volume = parseInt(latest.volume) || 0;

    // 30-day average volume
    const volumes = data.slice(0, 30).map(d => parseInt(d.volume) || 0);
    const avgVolume30d = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    return { price, volume, avgVolume30d, timestamp: new Date() };
  } catch (e) {
    log.error({ symbol, err: e }, 'fetchPriceAndVolume failed');
    return null;
  }
}

function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function checkPriceAlerts(): Promise<void> {
  const symbols = getWatchlistSymbols();
  log.info({ count: symbols.length }, 'Price monitor: checking watchlist');

  for (const symbol of symbols) {
    try {
      const current = await fetchPriceAndVolume(symbol);
      if (!current || current.price <= 0) continue;

      const prev = lastPrices.get(symbol);
      lastPrices.set(symbol, current);

      if (!prev) continue; // first poll — no comparison possible

      const changePct = ((current.price - prev.price) / prev.price) * 100;

      // MON-01: >5% move required
      if (Math.abs(changePct) < 5) continue;

      // M2 pitfall: volume must be >50% of 30-day average (filter circuit breaker noise)
      if (current.volume < current.avgVolume30d * 0.5) {
        log.info({ symbol, changePct, volume: current.volume, avgVolume: current.avgVolume30d }, 'Price move ignored — thin volume');
        continue;
      }

      monitoringBus.emitAlert({
        type: 'PRICE_MOVE',
        symbol,
        detail: `${symbol} moved ${changePct.toFixed(1)}% (vol: ${current.volume}, avg: ${Math.round(current.avgVolume30d)})`,
      });
    } catch (e) {
      log.error({ symbol, err: e }, 'Price alert check failed');
    }
  }
}

export function startPriceMonitor(): void {
  // Poll every 15 minutes during EGX market hours (Sun-Thu 10:00-14:30 Cairo)
  cron.schedule('*/15 10-14 * * 0-4', async () => {
    await checkPriceAlerts();
  }, { timezone: 'Africa/Cairo', name: 'price-monitor' });

  log.info('Price monitor registered: every 15min during market hours (Sun-Thu 10:00-14:30 Cairo)');
}
