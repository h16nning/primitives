import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashesOf, legsOf, testLegsOf } from './plan.ts';

const dryRun = JSON.stringify({
  tasks: [
    { taskId: '@damage-ms/website#build', package: '@damage-ms/website', hash: '0f2a', command: 'next build' },
    { taskId: '@damage-ms/website#test', package: '@damage-ms/website', hash: 'dc97', command: '<NONEXISTENT>' },
    { taskId: '@damage-ms/vernier-core#build', package: '@damage-ms/vernier-core', hash: '4b6a' },
    { taskId: '@damage-ms/vernier-app#build', package: '@damage-ms/vernier-app', hash: 'c51b', command: 'next build' },
    { taskId: '@damage-ms/vernier-app#test', package: '@damage-ms/vernier-app', hash: '5b05', command: 'pnpm test' },
    { taskId: '@other/x#build', package: '@other/x', hash: 'ffff', command: 'x' },
  ],
});

test('hashesOf keeps the build hashes of the scope’s packages, and the test hash where the script exists', () => {
  assert.deepEqual(hashesOf(dryRun, '@damage-ms'), [
    { app: 'website', hash: '0f2a' },
    { app: 'vernier-core', hash: '4b6a' },
    { app: 'vernier-app', hash: 'c51b', test: '5b05' },
  ]);
});

test('testLegsOf: one leg per app with a test task, carrying the build it tests', () => {
  assert.deepEqual(testLegsOf(['website', 'vernier-app'], hashesOf(dryRun, '@damage-ms'), '41', '1'), [
    { app: 'vernier-app', hash: '5b05', build: 'c51b', label: 'exo-test-41-vernier-app-1' },
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
