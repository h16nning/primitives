// plx-ci build <app> <hash> <sha> [tag...]: one app's image from its pruned
// context, with the sidecars as cache, pushed as build-<hash>, <sha> and the
// extra tags (ci.md, "Build"). From the environment:
// NEXT_SERVER_ACTIONS_ENCRYPTION_KEY (the app's fixed key), NO_CACHE=1 for a
// build from scratch, BUILDX_BUILDER (default ci). Prints the digest, and
// writes it to GITHUB_OUTPUT when that is set.
//
//   plx-ci build website 0f2a3f35123dfd73 "$GITHUB_SHA"
//   NO_CACHE=1 plx-ci build website 0f2a3f35123dfd73 "$GITHUB_SHA" repro-<run>-1
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command } from 'commander';
import { build } from '../core/build.ts';
import { contextOf } from '../program.ts';

export function register(program: Command): void {
  program
    .command('build')
    .description('build one app’s image from its pruned context against the registry sidecars and push it')
    .argument('<app>', 'the app, apps/<app> in the checkout')
    .argument('<hash>', 'Turbo’s hash of the app’s build task')
    .argument('<sha>', 'the commit, a second tag')
    .argument('[tags...]', 'further tags on the same image')
    .option('--scope <scope>', 'the npm scope of the workspace packages', '@damage-ms')
    .option('-C, --dir <dir>', 'the checkout to read', '.')
    .action(
      async (
        app: string,
        hash: string,
        sha: string,
        tags: string[],
        opts: { scope: string; dir: string },
        command: Command,
      ) => {
        const ctx = contextOf(command);
        const result = await build(ctx, {
          app,
          hash,
          sha,
          tags,
          encryptionKey: process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ?? '',
          noCache: process.env.NO_CACHE === '1',
          dir: resolve(opts.dir),
          scope: opts.scope,
          builder: process.env.BUILDX_BUILDER,
        });
        ctx.result(result, (r) => r.digest ?? '');
        if (process.env.GITHUB_OUTPUT && result.digest)
          appendFileSync(process.env.GITHUB_OUTPUT, `digest=${result.digest}\n`);
      },
    );
}
