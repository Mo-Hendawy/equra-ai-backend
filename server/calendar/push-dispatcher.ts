// Wraps the Expo push API. Sends notifications to all registered tokens
// in chunks (Expo enforces 100 messages per request), then prunes any
// tokens that Expo reports as DeviceNotRegistered.
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import { calendarService } from './calendar-service.js';

const expo = new Expo();

export interface DispatchResult {
  sent: number;
  invalidTokens: string[];
}

export async function dispatchPush(args: {
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<DispatchResult> {
  const tokens = calendarService.listPushTokens();
  if (tokens.length === 0) return { sent: 0, invalidTokens: [] };

  const messages: ExpoPushMessage[] = tokens
    .filter((t) => Expo.isExpoPushToken(t.token))
    .map((t) => ({
      to: t.token,
      sound: 'default',
      title: args.title,
      body: args.body,
      data: args.data,
      channelId: 'dividend-calendar',
    }));

  const tickets: ExpoPushTicket[] = [];
  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error('[push-dispatcher] chunk failed:', err);
    }
  }

  const invalidTokens: string[] = [];
  tickets.forEach((ticket, idx) => {
    if (ticket.status === 'error') {
      const errMsg = ticket.message;
      if (ticket.details?.error === 'DeviceNotRegistered') {
        const msg = messages[idx];
        if (msg && typeof msg.to === 'string') invalidTokens.push(msg.to);
      } else {
        console.warn(`[push-dispatcher] ticket error: ${errMsg}`);
      }
    }
  });

  if (invalidTokens.length) calendarService.removePushTokens(invalidTokens);

  return { sent: messages.length - invalidTokens.length, invalidTokens };
}
