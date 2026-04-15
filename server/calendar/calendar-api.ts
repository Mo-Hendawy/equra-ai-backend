// Fetches events from claps.therumble.app via The Events Calendar REST API.
// Pagination: API caps at 50 per page. Total ~354 events as of 2026-04.
import type { ClapsEvent, ClapsListResponse } from './calendar-types.js';

const BASE_URL = 'https://claps.therumble.app/wp-json/tribe/events/v1/events';
const PER_PAGE = 50;
const USER_AGENT = 'equra-ai/1.0';

/**
 * Fetch all events from the calendar (across all pages).
 * Filters to events in the past 30 days through the future to keep payload bounded.
 */
export async function fetchAllCalendarEvents(): Promise<ClapsEvent[]> {
  const startFloor = new Date();
  startFloor.setDate(startFloor.getDate() - 30);
  const startDateFilter = startFloor.toISOString().slice(0, 10);

  const all: ClapsEvent[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `${BASE_URL}?per_page=${PER_PAGE}&page=${page}&start_date=${startDateFilter}`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
      // 404 from Tribe API means "no events on this page" — normal at end of pagination
      if (res.status === 404) break;
      throw new Error(`claps API ${res.status} on page ${page}`);
    }
    const data = (await res.json()) as ClapsListResponse;
    all.push(...(data.events ?? []));
    totalPages = data.total_pages ?? 1;
    page += 1;
    if (page > 50) break; // hard safety cap
  }
  return all;
}

/**
 * Extract the EGX ticker from a tag like "COMI|Egy Dividends".
 * Returns null if no recognizable symbol is present.
 */
export function extractSymbol(event: ClapsEvent): string | null {
  for (const tag of event.tags ?? []) {
    const m = tag.name.match(/^([A-Z]{2,5})\|/);
    if (m) return m[1];
  }
  return null;
}
