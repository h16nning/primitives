// plx-ci plan --mode <build|force|repro> [apps...]: the hashes, the look-up,
// the builders launched at once (ci.md, "Plan"), printed as the matrix the
// build jobs fan out over, with `kept` when an instance was kept. Takes the
// launch's environment (see `launch`). Writes matrix= and kept= to
// GITHUB_OUTPUT when that is set.
//
//   plx-ci --json plan --mode build
//   plx-ci plan --mode repro website
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { type Mode, plan, readHashes } from '../core/plan.ts';
import { contextOf } from '../program.ts';
import { launchOptionsFromEnv } from './launch.ts';
import { exoOf, githubOf } from './shared.ts';

export function register(program: Command): void {
  program
    .command('plan')
    .description('compute the build hashes, look them up in the registry, and launch one builder per image to build')
    .argument('[apps...]', 'the apps (default: every directory under apps/)')
    .requiredOption(
      '--mode <mode>',
      'build (skip what the registry holds), force (build all), repro (two no-cache builds per app)',
    )
    .option('--scope <scope>', 'the npm scope of the workspace packages', '@damage-ms')
    .option('-C, --dir <dir>', 'the checkout to read', '.')
    .action(async (apps: string[], opts: { mode: Mode; scope: string; dir: string }, command: Command) => {
      const ctx = contextOf(command);
      const dir = resolve(opts.dir);
      const github = githubOf(ctx);
      if (!github) throw new Error('RUNNER_TOKEN is empty');
      const all =
        apps.length > 0
          ? apps
          : (await ctx.readDir(`${dir}/apps`))
              .filter((e) => e.directory)
              .map((e) => e.name)
              .sort();
      const result = await plan(ctx, exoOf(ctx), github, {
        apps: all,
        mode: opts.mode,
        hashes: await readHashes(ctx, dir, opts.scope),
        launch: launchOptionsFromEnv(),
      });
      ctx.result(result, (r) => r.legs.map((l) => `${l.app} ${l.hash} ${l.label}`).join('\n'));
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(result.legs)}\nkept=${result.kept ?? ''}\n`);
    });
}
