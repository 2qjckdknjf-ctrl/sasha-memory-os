import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_M16_APPLE_SECURITY_PACK,
  OFFICIAL_M16_APPLE_SECURITY_PACK_VERSION,
  assertLeastPrivilegeSourceSelection,
  buildEncryptedTransportEnvelope,
  createAppleDeviceIdentity,
  planOfflineQueueReplay,
  validateQueueJsonHasNoRawSecrets,
} from './appleCompanionSecurity.js';

const projectId = '44444444-4444-4444-8444-444444444401';

describe('M16.2 Apple companion security foundation', () => {
  it('publishes security pack without signed companion live E2E PASS', () => {
    expect(OFFICIAL_M16_APPLE_SECURITY_PACK_VERSION).toBe('m16-s02-v1');
    expect(OFFICIAL_M16_APPLE_SECURITY_PACK.invariants).toMatchObject({
      neverEmbedRawTokensInQueueJson: true,
      offlineReplayReusesIdempotencyKey: true,
      leastPrivilegeSelectedScope: true,
      claimLiveSignedCompanionE2EPassFromMocks: false,
      modeAToolCount: 7,
    });
  });

  it('binds device identity, encrypts transport, and replays with same idempotency key', () => {
    const identity = createAppleDeviceIdentity({
      deviceId: 'iphone-15-pro',
      bindingRef: 'bind_opaque_abc',
      platform: 'ios',
    });
    expect(identity.bindingRef).toBe('bind_opaque_abc');
    expect(() =>
      createAppleDeviceIdentity({
        deviceId: 'iphone-15-pro',
        bindingRef: 'raw:token=secret',
        platform: 'ios',
      }),
    ).toThrow(/opaque/);

    const envelope = buildEncryptedTransportEnvelope({
      projectId,
      deviceId: identity.deviceId,
      idempotencyKey: 'apple-share/iphone-15-pro/item-1',
      plaintextUtf8: '{"title":"note"}',
    });
    expect(envelope.keyRef.backend).toBe('keychain');
    expect(envelope.ciphertextBase64.length).toBeGreaterThan(0);
    expect(envelope.projectId).toBe(projectId);

    const replay1 = planOfflineQueueReplay({
      projectId,
      deviceId: identity.deviceId,
      idempotencyKey: 'apple-share/iphone-15-pro/item-1',
      attempt: 1,
    });
    const replay2 = planOfflineQueueReplay({
      projectId,
      deviceId: identity.deviceId,
      idempotencyKey: 'apple-share/iphone-15-pro/item-1',
      attempt: 2,
    });
    expect(replay1.idempotencyKey).toBe(replay2.idempotencyKey);
    expect(replay1.reuseIdempotencyKey).toBe(true);

    const scope = assertLeastPrivilegeSourceSelection({
      requested: ['photo_library_selected', 'contacts_selected'],
      granted: ['photo_library_selected'],
    });
    expect(scope.allowed).toEqual(['photo_library_selected']);
    expect(scope.denied).toEqual(['contacts_selected']);

    expect(
      validateQueueJsonHasNoRawSecrets({
        item_id: '1',
        key_ref: { service: 'memory-os.apple-companion.queue-key' },
      }).ok,
    ).toBe(true);
    expect(
      validateQueueJsonHasNoRawSecrets({
        session_token: 'abc',
      }).ok,
    ).toBe(false);

    expect(() =>
      buildEncryptedTransportEnvelope({
        projectId: '  ',
        deviceId: 'x',
        idempotencyKey: 'k',
        plaintextUtf8: '{}',
      }),
    ).toThrow(/project_id is required/);
  });
});
