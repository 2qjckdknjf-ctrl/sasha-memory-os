import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildDefaultCursor,
  createLocalVaultStore,
  runConnectorCertificationSmoke,
  runConnectorSync,
} from '@memory-os/connector-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  gmailConnector,
  pullGmailStubDelta,
  resolveGmailSelectedLabels,
  validateGmailSelectionScope,
} from './sync.js';

const connectionId = '88888888-8888-4888-8888-888888888802';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const vaultRef = `vault:local/connectors/gmail/${connectionId}`;

const selectedGmailMetadata = {
  collections: {
    selection_mode: 'selected' as const,
    excluded_ids: [],
    items: [
      {
        id: 'gmail:label:LBL-REF',
        external_id: 'LBL-REF',
        kind: 'label' as const,
        name: 'Projects',
        title: 'Projects',
        metadata: {
          storage_mode: 'reference',
        },
      },
      {
        id: 'gmail:label:LBL-IDX',
        external_id: 'LBL-IDX',
        kind: 'label' as const,
        name: 'Action',
        title: 'Action',
        metadata: {
          storage_mode: 'indexed',
        },
      },
    ],
    project_bindings: {
      'gmail:label:LBL-REF': '44444444-4444-4444-8444-444444444421',
      'gmail:label:LBL-IDX': '44444444-4444-4444-8444-444444444422',
    },
  },
};

function createGmailProcessEnv(dir: string) {
  return {
    MEMORY_OS_ENV: 'local',
    MEMORY_OS_CONNECTOR_PULL_MODE: 'auto',
    MEMORY_OS_VAULT_DIR: dir,
    MEMORY_OS_VAULT_KEY: 'test-vault-key',
  };
}

async function createGmailVaultFixture(dir: string) {
  const processEnv = createGmailProcessEnv(dir);
  const vault = createLocalVaultStore(processEnv);
  await vault.put({
    vaultRef,
    accessToken: 'ya29.test',
    provider: 'gmail',
    storedAt: '2026-08-11T12:00:00.000Z',
  });
  return {
    processEnv,
    vault,
  };
}

function encodeBody(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function gmailMessageResponse(input: {
  id: string;
  labelIds: string[];
  historyId: string;
  internalDate: string;
  subject: string;
  from?: string;
  snippet?: string;
  bodyText?: string | null;
  attachments?: Array<{
    filename?: string;
    mimeType?: string;
    size?: number;
    attachmentId?: string;
    bodyText?: string;
  }>;
}) {
  const parts = [];
  if (input.bodyText && input.bodyText.length > 0) {
    parts.push({
      mimeType: 'text/plain',
      body: {
        data: encodeBody(input.bodyText),
      },
    });
  }
  for (const attachment of input.attachments ?? []) {
    parts.push({
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      body: {
        size: attachment.size,
        attachmentId: attachment.attachmentId,
        data: attachment.bodyText ? encodeBody(attachment.bodyText) : undefined,
      },
    });
  }
  return Response.json({
    id: input.id,
    labelIds: input.labelIds,
    historyId: input.historyId,
    internalDate: input.internalDate,
    snippet: input.snippet ?? '',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'Subject', value: input.subject },
        { name: 'From', value: input.from ?? 'owner@example.com' },
      ],
      parts,
    },
  });
}

function buildSelectedCursor(input?: {
  startHistoryId?: string;
  knownMessages?: Array<{
    id: string;
    collectionId: string;
    storageMode: 'reference' | 'indexed';
    title: string | null;
    selectedLabelIds: string[];
  }>;
}) {
  return buildDefaultCursor(
    'gmail:messages',
    {
      startHistoryId: input?.startHistoryId ?? '200',
      scopeKey:
        'gmail:label:LBL-IDX:LBL-IDX:indexed|gmail:label:LBL-REF:LBL-REF:reference',
      knownMessages: input?.knownMessages ?? [],
    },
    '2.0',
  );
}

describe('gmail selected-label contract', () => {
  it('requires an explicit selected-label scope and does not default to INBOX', () => {
    expect(validateGmailSelectionScope({})).toEqual({
      ok: false,
      missing: ['metadata.collections'],
    });
    expect(
      validateGmailSelectionScope({
        collections: {
          selection_mode: 'selected',
          excluded_ids: [],
          items: [],
        },
      }),
    ).toEqual({
      ok: false,
      missing: ['selected Gmail labels'],
    });
    expect(resolveGmailSelectedLabels(selectedGmailMetadata)).toEqual([
      expect.objectContaining({
        collectionId: 'gmail:label:LBL-REF',
        externalId: 'LBL-REF',
        storageMode: 'reference',
      }),
      expect.objectContaining({
        collectionId: 'gmail:label:LBL-IDX',
        externalId: 'LBL-IDX',
        storageMode: 'indexed',
      }),
    ]);
  });

  it('returns stub metadata only for explicitly selected labels', () => {
    const result = pullGmailStubDelta({
      connectionId,
      displayName: 'Pilot Gmail',
      metadata: selectedGmailMetadata,
    });
    expect(result.mode).toBe('stub');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toMatch(/Memory OS pilot kickoff/);
    expect(JSON.stringify(result)).not.toMatch(/Bearer|access_token|INBOX/i);
  });

  it('syncs selected labels only, ignores unselected siblings, indexes only body text, and never fetches attachment bytes', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-gmail-selected-'));
    try {
      const { processEnv, vault } = await createGmailVaultFixture(dir);
      const fetchImpl = vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/messages')) {
          const labelId = parsed.searchParams.get('labelIds');
          if (labelId === 'LBL-REF') {
            return Response.json({
              messages: [{ id: 'm-ref' }, { id: 'm-shared' }, { id: 'm-out' }],
            });
          }
          if (labelId === 'LBL-IDX') {
            return Response.json({
              messages: [{ id: 'm-idx' }, { id: 'm-shared' }],
            });
          }
        }
        if (parsed.pathname.endsWith('/messages/m-ref')) {
          return gmailMessageResponse({
            id: 'm-ref',
            labelIds: ['LBL-REF', 'LBL-OTHER'],
            historyId: '301',
            internalDate: '1723382400000',
            subject: 'Reference-only project note',
            snippet: 'Metadata only.',
          });
        }
        if (parsed.pathname.endsWith('/messages/m-idx')) {
          return gmailMessageResponse({
            id: 'm-idx',
            labelIds: ['LBL-IDX'],
            historyId: '302',
            internalDate: '1723386400000',
            subject: 'Indexed action item',
            snippet: 'Should use full body.',
            bodyText: 'Indexed body for Action label.',
            attachments: [
              {
                filename: 'action-items.txt',
                mimeType: 'text/plain',
                size: 2048,
                attachmentId: 'att-idx-1',
                bodyText: 'Attachment bytes must never be indexed.',
              },
            ],
          });
        }
        if (parsed.pathname.endsWith('/messages/m-shared')) {
          return gmailMessageResponse({
            id: 'm-shared',
            labelIds: ['LBL-REF', 'LBL-IDX', 'LBL-OTHER'],
            historyId: '303',
            internalDate: '1723390000000',
            subject: 'Shared selected label message',
            snippet: 'Shared message snippet.',
            bodyText: 'Shared indexed body.',
          });
        }
        if (parsed.pathname.endsWith('/messages/m-out')) {
          return gmailMessageResponse({
            id: 'm-out',
            labelIds: ['LBL-OTHER'],
            historyId: '304',
            internalDate: '1723391000000',
            subject: 'Unselected sibling only',
            snippet: 'Should be ignored.',
          });
        }
        throw new Error(`Unhandled Gmail test URL: ${url}`);
      });

      const syncRun = await runConnectorSync({
        connector: gmailConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'gmail',
            displayName: 'Pilot Gmail',
            vaultRef,
            scopes: ['gmail.readonly'],
            metadata: selectedGmailMetadata,
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      const byExternalId = new Map(
        syncRun.records.map((record) => [record.externalObject.externalId, record]),
      );
      expect(syncRun.records).toHaveLength(3);
      expect(byExternalId.has('msg/m-out')).toBe(false);
      expect(byExternalId.get('msg/m-ref')?.envelope.scope.storage_mode).toBe('reference');
      expect(byExternalId.get('msg/m-ref')?.capture.text).toContain(
        'Source: vault-backed Gmail selected-label metadata sync.',
      );
      expect(byExternalId.get('msg/m-idx')?.envelope.scope.storage_mode).toBe('indexed');
      expect(byExternalId.get('msg/m-idx')?.capture.text).toContain('Indexed body for Action label.');
      expect(byExternalId.get('msg/m-idx')?.capture.text).not.toContain(
        'Attachment bytes must never be indexed.',
      );
      expect(byExternalId.get('msg/m-idx')?.externalObject.attachments).toEqual([
        {
          filename: 'action-items.txt',
          mimeType: 'text/plain',
          size: 2048,
        },
      ]);
      expect(byExternalId.get('msg/m-shared')?.externalObject.collectionId).toBe(
        'gmail:label:LBL-IDX',
      );
      expect(byExternalId.get('msg/m-shared')?.capture.text).toContain('Shared indexed body.');
      expect(byExternalId.get('msg/m-ref')?.envelope.scope.sensitivity).toBe('personal');
      expect(
        fetchImpl.mock.calls.some(([value]) => String(value).includes('labelIds=INBOX')),
      ).toBe(false);
      expect(
        fetchImpl.mock.calls.some(([value]) => String(value).includes('/attachments/')),
      ).toBe(false);
      expect(syncRun.nextCursor?.opaque.startHistoryId).toBe('303');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses history.list for incremental sync and tombstones deleted or label-removed messages', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-gmail-history-'));
    try {
      const { processEnv, vault } = await createGmailVaultFixture(dir);
      const fetchImpl = vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/history')) {
          const labelId = parsed.searchParams.get('labelId');
          if (labelId === 'LBL-REF') {
            return Response.json({
              historyId: '221',
              history: [
                {
                  id: '220',
                  labelsRemoved: [
                    {
                      message: { id: 'm-label-removed' },
                      labelIds: ['LBL-REF'],
                    },
                  ],
                },
                {
                  id: '221',
                  messagesDeleted: [{ message: { id: 'm-deleted' } }],
                },
              ],
            });
          }
          if (labelId === 'LBL-IDX') {
            return Response.json({
              historyId: '223',
              history: [
                {
                  id: '223',
                  messagesAdded: [{ message: { id: 'm-new' } }],
                },
              ],
            });
          }
        }
        if (parsed.pathname.endsWith('/messages/m-label-removed')) {
          return gmailMessageResponse({
            id: 'm-label-removed',
            labelIds: ['LBL-OTHER'],
            historyId: '222',
            internalDate: '1723385400000',
            subject: 'Moved out of selected labels',
            snippet: 'Now only in unselected label.',
          });
        }
        if (parsed.pathname.endsWith('/messages/m-new')) {
          return gmailMessageResponse({
            id: 'm-new',
            labelIds: ['LBL-IDX'],
            historyId: '223',
            internalDate: '1723394400000',
            subject: 'New indexed action',
            snippet: 'New action snippet.',
            bodyText: 'New indexed action body.',
          });
        }
        throw new Error(`Unhandled Gmail history URL: ${url}`);
      });

      const syncRun = await runConnectorSync({
        connector: gmailConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'gmail',
            displayName: 'Pilot Gmail',
            vaultRef,
            scopes: ['gmail.readonly'],
            metadata: selectedGmailMetadata,
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          cursor: buildSelectedCursor({
            startHistoryId: '200',
            knownMessages: [
              {
                id: 'm-label-removed',
                collectionId: 'gmail:label:LBL-REF',
                storageMode: 'reference',
                title: 'Moved out of selected labels',
                selectedLabelIds: ['LBL-REF'],
              },
              {
                id: 'm-deleted',
                collectionId: 'gmail:label:LBL-IDX',
                storageMode: 'indexed',
                title: 'Deleted action',
                selectedLabelIds: ['LBL-IDX'],
              },
            ],
          }),
        },
      });

      const byExternalId = new Map(
        syncRun.records.map((record) => [record.externalObject.externalId, record]),
      );
      expect(syncRun.page.mode).toBe('incremental');
      expect(byExternalId.get('msg/m-label-removed')?.externalObject.deleted).toBe(true);
      expect(byExternalId.get('msg/m-label-removed')?.envelope.event_type).toBe(
        'gmail.message.label_removed',
      );
      expect(byExternalId.get('msg/m-deleted')?.externalObject.deleted).toBe(true);
      expect(byExternalId.get('msg/m-deleted')?.envelope.event_type).toBe(
        'gmail.message.deleted',
      );
      expect(byExternalId.get('msg/m-new')?.externalObject.deleted).toBe(false);
      expect(byExternalId.get('msg/m-new')?.capture.text).toContain('New indexed action body.');
      expect(syncRun.nextCursor?.opaque.startHistoryId).toBe('223');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs a bounded selected-label resync when history.list returns 404', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-gmail-expired-'));
    try {
      const { processEnv, vault } = await createGmailVaultFixture(dir);
      const fetchImpl = vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/history')) {
          return new Response('history expired', { status: 404 });
        }
        if (parsed.pathname.endsWith('/messages')) {
          const labelId = parsed.searchParams.get('labelIds');
          if (labelId === 'LBL-REF') {
            return Response.json({ messages: [{ id: 'm-new' }] });
          }
          if (labelId === 'LBL-IDX') {
            return Response.json({ messages: [] });
          }
        }
        if (parsed.pathname.endsWith('/messages/m-new')) {
          return gmailMessageResponse({
            id: 'm-new',
            labelIds: ['LBL-REF'],
            historyId: '401',
            internalDate: '1723400000000',
            subject: 'Fresh after resync',
            snippet: 'Only this one remains.',
          });
        }
        throw new Error(`Unhandled Gmail expired-history URL: ${url}`);
      });

      const syncRun = await runConnectorSync({
        connector: gmailConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'gmail',
            displayName: 'Pilot Gmail',
            vaultRef,
            scopes: ['gmail.readonly'],
            metadata: selectedGmailMetadata,
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          cursor: buildSelectedCursor({
            startHistoryId: 'expired-history-id',
            knownMessages: [
              {
                id: 'm-old',
                collectionId: 'gmail:label:LBL-REF',
                storageMode: 'reference',
                title: 'Old selected message',
                selectedLabelIds: ['LBL-REF'],
              },
            ],
          }),
        },
      });

      expect(syncRun.page.mode).toBe('initial');
      expect(syncRun.records.some((record) => record.externalObject.deleted)).toBe(true);
      expect(
        syncRun.records.some(
          (record) => record.envelope.event_type === 'gmail.message.missing_from_selected_resync',
        ),
      ).toBe(true);
      expect(syncRun.nextCursor?.opaque.startHistoryId).toBe('401');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('gmailConnector certification', () => {
  it('passes SDK certification smoke with selected labels and history sync', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'memory-os-gmail-cert-'));
    try {
      const { processEnv, vault } = await createGmailVaultFixture(dir);
      const fetchImpl = vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/messages') && parsed.searchParams.get('maxResults') === '1') {
          return Response.json({ messages: [{ id: 'probe-1' }] });
        }
        if (parsed.pathname.endsWith('/messages')) {
          const labelId = parsed.searchParams.get('labelIds');
          if (labelId === 'LBL-REF') {
            return Response.json({ messages: [{ id: 'cert-ref' }] });
          }
          if (labelId === 'LBL-IDX') {
            return Response.json({ messages: [{ id: 'cert-idx' }] });
          }
        }
        if (parsed.pathname.endsWith('/messages/cert-ref')) {
          return gmailMessageResponse({
            id: 'cert-ref',
            labelIds: ['LBL-REF'],
            historyId: '501',
            internalDate: '1723382400000',
            subject: 'Certification reference',
            snippet: 'Reference cert message.',
          });
        }
        if (parsed.pathname.endsWith('/messages/cert-idx')) {
          return gmailMessageResponse({
            id: 'cert-idx',
            labelIds: ['LBL-IDX'],
            historyId: '502',
            internalDate: '1723386400000',
            subject: 'Certification indexed',
            snippet: 'Indexed cert message.',
            bodyText: 'Certification indexed body.',
            attachments: [
              {
                filename: 'cert-attachment.pdf',
                mimeType: 'application/pdf',
                size: 4096,
                attachmentId: 'cert-att-1',
              },
            ],
          });
        }
        if (parsed.pathname.endsWith('/history')) {
          if (parsed.searchParams.get('startHistoryId') === 'expired-history-id') {
            return new Response('expired', { status: 404 });
          }
          return Response.json({
            historyId: '503',
            history: [],
          });
        }
        throw new Error(`Unhandled Gmail certification URL: ${url}`);
      });

      const result = await runConnectorCertificationSmoke({
        connector: gmailConnector,
        context: {
          account: {
            connectionId,
            connectorId: 'gmail',
            displayName: 'Pilot Gmail',
            vaultRef,
            scopes: ['gmail.readonly'],
            metadata: selectedGmailMetadata,
          },
          workspaceId,
          processEnv,
          vault,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      });

      expect(result.records).toHaveLength(2);
      const indexedRecord = result.records.find(
        (record) => record.externalObject.externalId === 'msg/cert-idx',
      );
      expect(indexedRecord?.externalObject.attachments).toEqual([
        {
          filename: 'cert-attachment.pdf',
          mimeType: 'application/pdf',
          size: 4096,
        },
      ]);
      expect(
        fetchImpl.mock.calls.some(([value]) => String(value).includes('/attachments/')),
      ).toBe(false);
      expect(result.nextCursor?.opaque.startHistoryId).toBe('502');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
