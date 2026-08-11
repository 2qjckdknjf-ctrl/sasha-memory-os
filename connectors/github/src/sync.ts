import { vaultRefForAccount } from '@memory-os/connector-sdk';

export type GitHubSyncDelta = {
  externalId: string;
  eventType: string;
  title: string;
  text: string;
  observedAt: string;
};

/**
 * Stub GitHub delta pull: invents PR/issue events from vault ref metadata.
 * Never loads token material — only the vault reference string.
 */
export function pullGithubStubDelta(input: {
  env?: string;
  connectionId: string;
  displayName?: string;
  vaultRef?: string;
}): { vaultRef: string; items: GitHubSyncDelta[] } {
  const env = input.env ?? process.env.MEMORY_OS_ENV ?? 'local';
  const vaultRef =
    input.vaultRef ??
    vaultRefForAccount({
      env,
      connectorId: 'github',
      accountId: input.connectionId,
    });
  const label = input.displayName ?? 'GitHub';
  const stamp = new Date().toISOString();

  return {
    vaultRef,
    items: [
      {
        externalId: `pr/${input.connectionId.slice(0, 8)}/215`,
        eventType: 'github.pull_request.updated',
        title: `${label}: PR #215 Product Design Audit`,
        text: [
          `Connector vault ref: ${vaultRef}`,
          'Synthetic GitHub sync (vault ref only; credentials not read).',
          'Pull request #215 Product Design Audit merged for Slice 01 kickoff.',
          'Repos: aistroyka/core',
        ].join('\n'),
        observedAt: stamp,
      },
      {
        externalId: `issue/${input.connectionId.slice(0, 8)}/88`,
        eventType: 'github.issue.opened',
        title: `${label}: Issue #88 connector sync backlog`,
        text: [
          `Connector vault ref: ${vaultRef}`,
          'Synthetic GitHub sync (vault ref only; credentials not read).',
          'Issue #88 tracks vault-backed incremental connector sync.',
          'Labels: memory-os, connectors',
        ].join('\n'),
        observedAt: stamp,
      },
    ],
  };
}
