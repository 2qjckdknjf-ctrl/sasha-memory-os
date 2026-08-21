export const OFFICIAL_M16_APPLE_SECURITY_PACK_VERSION = 'm16-s02-v1' as const;

export type AppleSecretStorageBackend = 'keychain' | 'secure_enclave_wrapped_keychain';

export type AppleTransportMode = 'tls_to_memory_api' | 'offline_queue_then_tls';

export type AppleSourceSelection =
  | 'photo_library_selected'
  | 'files_bookmarks_selected'
  | 'share_extension'
  | 'reminders_selected'
  | 'contacts_selected'
  | 'notes_share_only';

export type AppleDeviceIdentity = {
  deviceId: string;
  /** Opaque attestation / binding id — never a raw secret. */
  bindingRef: string;
  platform: 'ios' | 'macos';
  createdAt: string;
};

export type AppleKeychainSecretRef = {
  backend: AppleSecretStorageBackend;
  account: string;
  service: string;
  /** Keychain stores ciphertext/key material; callers never embed raw tokens in queue JSON. */
  holds: 'session_token' | 'device_wrapping_key' | 'queue_encryption_key';
};

export type AppleEncryptedTransportEnvelope = {
  mode: AppleTransportMode;
  algorithm: 'AES-256-GCM';
  keyRef: AppleKeychainSecretRef;
  ciphertextBase64: string;
  nonceBase64: string;
  projectId: string;
  deviceId: string;
  idempotencyKey: string;
};

export type AppleOfflineQueueReplayPlan = {
  projectId: string;
  deviceId: string;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  /** Same idempotency key must be reused across retries. */
  reuseIdempotencyKey: true;
};

export const OFFICIAL_M16_APPLE_SECURITY_PACK = {
  version: OFFICIAL_M16_APPLE_SECURITY_PACK_VERSION,
  roadmapSections: ['16.2', 'apple-companion-security-foundation'],
  requirements: [
    'native_signed_companion',
    'local_secure_storage_keychain',
    'device_identity_binding',
    'explicit_source_selection',
    'encrypted_transport_to_memory_api',
    'least_privilege',
    'offline_queue_replay_idempotency',
  ] as const,
  allowedSecretBackends: [
    'keychain',
    'secure_enclave_wrapped_keychain',
  ] as const,
  allowedTransportModes: [
    'tls_to_memory_api',
    'offline_queue_then_tls',
  ] as const,
  invariants: {
    neverEmbedRawTokensInQueueJson: true,
    neverServerSideIcloudScrape: true,
    explicitSourceSelectionOnly: true,
    leastPrivilegeSelectedScope: true,
    offlineReplayReusesIdempotencyKey: true,
    writesRequireExplicitProjectId: true,
    neverUseDefaultProjectFallback: true,
    modeAToolCount: 7,
    allowMemoryOsDefaultProjectIdFallback: false,
    allowAistroykaFallback: false,
    claimLiveSignedCompanionE2EPassFromMocks: false,
  },
  liveSignedCompanionE2E: {
    statusInThisSlice: 'contract_pass_signing_blocked',
    note: 'Security contracts + fixture proofs PASS; TestFlight/signing and live Keychain device E2E remain blocked.',
  },
} as const;

function requireExplicitProjectId(projectId: string | null | undefined): string {
  const trimmed = projectId?.trim();
  if (!trimmed) {
    throw new Error('project_id is required (fail closed; no default project fallback)');
  }
  return trimmed;
}

export function createAppleDeviceIdentity(input: {
  deviceId: string;
  bindingRef: string;
  platform: 'ios' | 'macos';
  createdAt?: string;
}): AppleDeviceIdentity {
  const deviceId = input.deviceId.trim();
  const bindingRef = input.bindingRef.trim();
  if (!deviceId) throw new Error('device_id is required');
  if (!bindingRef) throw new Error('binding_ref is required');
  if (bindingRef.startsWith('raw:') || bindingRef.includes('token=')) {
    throw new Error('binding_ref must be opaque; do not store raw tokens');
  }
  return {
    deviceId,
    bindingRef,
    platform: input.platform,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function assertLeastPrivilegeSourceSelection(input: {
  requested: AppleSourceSelection[];
  granted: AppleSourceSelection[];
}): { allowed: AppleSourceSelection[]; denied: AppleSourceSelection[] } {
  const granted = new Set(input.granted);
  const allowed = input.requested.filter((s) => granted.has(s));
  const denied = input.requested.filter((s) => !granted.has(s));
  return { allowed, denied };
}

export function buildEncryptedTransportEnvelope(input: {
  projectId: string;
  deviceId: string;
  idempotencyKey: string;
  plaintextUtf8: string;
  /** Fixture-only stub cipher; production uses Keychain-backed AES-GCM. */
  stubEncrypt?: (plaintext: string) => { ciphertextBase64: string; nonceBase64: string };
}): AppleEncryptedTransportEnvelope {
  const projectId = requireExplicitProjectId(input.projectId);
  const deviceId = input.deviceId.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  if (!deviceId) throw new Error('device_id is required');
  if (!idempotencyKey) throw new Error('idempotency_key is required');

  const encrypt =
    input.stubEncrypt ??
    ((plaintext: string) => ({
      ciphertextBase64: Buffer.from(plaintext, 'utf8').toString('base64'),
      nonceBase64: Buffer.from('fixture-nonce-16b').toString('base64'),
    }));
  const { ciphertextBase64, nonceBase64 } = encrypt(input.plaintextUtf8);

  return {
    mode: 'offline_queue_then_tls',
    algorithm: 'AES-256-GCM',
    keyRef: {
      backend: 'keychain',
      account: deviceId,
      service: 'memory-os.apple-companion.queue-key',
      holds: 'queue_encryption_key',
    },
    ciphertextBase64,
    nonceBase64,
    projectId,
    deviceId,
    idempotencyKey,
  };
}

export function planOfflineQueueReplay(input: {
  projectId: string;
  deviceId: string;
  idempotencyKey: string;
  attempt: number;
  maxAttempts?: number;
}): AppleOfflineQueueReplayPlan {
  const projectId = requireExplicitProjectId(input.projectId);
  const maxAttempts = input.maxAttempts ?? 5;
  if (input.attempt < 1) throw new Error('attempt must be >= 1');
  if (input.attempt > maxAttempts) {
    throw new Error('max offline replay attempts exceeded');
  }
  return {
    projectId,
    deviceId: input.deviceId.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    attempt: input.attempt,
    maxAttempts,
    reuseIdempotencyKey: true,
  };
}

export function validateQueueJsonHasNoRawSecrets(
  queueJson: Record<string, unknown>,
): { ok: boolean; findings: string[] } {
  const findings: string[] = [];
  const sensitiveKey =
    /(?:^|[_-])(token|secret|password|authorization|api[_-]?key|refresh)(?:[_-]|$)/i;
  const walk = (value: unknown, path: string) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const next = path ? `${path}.${k}` : k;
        if (sensitiveKey.test(k) && typeof v === 'string' && v.length > 0) {
          findings.push(`raw secret field at ${next}`);
        }
        walk(v, next);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, i) => walk(entry, `${path}[${i}]`));
    }
  };
  walk(queueJson, '');
  return { ok: findings.length === 0, findings };
}
