import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@plexus-ms/lib';
import { fakeIo } from '../testing/fakeIo.ts';
import { Exo } from './exoscale.ts';
import { GitHubRunners } from './github.ts';
import { DEFAULTS, encodeUserData, instanceLabels, type LaunchOptions, launch, renderUserData } from './launch.ts';

const now = new Date('2026-11-04T10:40:27Z');
const options: LaunchOptions = {
  kind: 'build',
  label: 'exo-build-41-website-1',
  app: 'website',
  run: { repo: 'damage-ms/web', runId: '41', attempt: '1' },
  runnerToken: 'ghs_x',
  selfDelete: { key: 'EXOsd', secret: 'sd' },
  selfLayers: 'off',
  deadlines: { noJobMinutes: 10, deathMinutes: 45, poweroffMinutes: 50 },
  zone: 'de-fra-1',
  instanceType: 'cpu.extra-large',
  template: DEFAULTS.template,
  diskSize: 100,
  securityGroup: 'runners',
  sshKey: 'runners',
  onlineSeconds: 5,
  tries: 2,
  now: () => now,
};

test('the user-data is rendered with the run’s facts and the month’s buckets, and fits the API', () => {
  const text = renderUserData(options, 'JIT', now);
  assert.match(text, /^hostname: exo-build-41-website-1$/m);
  assert.match(text, /REGISTRY_BUCKET=damage-ms-ci-registry-2026-11/);
  assert.match(text, /REGISTRY_PREVIOUS_BUCKET=damage-ms-ci-registry-2026-10/);
  assert.match(text, /SELF_LAYERS=off/);
  assert.match(text, /content: "JIT"/);
  assert.ok(encodeUserData(text).length < DEFAULTS.userDataLimit);
  assert.match(renderUserData({ ...options, kind: 'bare' }, '', now), /OnBootSec=50min/);
});

test('the labels carry what the sweep and the teardown read', () => {
  assert.deepEqual(instanceLabels(options, '2026-11-04T10:50:27Z', '2026-11-04T11:25:27Z'), {
    'plexus-ci': 'true',
    repo: 'damage-ms-web',
    run: '41',
    attempt: '1',
    app: 'website',
    kind: 'build',
    'no-job-deadline': '2026-11-04T10:50:27Z',
    'death-deadline': '2026-11-04T11:25:27Z',
  });
});

test('launch: JIT config, three lookups, create, wait, online; the instance id comes back', async () => {
  const calls: string[] = [];
  const io = fakeIo({}, () => undefined, {
    curl: (_cwd, _args, input = '') => {
      calls.push(`curl ${input.match(/request = "(\w+)"/)?.[1]} ${input.match(/url = "([^"]+)"/)?.[1]}`);
      if (input.includes('generate-jitconfig')) return JSON.stringify({ encoded_jit_config: 'JIT', runner: { id: 7 } });
      return JSON.stringify({ runners: [{ id: 7, name: 'exo-build-41-website-1', status: 'online', busy: false }] });
    },
    exo: (_cwd, args, input) => {
      calls.push(`exo ${args[1]}`);
      switch (args[1]) {
        case 'list-templates':
          return JSON.stringify({ templates: [{ id: 't1', name: DEFAULTS.template, visibility: 'public' }] });
        case 'list-instance-types':
          return JSON.stringify({ 'instance-types': [{ id: 'i1', family: 'cpu', size: 'extra-large' }] });
        case 'list-security-groups':
          return JSON.stringify({ 'security-groups': [{ id: 'g1', name: 'runners' }] });
        case 'create-instance': {
          const body = JSON.parse(input ?? '{}') as { name: string; labels: Record<string, string> };
          assert.equal(body.name, 'exo-build-41-website-1');
          assert.equal(body.labels.app, 'website');
          return JSON.stringify({ id: 'op1', state: 'pending', reference: { id: 'inst1' } });
        }
        case 'get-operation':
          return JSON.stringify({ id: 'op1', state: 'success' });
      }
      return undefined;
    },
  });
  const ctx = new Context({}, io);
  const result = await launch(ctx, new Exo(ctx, 'de-fra-1'), new GitHubRunners(ctx, 'damage-ms/web', 'ghs_x'), options);
  assert.equal(result.id, 'inst1');
  assert.equal(result.tries, 1);
  assert.equal(result.noJobDeadline, '2026-11-04T10:50:27Z');
  assert.deepEqual(calls.slice(0, 5), [
    'curl POST https://api.github.com/repos/damage-ms/web/actions/runners/generate-jitconfig',
    'exo list-templates',
    'exo list-instance-types',
    'exo list-security-groups',
    'exo create-instance',
  ]);
  assert.ok(calls.includes('exo get-operation'));
  assert.ok(calls.some((c) => c.startsWith('curl GET') && c.includes('name=exo-build-41-website-1')));
});

test('launch under --dry-run performs nothing and reports the placeholder id', async () => {
  const io = fakeIo({}, () => undefined, {
    exo: (_cwd, args) => {
      switch (args[1]) {
        case 'list-templates':
          return JSON.stringify({ templates: [{ id: 't1', name: DEFAULTS.template, visibility: 'public' }] });
        case 'list-instance-types':
          return JSON.stringify({ 'instance-types': [{ id: 'i1', family: 'cpu', size: 'extra-large' }] });
        case 'list-security-groups':
          return JSON.stringify({ 'security-groups': [{ id: 'g1', name: 'runners' }] });
      }
      throw new Error(`an effect ran under --dry-run: exo ${args[1]}`);
    },
    curl: () => {
      throw new Error('an effect ran under --dry-run: curl');
    },
  });
  const ctx = new Context({ dryRun: true }, io);
  const result = await launch(ctx, new Exo(ctx, 'de-fra-1'), new GitHubRunners(ctx, 'damage-ms/web', 'ghs_x'), options);
  assert.equal(result.id, '<instance-id>');
});
