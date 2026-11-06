import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@plexus-ms/lib';
import { fakeIo } from '../testing/fakeIo.ts';
import { startSidecars } from './registry.ts';

const november = new Date('2026-11-06T12:00:00Z');

test('where :5000 answers already, nothing is started and no key is needed', async () => {
  const commands: string[] = [];
  const io = fakeIo({}, undefined, {
    curl: (_cwd, args) => {
      commands.push(`curl ${args.at(-1)}`);
      return args.at(-1)?.includes(':5000/') ? '{}' : undefined;
    },
    docker: () => {
      commands.push('docker');
      return '';
    },
    exo: () => {
      commands.push('exo');
      return '';
    },
  });
  const sidecars = await startSidecars(new Context({}, io), undefined, 'damage-ms', 'de-fra-1', november);
  assert.deepEqual(sidecars, {
    current: 'damage-ms-ci-registry-2026-11',
    previous: 'damage-ms-ci-registry-2026-10',
    previousAnswers: false,
  });
  assert.deepEqual(commands, ['curl http://127.0.0.1:5000/v2/', 'curl http://127.0.0.1:5001/v2/']);
});

test('where nothing answers, the key is needed', async () => {
  const io = fakeIo({}, undefined, { curl: () => undefined });
  await assert.rejects(
    startSidecars(new Context({}, io), undefined, 'damage-ms', 'de-fra-1', november),
    /REGISTRY_ENDPOINT, REGISTRY_REGION, REGISTRY_ACCESS_KEY and REGISTRY_SECRET_KEY are needed/,
  );
});
