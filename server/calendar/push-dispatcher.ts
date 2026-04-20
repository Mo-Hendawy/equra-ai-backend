// Sends push notifications via Firebase Cloud Messaging (Android) directly.
// No Expo cloud dependency — works with release APKs built via the native
// Android toolchain. Tokens stored in the push_tokens table are raw FCM tokens.
//
// Requires env var FIREBASE_SERVICE_ACCOUNT_JSON containing the JSON content
// of a Firebase service account key (Project Settings → Service Accounts →
// Generate new private key).
import admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { calendarService } from './calendar-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolves to server/firebase-service-account.json relative to this file.
const SA_FILE_PATH = path.join(__dirname, '..', 'firebase-service-account.json');

let initialized = false;
let initError: string | null = null;

function ensureInit(): boolean {
  if (initialized) return true;
  if (initError) return false;
  // Prefer env var if set (so secrets can eventually move off git); else file.
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    try {
      raw = fs.readFileSync(SA_FILE_PATH, 'utf-8');
    } catch {
      initError = `No service account: set FIREBASE_SERVICE_ACCOUNT_JSON or drop file at ${SA_FILE_PATH}`;
      console.warn(`[push-dispatcher] ${initError} — push disabled`);
      return false;
    }
  }
  try {
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    });
    initialized = true;
    console.log('[push-dispatcher] Firebase Admin initialized');
    return true;
  } catch (e) {
    initError = `Invalid Firebase service account JSON: ${(e as Error).message}`;
    console.error(`[push-dispatcher] ${initError}`);
    return false;
  }
}

export interface DispatchResult {
  sent: number;
  invalidTokens: string[];
}

/**
 * Send an FCM push to every registered token. Invalid tokens (device
 * uninstalled, re-registered, revoked) are automatically pruned from
 * the push_tokens table.
 */
export async function dispatchPush(args: {
  title: string;
  body: string;
  data: Record<string, unknown>;
}): Promise<DispatchResult> {
  if (!ensureInit()) return { sent: 0, invalidTokens: [] };

  const tokens = calendarService.listPushTokens();
  if (tokens.length === 0) return { sent: 0, invalidTokens: [] };

  // FCM data payload must be string-valued
  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(args.data)) {
    stringData[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }

  const messages: admin.messaging.Message[] = tokens.map((t) => ({
    token: t.token,
    notification: {
      title: args.title,
      body: args.body,
    },
    data: stringData,
    android: {
      priority: 'high',
      notification: {
        channelId: 'dividend-calendar',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
        },
      },
    },
  }));

  const invalidTokens: string[] = [];
  let sent = 0;

  try {
    const res = await admin.messaging().sendEach(messages);
    res.responses.forEach((r, i) => {
      if (r.success) {
        sent++;
      } else {
        const code = r.error?.code ?? '';
        const fatalCodes = new Set([
          'messaging/registration-token-not-registered',
          'messaging/invalid-registration-token',
          'messaging/invalid-argument',
        ]);
        if (fatalCodes.has(code)) {
          invalidTokens.push(tokens[i].token);
        } else {
          console.warn(`[push-dispatcher] transient error for token[${i}]: ${code} — ${r.error?.message}`);
        }
      }
    });
  } catch (e) {
    console.error('[push-dispatcher] sendEach failed:', e);
    return { sent: 0, invalidTokens: [] };
  }

  if (invalidTokens.length) calendarService.removePushTokens(invalidTokens);

  return { sent, invalidTokens };
}
