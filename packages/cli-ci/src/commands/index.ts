// Every command of plx-ci, in the order `plx-ci --help` lists them. Same rule
// as plx: a command module maps argv onto core/ and nothing more, and the
// logic, the planning and the tests live in core/.
import type { Command } from 'commander';
import { register as build } from './build.ts';
import { register as inspect } from './inspect.ts';
import { register as launch } from './launch.ts';
import { register as plan } from './plan.ts';
import { register as probe } from './probe.ts';
import { register as registry } from './registry.ts';
import { register as release } from './release.ts';
import { register as report } from './report.ts';
import { register as sweep } from './sweep.ts';
import { register as teardown } from './teardown.ts';
import { register as test } from './test.ts';

export const commands: ((program: Command) => void)[] = [
  plan,
  launch,
  build,
  test,
  release,
  report,
  teardown,
  sweep,
  registry,
  inspect,
  probe,
];
