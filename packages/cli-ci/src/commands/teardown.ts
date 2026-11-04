// plx-ci teardown: layer 3, delete what this run launched and the registrations
// nothing used (ci.md, "Instances"). From the environment: GITHUB_REPOSITORY,
// GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT; EXOSCALE_API_KEY/_SECRET (ci-launch);
// RUNNER_TOKEN, optional; KEEP_IDS, optional, instance ids left alone.
//
//   plx-ci teardown
//   plx-ci -n teardown      # what would go
import type { Command } from 'commander';
import { teardown } from '../core/teardown.ts';
import { contextOf } from '../program.ts';
import { exoOf, githubOf, runIdentity } from './shared.ts';

export function register(program: Command): void {
  program
    .command('teardown')
    .description(
      'delete every instance this run launched, kept ones excepted, and the runner registrations it never used',
    )
    .action(async (_opts: unknown, command: Command) => {
      const ctx = contextOf(command);
      const keep = (process.env.KEEP_IDS ?? '').split(/\s+/).filter(Boolean);
      const result = await teardown(ctx, exoOf(ctx), githubOf(ctx), runIdentity(), keep);
      ctx.result(result, (r) => [...r.instances, ...r.registrations.map((n) => `registration ${n}`)].join('\n'));
    });
}
