// Cron registration for the dividend calendar poller.
// Runs at 06:00 and 18:00 Africa/Cairo every day.
import cron from 'node-cron';
import { runCalendarPoll } from '../calendar/calendar-poller.js';

export function registerCalendarJobs(): void {
  cron.schedule(
    '0 6 * * *',
    async () => {
      try {
        await runCalendarPoll();
      } catch (e) {
        console.error('[calendar-jobs] morning poll failed:', e);
      }
    },
    { timezone: 'Africa/Cairo', name: 'calendar-morning' }
  );

  cron.schedule(
    '0 18 * * *',
    async () => {
      try {
        await runCalendarPoll();
      } catch (e) {
        console.error('[calendar-jobs] evening poll failed:', e);
      }
    },
    { timezone: 'Africa/Cairo', name: 'calendar-evening' }
  );

  console.log('[calendar-jobs] registered: 06:00 + 18:00 Africa/Cairo');
}
