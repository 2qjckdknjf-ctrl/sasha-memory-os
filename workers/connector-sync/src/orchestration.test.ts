import { describe, expect, it } from 'vitest';
import { planConnectorOrchestrationTick } from './orchestration.js';

describe('M15.2 connector orchestration tick', () => {
  it('runs recovery order and fixture repair hooks without silent data loss', async () => {
    const called: string[] = [];
    const result = await planConnectorOrchestrationTick({
      runDeadLetterStale: () => {
        called.push('dead_letter_stale');
      },
      runEnqueueDue: () => {
        called.push('enqueue_due');
      },
      runClaimAndExecute: () => {
        called.push('claim_and_execute');
      },
      runRetryOrDeadLetter: () => {
        called.push('retry_or_dead_letter');
      },
      repairHooks: {
        connector_restart: () => ({
          scenario: 'connector_restart',
          recovered: true,
          silentDataLoss: false,
          detail: 'resync cleared cursor and reclaimed job (fixture)',
        }),
        duplicate_event: () => ({
          scenario: 'duplicate_event',
          recovered: true,
          silentDataLoss: false,
          detail: 'idempotent source-event key collapsed duplicate delivery (fixture)',
        }),
        missed_webhook: () => ({
          scenario: 'missed_webhook',
          recovered: true,
          silentDataLoss: false,
          detail: 'bounded GitHub reconcile replayed missed window (fixture)',
        }),
        token_expiry: () => ({
          scenario: 'token_expiry',
          recovered: true,
          silentDataLoss: false,
          detail: 'cursor_expired mapped to bounded resync (fixture)',
        }),
      },
    });

    expect(result.packVersion).toBe('m15-s02-v1');
    expect(result.liveE2EClaimed).toBe(false);
    expect(called).toEqual([
      'dead_letter_stale',
      'enqueue_due',
      'claim_and_execute',
      'retry_or_dead_letter',
    ]);
    expect(result.repairs.every((item) => item.recovered && !item.silentDataLoss)).toBe(
      true,
    );
  });

  it('fails closed when a repair reports silent data loss', async () => {
    await expect(
      planConnectorOrchestrationTick({
        repairHooks: {
          duplicate_event: () => ({
            scenario: 'duplicate_event',
            recovered: false,
            silentDataLoss: true,
            detail: 'should never pass',
          }),
        },
      }),
    ).rejects.toThrow(/silent data loss/);
  });
});
