export type ConnectorErrorKind =
  | 'rate_limit'
  | 'retryable'
  | 'cursor_expired'
  | 'poison_object'
  | 'revoked'
  | 'terminal';

export type ClassifiedConnectorError = {
  kind: ConnectorErrorKind;
  retryable: boolean;
  message: string;
  retryAfterMs: number | null;
  statusCode: number | null;
  cause?: unknown;
};

type ConnectorErrorOptions = {
  message: string;
  cause?: unknown;
  retryAfterMs?: number | null;
  statusCode?: number | null;
};

export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly statusCode: number | null;

  constructor(
    kind: ConnectorErrorKind,
    options: ConnectorErrorOptions,
  ) {
    super(options.message);
    this.name = 'ConnectorError';
    this.kind = kind;
    this.retryable = kind === 'rate_limit' || kind === 'retryable';
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.statusCode = options.statusCode ?? null;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export function connectorRateLimitError(options: ConnectorErrorOptions): ConnectorError {
  return new ConnectorError('rate_limit', {
    ...options,
    statusCode: options.statusCode ?? 429,
  });
}

export function connectorRetryableError(options: ConnectorErrorOptions): ConnectorError {
  return new ConnectorError('retryable', options);
}

export function connectorCursorExpiredError(options: ConnectorErrorOptions): ConnectorError {
  return new ConnectorError('cursor_expired', options);
}

export function connectorPoisonObjectError(options: ConnectorErrorOptions): ConnectorError {
  return new ConnectorError('poison_object', options);
}

export function connectorRevokedError(options: ConnectorErrorOptions): ConnectorError {
  return new ConnectorError('revoked', options);
}

export function connectorTerminalError(options: ConnectorErrorOptions): ConnectorError {
  return new ConnectorError('terminal', options);
}

function messageLooksLikeRateLimit(message: string): boolean {
  return (
    /\b(http|status)\s*429\b/i.test(message) ||
    /\b429\b/.test(message) && /\b(rate limit|too many requests|retry-after)\b/i.test(message)
  );
}

export function classifyConnectorError(error: unknown): ClassifiedConnectorError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ConnectorError) {
    return {
      kind: error.kind,
      retryable: error.retryable,
      message,
      retryAfterMs: error.retryAfterMs,
      statusCode: error.statusCode,
      cause: error.cause,
    };
  }

  const statusCode =
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
      ? error.statusCode
      : typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          typeof error.status === 'number'
        ? error.status
        : null;

  if (statusCode === 429) {
    return {
      kind: 'rate_limit',
      retryable: true,
      message,
      retryAfterMs: null,
      statusCode,
      cause: error,
    };
  }

  if (messageLooksLikeRateLimit(message)) {
    return {
      kind: 'rate_limit',
      retryable: true,
      message,
      retryAfterMs: null,
      statusCode: 429,
      cause: error,
    };
  }

  return {
    kind: 'terminal',
    retryable: false,
    message,
    retryAfterMs: null,
    statusCode,
    cause: error,
  };
}
