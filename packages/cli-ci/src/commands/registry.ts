// plx-ci registry: start the two registry sidecars on this machine (ci.md,
// "The registry"), creating this month's bucket when it is missing, or
// nothing where :5000 answers already (a runner host's pair); `exists`
// asks whether a tag is in either. From the environment: REGISTRY_ENDPOINT,
// REGISTRY_REGION, REGISTRY_ACCESS_KEY, REGISTRY_SECRET_KEY (the vault item
// bucket-registry), GITHUB_REPOSITORY (the owner names the buckets), ZONE.
//
//   plx-ci registry
//   plx-ci registry exists website build-0f2a3f35123dfd73      # exit 0 when it is, 1 otherwise
import type { Command } from 'commander';
import { startSidecars, storageFromEnv, tagExists } from '../core/registry.ts';
import { contextOf } from '../program.ts';
import { need, ownerOf, zoneOf } from './shared.ts';

export function register(program: Command): void {
  const registry = program
    .command('registry')
    .description(
      'start the registry sidecars: :5000 on this month’s bucket read-write, :5001 on the previous month’s read-only; nothing where :5000 answers',
    )
    .action(async (_opts: unknown, command: Command) => {
      const ctx = contextOf(command);
      const result = await startSidecars(ctx, storageFromEnv(), ownerOf(need('GITHUB_REPOSITORY')), zoneOf());
      ctx.result(
        result,
        (r) => `:5000 ${r.current}\n:5001 ${r.previous}${r.previousAnswers ? '' : ' (not answering)'}`,
      );
    });
  registry
    .command('exists')
    .description('exit 0 when either sidecar holds the tag')
    .argument('<app>')
    .argument('<tag>')
    .action(async (app: string, tag: string, _opts: unknown, command: Command) => {
      const ctx = contextOf(command);
      const port = await tagExists(ctx, app, tag);
      if (port === undefined) {
        ctx.say(`${app}:${tag} is in no registry here`);
        process.exitCode = 1;
      } else ctx.result(`${app}:${tag} in the registry on :${port}`);
    });
}
