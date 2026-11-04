import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@plexus-ms/lib';
import { fakeIo } from '../testing/fakeIo.ts';
import { imageName, release } from './release.ts';

test('the image name is the lower-cased prefix and the app', () => {
  assert.equal(imageName('ghcr.io/Damage-MS/', 'website'), 'ghcr.io/damage-ms/website');
});

test('a release copies the tested manifest when GHCR lacks it, and only tags when it is there', async () => {
  const calls: string[][] = [];
  const io = (there: boolean) =>
    fakeIo({}, undefined, {
      crane: (_cwd, args) => {
        calls.push(args);
        if (args[0] === 'digest') return there ? 'sha256:abc' : undefined;
        return '';
      },
      curl: (_cwd, args) => (args.at(-1)?.includes(':5000/') ? '200' : '404'),
    });
  const options = { app: 'vernier-app', build: 'b1', test: 't1', sha: 'deadbeef', prefix: 'ghcr.io/damage-ms' };

  const copied = await release(new Context({}, io(false)), options);
  assert.equal(copied.copied, true);
  assert.deepEqual(copied.tags, ['build-b1', 'deadbeef', 'test-t1']);
  assert.deepEqual(
    calls.filter((c) => c[0] !== 'digest'),
    [
      ['copy', '--insecure', 'localhost:5000/vernier-app:test-t1', 'ghcr.io/damage-ms/vernier-app:build-b1'],
      ['tag', 'ghcr.io/damage-ms/vernier-app:build-b1', 'deadbeef'],
      ['tag', 'ghcr.io/damage-ms/vernier-app:build-b1', 'test-t1'],
    ],
  );

  calls.length = 0;
  const tagged = await release(new Context({}, io(true)), { ...options, test: undefined });
  assert.equal(tagged.copied, false);
  assert.deepEqual(
    calls.filter((c) => c[0] !== 'digest'),
    [['tag', 'ghcr.io/damage-ms/vernier-app:build-b1', 'deadbeef']],
  );
});

test('a release without the tested tag in the sidecar is an error', async () => {
  const io = fakeIo({}, undefined, {
    crane: (_cwd, args) => (args[0] === 'digest' ? undefined : ''),
    curl: () => '404',
  });
  await assert.rejects(
    release(new Context({}, io), { app: 'a', build: 'b', test: 't', sha: 's', prefix: 'ghcr.io/o' }),
    /a:test-t is in no registry here; the tests did not pass/,
  );
});
