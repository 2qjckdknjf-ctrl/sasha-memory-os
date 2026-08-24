#!/usr/bin/env node
/**
 * Sanitized parser for live migration preflight responses.
 * Reads a response file path; prints only allowlisted status tokens to stdout.
 * Must never emit raw response bodies, memory content, or secrets.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ALLOWLIST = new Set([
  'READY_FOR_LIVE_SMOKE',
  'BLOCKED_REMOTE_MIGRATION',
  'PREFLIGHT_REQUEST_FAILED',
  'PREFLIGHT_INVALID_RESPONSE',
]);

/** @param {string} status */
function emit(status) {
  if (!ALLOWLIST.has(status)) {
    throw new Error(`internal: disallowed preflight status ${status}`);
  }
  console.log(`live_migration_preflight=${status}`);
}

/** @param {unknown} value */
function hasNonEmptyTopLevelJsonRpcError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('error' in value)) return false;
  const err = value.error;
  if (err == null) return false;
  if (typeof err === 'object' && !Array.isArray(err)) {
    return Object.keys(err).length > 0;
  }
  return true;
}

/** @param {string} raw */
function parseJsonBody(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const dataLines = trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    for (let i = dataLines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(dataLines[i]);
      } catch {
        // continue
      }
    }
    return null;
  }
}

/** @param {unknown} value */
function hasMcpResultError(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return value.isError === true;
}

/** @param {string} filePath @param {number} curlExitCode */
export function evaluatePreflightResponse(filePath, curlExitCode = 0) {
  if (curlExitCode !== 0) {
    return { status: 'PREFLIGHT_REQUEST_FAILED', exitCode: 1, jsonRpcErrorCode: null };
  }

  let raw = '';
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return { status: 'PREFLIGHT_REQUEST_FAILED', exitCode: 1, jsonRpcErrorCode: null };
  }

  if (!raw.trim()) {
    return { status: 'PREFLIGHT_REQUEST_FAILED', exitCode: 1, jsonRpcErrorCode: null };
  }

  const body = parseJsonBody(raw);
  if (body == null) {
    return { status: 'PREFLIGHT_INVALID_RESPONSE', exitCode: 1, jsonRpcErrorCode: null };
  }

  if (hasNonEmptyTopLevelJsonRpcError(body)) {
    const code =
      typeof body.error === 'object' && body.error && 'code' in body.error
        ? body.error.code
        : null;
    return {
      status: 'BLOCKED_REMOTE_MIGRATION',
      exitCode: 0,
      jsonRpcErrorCode: typeof code === 'number' ? code : null,
    };
  }

  if (!('result' in body)) {
    return { status: 'PREFLIGHT_INVALID_RESPONSE', exitCode: 1, jsonRpcErrorCode: null };
  }

  if (hasMcpResultError(body.result)) {
    return { status: 'PREFLIGHT_INVALID_RESPONSE', exitCode: 1, jsonRpcErrorCode: null };
  }

  return { status: 'READY_FOR_LIVE_SMOKE', exitCode: 0, jsonRpcErrorCode: null };
}

function main() {
  const filePath = process.argv[2];
  const curlExitCode = Number(process.argv[3] ?? '0');
  if (!filePath) {
    emit('PREFLIGHT_REQUEST_FAILED');
    process.exit(1);
  }

  const outcome = evaluatePreflightResponse(filePath, curlExitCode);
  emit(outcome.status);
  if (outcome.jsonRpcErrorCode != null) {
    console.log(`jsonrpc_error_code=${outcome.jsonRpcErrorCode}`);
  }
  process.exit(outcome.exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
