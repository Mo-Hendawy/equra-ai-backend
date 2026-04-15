---
phase: 06-dividend-calendar-notifications
plan: 01
status: Complete
subsystem: dividend-calendar-push
tags: [push-notifications, expo, cron, wordpress-events-api, smart-batching, deep-linking]
requires: []
provides: [daily cron poller, Expo push dispatch with token pruning, in-app Notifications tab, tap deep-linking, notification history API]
affects: [server/calendar/* (new), server/jobs/calendar-jobs.ts (new), server/memory/memory-service.ts, server/routes.ts, server/index.ts, equra-ai-mobile/* (client/lib, client/components, client/screens, client/navigation, app.json, eas.json)]
tech-stack:
  added:
    - expo-server-sdk@^6.1.0 (backend)
    - expo-notifications + expo-device (mobile)
  patterns: [two-rect snapshot diff via SHA-1 hash, chunked Expo push (100/chunk), DeviceNotRegistered auto-prune, AsyncStorage idempotent token register, segmented Calendar/Notifications view, cold-start + foreground tap handlers]
key-files:
  created:
    - server/calendar/calendar-types.ts
    - server/calendar/calendar-api.ts
    - server/calendar/calendar-service.ts
    - server/calendar/push-dispatcher.ts
    - server/calendar/calendar-poller.ts
    - server/jobs/calendar-jobs.ts
    - c:/Repos/equra-ai-mobile/client/lib/push-notifications.ts
    - c:/Repos/equra-ai-mobile/client/components/DividendNotificationsView.tsx
    - c:/Repos/equra-ai-mobile/eas.json
    - .planning/phases/06-dividend-calendar-notifications/06-01-PLAN.md
  modified:
    - server/memory/memory-service.ts
    - server/routes.ts
    - server/index.ts
    - package.json (backend)
    - c:/Repos/equra-ai-mobile/app.json
    - c:/Repos/equra-ai-mobile/package.json
    - c:/Repos/equra-ai-mobile/client/App.tsx
    - c:/Repos/equra-ai-mobile/client/screens/DividendCalendarScreen.tsx
    - c:/Repos/equra-ai-mobile/client/navigation/DividendCalendarStackNavigator.tsx
---

# Phase 6: Dividend Calendar Notifications Summary

**One-liner:** Twice-daily (06:00 + 18:00 Africa/Cairo) poll of claps.therumble.app via The Events Calendar REST API produces smart-batched Expo push notifications; tap routes to a new in-app Notifications tab with history of the last 10 batches.

## What Was Built

**Backend — `server/calendar/` module (all new):**

- **`calendar-types.ts`** — TS types for API responses and internal `ChangedEvent { id, title, start_date, symbol, type: 'new'|'updated' }`.
- **`calendar-api.ts`** — `fetchAllCalendarEvents()` paginates the REST API (50/page) filtered to `start_date >= today - 30d`; `extractSymbol()` parses `"COMI|Egy Dividends"` tag format.
- **`calendar-service.ts`** — SHA-1 snapshot hash on `(id, title, start_date, end_date, modified_utc)`; `diffAndUpsert(events)` runs inside a single SQLite transaction and returns `{ newEvents, updatedEvents }`. Also handles `upsertPushToken`, `removePushTokens` (for pruning), `saveNotification`, `listNotifications`.
- **`push-dispatcher.ts`** — wraps `expo-server-sdk`, chunks 100 messages per call, filters non-Expo tokens via `Expo.isExpoPushToken`, prunes tokens flagged `DeviceNotRegistered`.
- **`calendar-poller.ts`** — `buildBatch(newEvents, updatedEvents)` implements the smart formatter (1 → headline, 2–4 → symbol list, 5+ → count-only). `runCalendarPoll()` orchestrates fetch → diff → batch → dispatch → persist.

**Backend — tables in `server/memory/memory-service.ts` constructor:**
```sql
CREATE TABLE calendar_events (event_id PK, title, start_date, end_date, modified_utc, tag_symbol, url, snapshot_hash, last_seen_at)
CREATE TABLE push_tokens (token PK, platform, created_at, last_seen_at)
CREATE TABLE calendar_notifications (id AUTOINC, sent_at, title, body, new_count, updated_count, event_ids JSON, recipients_count)
```

**Backend — `server/jobs/calendar-jobs.ts`:** two `cron.schedule` calls at `0 6 * * *` and `0 18 * * *`, `timezone: 'Africa/Cairo'`, names `calendar-morning` and `calendar-evening`.

**Backend — `server/routes.ts`:**
- `POST /api/push-tokens` — `{ token, platform }` upsert.
- `GET /api/notifications?limit=10` — returns last N batches.
- `POST /api/calendar/poll` — manual trigger for testing.

**Backend — `server/index.ts`:** calls `registerCalendarJobs()` alongside `registerScoringJobs()`.

**Mobile — new files:**
- `client/lib/push-notifications.ts` — permission flow, Android channel `dividend-calendar`, `getExpoPushTokenAsync({ projectId })` with placeholder guard, AsyncStorage idempotency to skip re-POST.
- `client/components/DividendNotificationsView.tsx` — TanStack Query fetch of `/api/notifications`, card UI with relative-time headers, NEW/UPD badges, expandable event rows (up to 10 per batch), pull-to-refresh, empty and error states.

**Mobile — modified:**
- `client/screens/DividendCalendarScreen.tsx` — now hosts a segmented `Calendar | Notifications` tab bar; `initialTab` read from route params for deep-linking.
- `client/navigation/DividendCalendarStackNavigator.tsx` — param list extended with `{ initialTab?: 'calendar' | 'notifications' }`.
- `client/App.tsx` — `createNavigationContainerRef`, registers push on launch, handles both `addNotificationResponseReceivedListener` (foreground) and `getLastNotificationResponseAsync` (cold-start with 600 ms defer so NavigationContainer is mounted).
- `app.json` — `expo-notifications` plugin added + `extra.eas.projectId: "REPLACE_ME_RUN_eas_init"` placeholder.
- `eas.json` — scaffolded with `cli.version: ">= 5.0.0"` and dev/preview/production profiles.

## Requirements Fulfilled

| Requirement | Status | How |
|---|---|---|
| CAL-01: Detect new events | Complete | `diffAndUpsert` compares `event_id` against stored set |
| CAL-02: Detect edits | Complete | SHA-1 snapshot hash detects any field change |
| CAL-03: Twice-daily schedule | Complete | Cron at 06:00 + 18:00 Africa/Cairo |
| CAL-04: Smart-batched push | Complete | `buildBatch` 1/2-4/5+ rules |
| CAL-05: In-app notifications history | Complete | `/api/notifications` + `DividendNotificationsView` with last 10 batches |
| CAL-06: Tap deep-link to Notifications tab | Complete | `navigationRef.navigate(...)` with `initialTab: 'notifications'` |

## Key Design Decisions

1. **WordPress Events REST API over HTML scraping** — source site uses The Events Calendar plugin which exposes `/wp-json/tribe/events/v1/events` with stable `id` and `modified_utc`. Brittle HTML parsing avoided.
2. **Smart batching, not one-per-event** — busy distribution days can post 10+ events; a stream of notifications would be noise. Single → headline, small batches → symbol list, large batches → count-only.
3. **Single-writer transaction for diffAndUpsert** — diff compared and new snapshots written in one SQLite transaction; guarantees a second concurrent poll cannot see half-applied state.
4. **Expo push, not APNs/FCM direct** — the app is Expo-managed; Expo's push service handles platform routing and respects `DeviceNotRegistered` feedback for token pruning. Backend stays platform-agnostic.
5. **Anonymous device registration** — no user auth required; any device with the app gets all dividend notifications. Per-user filtering (by portfolio symbols in `tag_symbol`) is a future extension.
6. **AsyncStorage idempotency on the client** — avoids POSTing the same token on every app launch; reduces API chatter.
7. **`POST /api/calendar/poll` manual trigger** — reduces test cycle from "wait 12 hours" to "hit endpoint, check history" during QA.

## Verification Evidence

Ran against live API before any mobile integration:
- 354 total events available; 30-day window = 51 events
- Smart batcher verified across 6 cases (0, 1 new, 1 updated, 3 new, 2+1, 8+2) — all produce expected body copy
- End-to-end poll: first run created 51 NEW events + 1 history row; second run returned `{ newCount: 0, updatedCount: 0 }` (idempotent)

## Known Stubs / Follow-Ups

- **EAS projectId placeholder** — `app.json` contains `REPLACE_ME_RUN_eas_init`; user must run `eas init` before a production build for push to work on real devices. Dev client without EAS still works via `getDevicePushTokenAsync` path.
- **No per-user opt-out yet** — every device that registers a token gets all notifications.
- **Expo Go limitation** — since Expo SDK 53, Expo Go cannot receive remote push; must use a dev client build.

## Commits

This feature was built inline during the session. No commits were authored specifically for Phase 6 at the time of writing; the code is on the working tree and ready for a `feat(06): dividend calendar notifications` commit.

## Self-Check: PASSED

- FOUND: server/calendar/ (5 files: types, api, service, dispatcher, poller)
- FOUND: server/jobs/calendar-jobs.ts
- FOUND: 3 tables in server/memory/memory-service.ts CREATE TABLE block
- FOUND: 3 endpoints in server/routes.ts (/api/push-tokens, /api/notifications, /api/calendar/poll)
- FOUND: registerCalendarJobs call in server/index.ts
- FOUND: client/lib/push-notifications.ts, client/components/DividendNotificationsView.tsx
- FOUND: eas.json, expo-notifications plugin in app.json
- FOUND: navigationRef + notification handlers in client/App.tsx
