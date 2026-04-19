import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRunOutcomeContract,
  inferRunOutcome,
  isTerminalRunOutcome,
  normalizeRunOutcome,
} from '../run-outcome.js';
import { shouldContinueRun } from '../run-loop.js';

describe('run outcome contract', () => {
  it('normalizes legacy outcome aliases', () => {
    assert.deepEqual(normalizeRunOutcome('completed'), {
      outcome: 'finish',
      warning: 'normalized legacy run outcome "completed" -> "finish"',
    });
  });

  it('infers continue for active non-terminal state', () => {
    assert.equal(inferRunOutcome({ active: true, current_phase: 'executing' }), 'continue');
  });

  it('infers terminal outcomes from terminal phases', () => {
    assert.equal(inferRunOutcome({ active: false, current_phase: 'complete' }), 'finish');
    assert.equal(inferRunOutcome({ active: false, current_phase: 'blocked_on_user' }), 'blocked_on_user');
    assert.equal(inferRunOutcome({ active: false, current_phase: 'failed' }), 'failed');
    assert.equal(inferRunOutcome({ active: false, current_phase: 'cancelled' }), 'cancelled');
  });

  it('clears stale completed_at for non-terminal progress', () => {
    const result = applyRunOutcomeContract({
      active: true,
      current_phase: 'executing',
      completed_at: '2026-04-18T00:00:00.000Z',
    });
    assert.equal(result.ok, true);
    assert.equal(result.state?.run_outcome, 'continue');
    assert.equal(result.state?.completed_at, undefined);
  });

  it('stamps completed_at for terminal outcomes and marks them inactive', () => {
    const result = applyRunOutcomeContract(
      {
        current_phase: 'blocked_on_user',
      },
      { nowIso: '2026-04-18T12:00:00.000Z' },
    );
    assert.equal(result.ok, true);
    assert.equal(result.state?.active, false);
    assert.equal(result.state?.run_outcome, 'blocked_on_user');
    assert.equal(result.state?.completed_at, '2026-04-18T12:00:00.000Z');
    assert.equal(isTerminalRunOutcome(result.state?.run_outcome as never), true);
  });

  it('rejects contradictory terminal/active combinations', () => {
    const result = applyRunOutcomeContract({
      active: true,
      run_outcome: 'failed',
    });
    assert.equal(result.ok, false);
    assert.match(result.error || '', /requires active=false/);
  });

  it('suppresses continuation when an explicit terminal run_outcome is present', () => {
    assert.equal(shouldContinueRun({
      active: true,
      current_phase: 'executing',
      run_outcome: 'blocked_on_user',
    }), false);
  });

  it('continues non-terminal runs when the outcome is continue', () => {
    assert.equal(shouldContinueRun({
      active: true,
      current_phase: 'executing',
      run_outcome: 'continue',
    }), true);
  });
});
