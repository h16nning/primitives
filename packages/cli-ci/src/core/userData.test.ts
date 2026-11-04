import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BARE_USER_DATA, placeholders, RUNNER_USER_DATA, render } from './userData.ts';

test('the templates name their placeholders, digits included', () => {
  assert.ok(placeholders(RUNNER_USER_DATA).includes('RUNNER_SHA256'));
  assert.ok(placeholders(RUNNER_USER_DATA).includes('JITCONFIG'));
  assert.deepEqual(placeholders(BARE_USER_DATA), ['POWEROFF_MINUTES']);
});

test('render fills every placeholder and refuses a leftover', () => {
  const text = render(BARE_USER_DATA, { POWEROFF_MINUTES: '2' });
  assert.match(text, /OnBootSec=2min/);
  assert.equal(placeholders(text).length, 0);
  assert.throws(
    () => render(RUNNER_USER_DATA, { POWEROFF_MINUTES: '1' }),
    /a placeholder stayed in the user-data: .*LABEL/,
  );
});

test('the runner template is cloud-config that arms the timers first and runs the runner last', () => {
  assert.ok(RUNNER_USER_DATA.startsWith('#cloud-config'));
  const start = RUNNER_USER_DATA.indexOf('systemctl start plexus-ci-no-job.timer');
  const runner = RUNNER_USER_DATA.indexOf('systemctl start plexus-ci-runner.service');
  assert.ok(start > 0 && runner > start);
  assert.match(RUNNER_USER_DATA, /SELF_LAYERS=@@SELF_LAYERS@@/);
});
