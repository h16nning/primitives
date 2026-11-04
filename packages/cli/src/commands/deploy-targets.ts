// plx deploy-targets [inventory]: where the deploy verb reaches each app a
// platform repo operates, per environment (§ 3 PLX-Platform), as one JSON object.
//
// lib's `readDeployTargets` does the work; this file maps the argument and
// prints the map, the same JSON with or without --json, since the mount
// indexes it per matrix leg. `--environment` flattens it to one environment,
// app → target, which is the shape a deploy mount asks for.
//
//   plx deploy-targets                              # in a platform repo's root
//   plx deploy-targets --environment staging ../platform/inventory
import { resolve } from 'node:path';
import { readDeployTargets, targetsIn } from '@plexus-ms/lib';
import type { Command } from 'commander';
import { contextOf } from '../program.ts';

export function register(program: Command): void {
  program
    .command('deploy-targets')
    .description(
      'map each app of a platform repo, per environment, to the deploy target of the inventory file that declares it',
    )
    .argument('[inventory]', 'the inventory directory', 'inventory')
    .option('-e, --environment <name>', 'one environment only, as a flat app → target map')
    .action(async (inventory: string, opts: { environment?: string }, command: Command) => {
      const ctx = contextOf(command);
      const targets = await readDeployTargets(ctx, resolve(inventory));
      const result = opts.environment ? targetsIn(targets, opts.environment) : targets;
      ctx.result(result, (t) => JSON.stringify(t));
    });
}
