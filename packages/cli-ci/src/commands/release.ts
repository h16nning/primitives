// plx-ci release <app> <build-hash> <sha> [--test <test-hash>]: copy the tested
// image from the sidecar to GHCR, or tag it there when it is there already
// (ci.md, "Release"). Needs the sidecars running here (`plx-ci registry`),
// crane on the PATH and logged in to GHCR. From the environment: IMAGE_PREFIX,
// where the images live (default ghcr.io/<owner of GITHUB_REPOSITORY>).
// Prints the image, and writes image= to GITHUB_OUTPUT when that is set.
//
//   plx-ci release website 0f2a3f35123dfd73 "$GITHUB_SHA"
//   plx-ci release vernier-app d135e9416e1cf4e8 "$GITHUB_SHA" --test 5b052598a4d84145
import { appendFileSync } from 'node:fs';
import type { Command } from 'commander';
import { release } from '../core/release.ts';
import { contextOf } from '../program.ts';
import { need, ownerOf } from './shared.ts';

export function register(program: Command): void {
  program
    .command('release')
    .description('copy one app’s tested image from the sidecar to GHCR as build-<hash>, test-<hash> and <sha>')
    .argument('<app>', 'the app')
    .argument('<build>', 'Turbo’s hash of the app’s build task')
    .argument('<sha>', 'the commit, a tag on the released image')
    .option('--test <hash>', 'Turbo’s hash of the app’s test task; the image is read from test-<hash>')
    .action(async (app: string, build: string, sha: string, opts: { test?: string }, command: Command) => {
      const ctx = contextOf(command);
      const prefix = process.env.IMAGE_PREFIX || `ghcr.io/${ownerOf(need('GITHUB_REPOSITORY'))}`;
      const result = await release(ctx, { app, build, test: opts.test || undefined, sha, prefix });
      ctx.result(result, (r) => `${r.image}:${sha}${r.copied ? '' : ' (was there)'}`);
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `image=${result.image}:${sha}\n`);
    });
}
