// plx-ci inspect <id>: read a stalled instance, start or reboot it, mask the
// units, copy the previous boot's logs (ci.md, the boot stall). Needs the
// ci-launch key with start-instance and reboot-instance, and the private half
// of the key `runners`.
//
//   plx-ci inspect f99bfbd6-… --ssh-key ~/.ssh/deploy
import type { Command } from 'commander';
import { inspect } from '../core/inspect.ts';
import { contextOf } from '../program.ts';
import { exoOf } from './shared.ts';

export function register(program: Command): void {
  program
    .command('inspect')
    .description('start or reboot a kept instance, mask its runner and timers, and copy the previous boot’s logs here')
    .argument('<id>', 'the instance id')
    .option('--ssh-key <path>', 'the private half of the key the instances get', `${process.env.HOME}/.ssh/deploy`)
    .option('-o, --out <dir>', 'where the logs land (default: ./inspect-<id>)')
    .action(async (id: string, opts: { sshKey: string; out?: string }, command: Command) => {
      const ctx = contextOf(command);
      const out = await inspect(ctx, exoOf(ctx), { id, sshKey: opts.sshKey, out: opts.out });
      ctx.result(out);
    });
}
