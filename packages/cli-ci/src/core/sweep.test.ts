import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Instance } from './exoscale.ts';
import { reasonToRemove } from './sweep.ts';

const at = (state: string, deadline?: string): Instance => ({
  id: 'x',
  name: 'x',
  state,
  createdAt: '2026-11-04T10:00:00Z',
  labels: { 'plexus-ci': 'true', ...(deadline ? { 'death-deadline': deadline } : {}) },
});

test('a stopped instance goes, a running one past its deadline goes, a running one before it stays', () => {
  const now = '2026-11-04T12:00:00Z';
  assert.equal(reasonToRemove(at('stopped', '2026-11-04T13:00:00Z'), now), 'stopped');
  assert.equal(reasonToRemove(at('running', '2026-11-04T11:00:00Z'), now), 'past its deadline 2026-11-04T11:00:00Z');
  assert.equal(
    reasonToRemove(at('stopped', '2026-11-04T11:00:00Z'), now),
    'stopped, past its deadline 2026-11-04T11:00:00Z',
  );
  assert.equal(reasonToRemove(at('running', '2026-11-04T13:00:00Z'), now), undefined);
  assert.equal(reasonToRemove(at('running'), now), undefined);
});
