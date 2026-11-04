import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashesOf, legsOf } from './plan.ts';

const dryRun = JSON.stringify({
  tasks: [
    { taskId: '@damage-ms/website#build', package: '@damage-ms/website', hash: '0f2a' },
    { taskId: '@damage-ms/website#test', package: '@damage-ms/website', hash: 'dc97' },
    { taskId: '@damage-ms/vernier-core#build', package: '@damage-ms/vernier-core', hash: '4b6a' },
    { taskId: '@damage-ms/vernier-app#build', package: '@damage-ms/vernier-app', hash: 'c51b' },
  ],
});

test('hashesOf keeps the build hashes of the scope’s packages', () => {
  assert.deepEqual(hashesOf(dryRun, '@damage-ms'), [
    { app: 'website', hash: '0f2a' },
    { app: 'vernier-core', hash: '4b6a' },
    { app: 'vernier-app', hash: 'c51b' },
  ]);
});

test('legsOf: one leg per app, two numbered ones in repro mode, and an unknown app is a usage error', () => {
  const hashes = hashesOf(dryRun, '@damage-ms');
  assert.deepEqual(legsOf(['website'], hashes, 'build', '41', '1'), [
    { app: 'website', hash: '0f2a', label: 'exo-build-41-website-1', n: 1 },
  ]);
  assert.deepEqual(
    legsOf(['vernier-app'], hashes, 'repro', '41', '2').map((l) => l.label),
    ['exo-build-41-vernier-app-2-1', 'exo-build-41-vernier-app-2-2'],
  );
  assert.throws(() => legsOf(['nope'], hashes, 'build', '41', '1'), /no build hash for nope/);
});
