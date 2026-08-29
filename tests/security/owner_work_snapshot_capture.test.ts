import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AISTROYKA_PROJECT_ID,
  CANONICAL_PROJECT_ID,
  OWNER_SUBJECT_ID,
} from '@memory-os/schemas';

const root = resolve(import.meta.dirname, '../..');
const snapshotPath = resolve(root, 'docs/engineering/owner-work-snapshot/2026-08-29.json');
const scriptPath = resolve(root, 'scripts/capture-owner-work-snapshot.sh');
const workflowPath = resolve(root, '.github/workflows/capture-owner-work-snapshot.yml');

type SnapshotMemory = {
  kind: string;
  title: string;
  text?: string;
  content?: string;
  sensitivity?: string;
  idempotencyKey: string;
  projectId?: string;
};

type OwnerWorkSnapshot = {
  schemaVersion: string;
  workspaceId: string;
  projectId: string;
  actorSubjectId: string;
  repoTipSha: string;
  memories: SnapshotMemory[];
};

describe('owner work snapshot capture', () => {
  it('keeps the snapshot on the canonical Memory OS project', () => {
    expect(existsSync(snapshotPath)).toBe(true);
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as OwnerWorkSnapshot;
    expect(snapshot.schemaVersion).toBe('owner-work-snapshot-v1');
    expect(snapshot.projectId).toBe(CANONICAL_PROJECT_ID);
    expect(snapshot.projectId).not.toBe(AISTROYKA_PROJECT_ID);
    expect(snapshot.workspaceId).toBe('11111111-1111-4111-8111-111111111111');
    expect(snapshot.actorSubjectId).toBe(OWNER_SUBJECT_ID);
    expect(snapshot.memories.length).toBeGreaterThanOrEqual(4);
    const keys = snapshot.memories.map((item) => item.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const item of snapshot.memories) {
      expect(['capture_text', 'create_decision']).toContain(item.kind);
      expect(item.title.length).toBeGreaterThan(8);
      expect(item.idempotencyKey.startsWith('owner-')).toBe(true);
      expect(item.sensitivity).toBe('internal');
      expect(item.projectId ?? snapshot.projectId).toBe(CANONICAL_PROJECT_ID);
      const body = item.kind === 'capture_text' ? item.text : item.content;
      expect(body && body.length).toBeGreaterThan(80);
      expect(body).not.toMatch(/service_role|BEGIN PRIVATE|xoxb-|sk-[A-Za-z0-9]/);
    }
    const titles = snapshot.memories.map((item) => item.title).join('\n');
    expect(titles).toContain('OWNER WORK SNAPSHOT');
    expect(titles).toContain('OPEN BLOCKERS');
    expect(titles).toContain('OWNER WORKING PREFERENCES');
    expect(titles).toContain('REMEMBER ALL OWNER WORK');
  });

  it('does not treat the snapshot as a secret or AISTROYKA write', () => {
    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as OwnerWorkSnapshot;
    const raw = readFileSync(snapshotPath, 'utf8');
    expect(raw).not.toMatch(/MEMORY_OS_API_SECRET\s*[:=]/);
    expect(snapshot.projectId).not.toBe(AISTROYKA_PROJECT_ID);
    expect(
      snapshot.memories.some((item) => item.projectId === AISTROYKA_PROJECT_ID),
    ).toBe(false);
  });

  it('fail-closes live capture without secrets and accepts dry-run', () => {
    expect(existsSync(scriptPath)).toBe(true);
    const dry = execFileSync(scriptPath, ['--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
    });
    expect(dry).toContain('dry_run=ok');

    let failed = false;
    try {
      execFileSync(scriptPath, [], {
        cwd: root,
        encoding: 'utf8',
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      });
    } catch (error) {
      failed = true;
      const err = error as { status?: number; stderr?: string };
      expect(err.status).toBe(1);
      expect(String(err.stderr)).toContain('live capture requires');
    }
    expect(failed).toBe(true);
  });

  it('wires the capture workflow to existing live secrets without echoing them', () => {
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('secrets.MEMORY_OS_SUPABASE_URL');
    expect(workflow).toContain('secrets.MEMORY_OS_SUPABASE_ANON_KEY');
    expect(workflow).toContain('secrets.MEMORY_OS_API_SECRET');
    expect(workflow).toContain('set +x');
    expect(workflow).toContain('./scripts/capture-owner-work-snapshot.sh --dry-run');
    expect(workflow).not.toMatch(/echo:.*MEMORY_OS_API_SECRET/);
    expect(workflow).not.toContain('44444444-4444-4444-8444-444444444401');
  });
});
