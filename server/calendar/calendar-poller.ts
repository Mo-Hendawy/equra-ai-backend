// Polls claps.therumble.app, diffs against last snapshot, dispatches a
// smart-batched push notification, and persists the notification to history.
import { fetchAllCalendarEvents } from './calendar-api.js';
import { calendarService } from './calendar-service.js';
import { dispatchPush } from './push-dispatcher.js';
import type { ChangedEvent, NotificationBatch } from './calendar-types.js';

/**
 * Smart-batched copy:
 *   1 change       → "New: <title> — <date>"   (or "Updated: ...")
 *   2–4 changes    → "<n> new dividend events: SYM, SYM, SYM"
 *   5+ changes     → "<n> new + <m> updated dividend events posted"
 */
export function buildBatch(newEvents: ChangedEvent[], updatedEvents: ChangedEvent[]): NotificationBatch | null {
  const total = newEvents.length + updatedEvents.length;
  if (total === 0) return null;

  // Single-event headline
  if (total === 1) {
    const e = newEvents[0] ?? updatedEvents[0];
    const verb = e.type === 'new' ? 'New' : 'Updated';
    const date = e.start_date.slice(0, 10);
    return {
      title: 'Dividend Calendar',
      body: `${verb}: ${truncate(e.title, 80)} — ${date}`,
      newEvents,
      updatedEvents,
    };
  }

  // 2–4: list symbols (or first words of title if no symbol)
  if (total <= 4) {
    const labels = [...newEvents, ...updatedEvents]
      .map((e) => e.symbol ?? firstWord(e.title))
      .filter(Boolean)
      .slice(0, 4);
    const parts: string[] = [];
    if (newEvents.length) parts.push(`${newEvents.length} new`);
    if (updatedEvents.length) parts.push(`${updatedEvents.length} updated`);
    return {
      title: 'Dividend Calendar',
      body: `${parts.join(' + ')} dividend event${total === 1 ? '' : 's'}: ${labels.join(', ')}`,
      newEvents,
      updatedEvents,
    };
  }

  // 5+: count only
  const parts: string[] = [];
  if (newEvents.length) parts.push(`${newEvents.length} new`);
  if (updatedEvents.length) parts.push(`${updatedEvents.length} updated`);
  return {
    title: 'Dividend Calendar',
    body: `${parts.join(' + ')} dividend events posted`,
    newEvents,
    updatedEvents,
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function firstWord(s: string): string {
  return (s.split(/\s+/)[0] ?? '').slice(0, 12);
}

export interface PollResult {
  fetched: number;
  newCount: number;
  updatedCount: number;
  notificationId: number | null;
  recipientsCount: number;
}

export async function runCalendarPoll(): Promise<PollResult> {
  const started = Date.now();
  console.log('[calendar-poller] starting poll...');

  const events = await fetchAllCalendarEvents();
  console.log(`[calendar-poller] fetched ${events.length} events`);

  const { newEvents, updatedEvents } = calendarService.diffAndUpsert(events);
  console.log(`[calendar-poller] diff: ${newEvents.length} new, ${updatedEvents.length} updated`);

  const batch = buildBatch(newEvents, updatedEvents);
  if (!batch) {
    console.log(`[calendar-poller] no changes (${Date.now() - started}ms)`);
    return { fetched: events.length, newCount: 0, updatedCount: 0, notificationId: null, recipientsCount: 0 };
  }

  const dispatchRes = await dispatchPush({
    title: batch.title,
    body: batch.body,
    data: { route: 'DividendCalendar', tab: 'Notifications' },
  });

  const notificationId = calendarService.saveNotification({
    title: batch.title,
    body: batch.body,
    newEvents,
    updatedEvents,
    recipientsCount: dispatchRes.sent,
  });

  console.log(
    `[calendar-poller] notified ${dispatchRes.sent} devices (${dispatchRes.invalidTokens.length} pruned) in ${Date.now() - started}ms`
  );

  return {
    fetched: events.length,
    newCount: newEvents.length,
    updatedCount: updatedEvents.length,
    notificationId,
    recipientsCount: dispatchRes.sent,
  };
}
