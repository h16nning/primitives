// plx-ci sweep: layer 5 (ci.md, "Instances"), delete every plexus-ci instance
// that is stopped or past its death deadline, mail about it, and delete the
// registry bucket from two months ago. From the environment:
// EXOSCALE_API_KEY/_SECRET (ci-launch); SMTP_*, MAIL_* (optional, else no
// mail); REGISTRY_ACCESS_KEY/_SECRET_KEY and GITHUB_REPOSITORY (optional,
// else no bucket rotation).
//
//   plx-ci sweep
//   plx-ci -n sweep      # lists, deletes nothing
import type { Command } from 'commander';
import { smtpFromEnv } from '../core/mail.ts';
import { storageFromEnv } from '../core/registry.ts';
import { sweep } from '../core/sweep.ts';
import { contextOf } from '../program.ts';
import { exoOf, ownerOf } from './shared.ts';

export function register(program: Command): void {
  program
    .command('sweep')
    .description(
      'delete every plexus-ci instance that is stopped or past its deadline, mail about it, rotate the registry buckets',
    )
    .action(async (_opts: unknown, command: Command) => {
      const ctx = contextOf(command);
      const repo = process.env.GITHUB_REPOSITORY;
      const result = await sweep(ctx, exoOf(ctx), {
        smtp: smtpFromEnv(),
        storage: storageFromEnv(),
        owner: repo ? ownerOf(repo) : undefined,
      });
      ctx.result(result, (r) =>
        [...r.removed.map((x) => `${x.name} (${x.reason})`), ...(r.bucket ? [`bucket ${r.bucket}`] : [])].join('\n'),
      );
    });
}
