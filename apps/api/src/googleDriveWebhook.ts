import { timingSafeEqual } from 'node:crypto';
import type { SyncCursor } from '@memory-os/connector-sdk';

export const GOOGLE_DRIVE_WATCH_CURSOR_STREAM = 'google-drive:watch';
export const GOOGLE_DRIVE_WATCH_RESOURCE_STATE_HEADER = 'x-goog-resource-state';
export const GOOGLE_DRIVE_WATCH_CHANNEL_ID_HEADER = 'x-goog-channel-id';
export const GOOGLE_DRIVE_WATCH_RESOURCE_ID_HEADER = 'x-goog-resource-id';
export const GOOGLE_DRIVE_WATCH_MESSAGE_NUMBER_HEADER = 'x-goog-message-number';
export const GOOGLE_DRIVE_WATCH_CHANNEL_TOKEN_HEADER = 'x-goog-channel-token';
export const GOOGLE_DRIVE_WATCH_RESOURCE_URI_HEADER = 'x-goog-resource-uri';
const GOOGLE_DRIVE_WATCH_RECENT_MESSAGE_LIMIT = 20;

type GoogleDriveWatchCursorState = {
  lastMessageKey?: string | null;
  recentMessageKeys: string[];
};

export type GoogleDriveWatchVerificationResult =
  | { ok: true; mode: 'token' | 'unsigned_local' }
  | { ok: false; error: 'token_required' | 'token_invalid' | 'secret_missing' };

function normalizeHeader(value: string | null | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function isLocalOrTestEnv(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const name = (env.MEMORY_OS_ENV ?? '').trim().toLowerCase();
  return name === 'local' || name === 'test';
}

function normalizeSecret(secret: string | null | undefined): string | null {
  return normalizeHeader(secret);
}

function resolveGoogleDriveWatchTokenCandidate(channelToken: string | null): string | null {
  const token = normalizeHeader(channelToken);
  if (!token) return null;
  if (!token.includes('=')) {
    return token;
  }
  const params = new URLSearchParams(token);
  return normalizeHeader(
    params.get('watch_token') ?? params.get('token') ?? params.get('secret'),
  );
}

export function isGoogleDriveWatchTokenRequired(
  env: NodeJS.ProcessEnv = process.env,
  secret = env.MEMORY_OS_GOOGLE_DRIVE_WATCH_TOKEN,
): boolean {
  return normalizeSecret(secret) !== null || !isLocalOrTestEnv(env);
}

export function verifyGoogleDriveWatchToken(input: {
  channelToken?: string | null;
  secret?: string | null;
  env?: NodeJS.ProcessEnv;
}): GoogleDriveWatchVerificationResult {
  const env = input.env ?? process.env;
  const secret = normalizeSecret(
    input.secret ?? env.MEMORY_OS_GOOGLE_DRIVE_WATCH_TOKEN,
  );
  const provided = resolveGoogleDriveWatchTokenCandidate(input.channelToken ?? null);

  if (!secret) {
    if (isLocalOrTestEnv(env)) {
      return { ok: true, mode: 'unsigned_local' };
    }
    return { ok: false, error: 'secret_missing' };
  }
  if (!provided) {
    return { ok: false, error: 'token_required' };
  }

  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, error: 'token_invalid' };
  }
  return timingSafeEqual(expectedBuffer, providedBuffer)
    ? { ok: true, mode: 'token' }
    : { ok: false, error: 'token_invalid' };
}

export function resolveGoogleDriveWebhookConnectionId(input: {
  queryConnectionId?: string | null;
  channelToken?: string | null;
}): string | null {
  const explicit = normalizeHeader(input.queryConnectionId);
  if (explicit) return explicit;
  const token = normalizeHeader(input.channelToken);
  if (!token) return null;
  if (!token.includes('=')) {
    return null;
  }
  const params = new URLSearchParams(token);
  return normalizeHeader(params.get('connection_id') ?? params.get('connectionId'));
}

function buildGoogleDriveWatchMessageKey(input: {
  channelId?: string | null;
  messageNumber?: string | null;
}): string | null {
  const channelId = normalizeHeader(input.channelId);
  const messageNumber = normalizeHeader(input.messageNumber);
  if (!channelId || !messageNumber) return null;
  return `${channelId}:${messageNumber}`;
}

function parseGoogleDriveWatchCursorState(
  cursor: SyncCursor | null,
): GoogleDriveWatchCursorState {
  const recentMessageKeys = Array.isArray(cursor?.opaque?.recentMessageKeys)
    ? cursor.opaque.recentMessageKeys.filter(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      )
    : [];
  return {
    lastMessageKey:
      typeof cursor?.opaque?.lastMessageKey === 'string' ? cursor.opaque.lastMessageKey : null,
    recentMessageKeys,
  };
}

export function hasSeenGoogleDriveWatchMessage(
  cursor: SyncCursor | null,
  input: {
    channelId?: string | null;
    messageNumber?: string | null;
  },
): boolean {
  const messageKey = buildGoogleDriveWatchMessageKey(input);
  if (!messageKey) return false;
  const parsed = parseGoogleDriveWatchCursorState(cursor);
  return parsed.lastMessageKey === messageKey || parsed.recentMessageKeys.includes(messageKey);
}

export function buildGoogleDriveWatchCursorPayload(input: {
  previousCursor: SyncCursor | null;
  channelId?: string | null;
  resourceId?: string | null;
  resourceState?: string | null;
  resourceUri?: string | null;
  messageNumber?: string | null;
  receivedAt: string;
}): Record<string, unknown> {
  const previous = parseGoogleDriveWatchCursorState(input.previousCursor);
  const messageKey = buildGoogleDriveWatchMessageKey(input);
  const recentMessageKeys = messageKey
    ? [messageKey, ...previous.recentMessageKeys.filter((value) => value !== messageKey)].slice(
        0,
        GOOGLE_DRIVE_WATCH_RECENT_MESSAGE_LIMIT,
      )
    : previous.recentMessageKeys.slice(0, GOOGLE_DRIVE_WATCH_RECENT_MESSAGE_LIMIT);
  return {
    lastMessageKey: messageKey,
    recentMessageKeys,
    channelId: normalizeHeader(input.channelId),
    resourceId: normalizeHeader(input.resourceId),
    resourceState: normalizeHeader(input.resourceState),
    resourceUri: normalizeHeader(input.resourceUri),
    messageNumber: normalizeHeader(input.messageNumber),
    receivedAt: input.receivedAt,
  };
}
