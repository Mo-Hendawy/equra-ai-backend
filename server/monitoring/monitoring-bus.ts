// MON-03/04: Event-driven monitoring bus with priority and cooldown
import { EventEmitter } from 'node:events';
import { monitorLogger as log } from '../logger.js';

export type AlertType = 'PRICE_MOVE' | 'CBE_DECISION' | 'CBE_EMERGENCY' | 'EARNINGS' | 'SENTIMENT_SPIKE';

// MON-03: Priority ordering
export const AlertPriority: Record<AlertType, number> = {
  CBE_EMERGENCY: 1,
  EARNINGS: 2,
  SENTIMENT_SPIKE: 3,
  CBE_DECISION: 4,
  PRICE_MOVE: 5,
};

export interface AlertEvent {
  type: AlertType;
  symbol: string;
  detail: string;
  priority: number;
  timestamp: Date;
}

class MonitoringBus extends EventEmitter {
  // MON-04: 24-hour cooldown per symbol per alert type
  private cooldowns = new Map<string, Date>();
  private readonly COOLDOWN_MS = 24 * 60 * 60 * 1000;

  private getCooldownKey(symbol: string, type: AlertType): string {
    return `${symbol}:${type}`;
  }

  isOnCooldown(symbol: string, type: AlertType): boolean {
    const key = this.getCooldownKey(symbol, type);
    const lastFired = this.cooldowns.get(key);
    if (!lastFired) return false;
    return Date.now() - lastFired.getTime() < this.COOLDOWN_MS;
  }

  emitAlert(event: Omit<AlertEvent, 'priority' | 'timestamp'>): void {
    if (this.isOnCooldown(event.symbol, event.type)) {
      log.info({ symbol: event.symbol, type: event.type }, 'Alert suppressed — 24h cooldown active');
      return;
    }

    const fullEvent: AlertEvent = {
      ...event,
      priority: AlertPriority[event.type],
      timestamp: new Date(),
    };

    this.cooldowns.set(this.getCooldownKey(event.symbol, event.type), fullEvent.timestamp);
    log.info({ symbol: event.symbol, type: event.type, priority: fullEvent.priority }, `Alert emitted: ${event.detail}`);
    this.emit('alert', fullEvent);
  }
}

export const monitoringBus = new MonitoringBus();
