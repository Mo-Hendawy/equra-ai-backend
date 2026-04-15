// Types for the dividend calendar feature.
// Source: https://claps.therumble.app — The Events Calendar (WordPress) REST API.

export interface ClapsTag {
  name: string;
  slug: string;
}

export interface ClapsEvent {
  id: number;
  title: string;
  url: string;
  start_date: string;        // "2026-04-15 00:00:00"
  end_date: string;
  modified_utc: string;      // "2026-03-26 14:33:22"
  tags: ClapsTag[];
}

export interface ClapsListResponse {
  events: ClapsEvent[];
  total: number;
  total_pages: number;
}

export type ChangeType = 'new' | 'updated';

export interface ChangedEvent {
  id: number;
  title: string;
  start_date: string;
  symbol: string | null;     // extracted from tag like "COMI|Egy Dividends"
  type: ChangeType;
}

export interface NotificationBatch {
  title: string;
  body: string;
  newEvents: ChangedEvent[];
  updatedEvents: ChangedEvent[];
}

export interface PushToken {
  token: string;
  platform: 'ios' | 'android' | 'web';
}

export interface NotificationHistoryItem {
  id: number;
  sent_at: number;
  title: string;
  body: string;
  new_count: number;
  updated_count: number;
  events: ChangedEvent[];
}
