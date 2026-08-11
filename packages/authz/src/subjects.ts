const SEED_WORKSPACE = '11111111-1111-4111-8111-111111111111';

const DEMO_SUBJECTS: Record<
  string,
  { id: string; externalKey: string; displayName: string; kind: string }
> = {
  '33333333-3333-4333-8333-333333333301': {
    id: '33333333-3333-4333-8333-333333333301',
    externalKey: 'owner',
    displayName: 'Sasha',
    kind: 'user',
  },
  '33333333-3333-4333-8333-333333333302': {
    id: '33333333-3333-4333-8333-333333333302',
    externalKey: 'chatgpt',
    displayName: 'ChatGPT',
    kind: 'agent',
  },
  '33333333-3333-4333-8333-333333333303': {
    id: '33333333-3333-4333-8333-333333333303',
    externalKey: 'cursor',
    displayName: 'Cursor',
    kind: 'agent',
  },
  owner: {
    id: '33333333-3333-4333-8333-333333333301',
    externalKey: 'owner',
    displayName: 'Sasha',
    kind: 'user',
  },
  chatgpt: {
    id: '33333333-3333-4333-8333-333333333302',
    externalKey: 'chatgpt',
    displayName: 'ChatGPT',
    kind: 'agent',
  },
  cursor: {
    id: '33333333-3333-4333-8333-333333333303',
    externalKey: 'cursor',
    displayName: 'Cursor',
    kind: 'agent',
  },
  'demo-owner': {
    id: '33333333-3333-4333-8333-333333333301',
    externalKey: 'owner',
    displayName: 'Sasha',
    kind: 'user',
  },
  'demo-chatgpt': {
    id: '33333333-3333-4333-8333-333333333302',
    externalKey: 'chatgpt',
    displayName: 'ChatGPT',
    kind: 'agent',
  },
  'demo-cursor': {
    id: '33333333-3333-4333-8333-333333333303',
    externalKey: 'cursor',
    displayName: 'Cursor',
    kind: 'agent',
  },
};

export type ResolvedSubject = {
  id: string;
  workspaceId: string;
  kind: string;
  externalKey: string;
  displayName: string;
};

/** Local/demo subject map until live resolve RPC is available. */
export function resolveLocalSubject(input: {
  subjectId?: string | null;
  actorKey?: string | null;
  clientId?: string | null;
  workspaceId?: string;
}): ResolvedSubject | null {
  const workspaceId = input.workspaceId ?? SEED_WORKSPACE;
  const key =
    input.subjectId?.trim() ||
    input.clientId?.trim() ||
    input.actorKey?.trim() ||
    '';
  if (!key) return null;
  const hit = DEMO_SUBJECTS[key];
  if (!hit) return null;
  return {
    id: hit.id,
    workspaceId,
    kind: hit.kind,
    externalKey: hit.externalKey,
    displayName: hit.displayName,
  };
}
