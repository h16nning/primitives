// plx-ci probe: N bare boots, judged by an SSH login, tallied, deleted (ci.md,
// the boot stall). Needs the ci-launch key and the private half of the key
// `runners`; the security group has to allow SSH from here.
//
//   plx-ci probe -n 10 --keep
import type { Command } from 'commander';
import { DEFAULTS } from '../core/launch.ts';
import { probe } from '../core/probe.ts';
import { contextOf } from '../program.ts';
import { exoOf, zoneOf } from './shared.ts';

interface Opts {
  boots: string;
  template: string;
  type: string;
  wait: string;
  sshKey: string;
  keep?: boolean;
  plain?: boolean;
}

export function register(program: Command): void {
  program
    .command('probe')
    .description('boot bare instances and judge each by an SSH login; a failed one is kept with --keep')
    .option('--boots <n>', 'instances to boot at once', '10')
    .option('--template <name>', 'the template', DEFAULTS.template)
    .option('--type <type>', 'the instance type', DEFAULTS.instanceType)
    .option('--wait <seconds>', 'seconds to wait for the verdicts', '180')
    .option('--ssh-key <path>', 'the private half of the key the instances get', `${process.env.HOME}/.ssh/deploy`)
    .option('--keep', 'keep a failed instance for inspection')
    .option('--plain', 'send the user-data as plain base64 instead of gzip')
    .action(async (opts: Opts, command: Command) => {
      const ctx = contextOf(command);
      const boots = await probe(ctx, exoOf(ctx), {
        template: opts.template,
        instanceType: opts.type,
        zone: zoneOf(),
        boots: Number(opts.boots),
        waitSeconds: Number(opts.wait),
        sshKey: opts.sshKey,
        keep: opts.keep,
        plain: opts.plain,
      });
      ctx.result(boots, (b) => b.map((x) => `${x.name}: ${x.result}`).join('\n'));
      if (boots.some((b) => !b.ok)) process.exitCode = 1;
    });
}
