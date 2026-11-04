// plx-ci launch <kind> <label> [app]: one throwaway runner for one job (ci.md,
// "Instances"). From the environment: GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_RUN_ATTEMPT; RUNNER_TOKEN (Administration: write on the repo);
// EXOSCALE_API_KEY/_SECRET (ci-launch); SELF_DELETE_KEY/_SECRET; SELF_LAYERS;
// SMTP_* and MAIL_*, REGISTRY_* (optional); NO_JOB_MINUTES, DEATH_MINUTES,
// POWEROFF_MINUTES; INSTANCE_TYPE, ZONE, ONLINE_SECONDS, LAUNCH_TRIES,
// KEEP_MISSED, DIAG_SSH_KEY. Prints the instance id, label and creation time,
// and writes them to GITHUB_OUTPUT when that is set.
//
//   plx-ci launch build exo-build-<run>-website-1 website
//   plx-ci -n launch dummy exo-dummy-<run>-1
import { appendFileSync } from 'node:fs';
import type { Command } from 'commander';
import { DEFAULTS, type Kind, type LaunchOptions, launch } from '../core/launch.ts';
import { smtpFromEnv } from '../core/mail.ts';
import { storageFromEnv } from '../core/registry.ts';
import { contextOf } from '../program.ts';
import { exoOf, githubOf, need, runIdentity, zoneOf } from './shared.ts';

/** The launch options the environment carries; label, app and kind come from the arguments. */
export function launchOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Omit<LaunchOptions, 'label' | 'app' | 'kind'> {
  const minutes = (name: string) => Number(need(name, env));
  return {
    run: runIdentity(env),
    runnerToken: need('RUNNER_TOKEN', env),
    selfDelete: { key: need('SELF_DELETE_KEY', env), secret: need('SELF_DELETE_SECRET', env) },
    selfLayers: env.SELF_LAYERS === 'off' ? 'off' : 'on',
    deadlines: {
      noJobMinutes: minutes('NO_JOB_MINUTES'),
      deathMinutes: minutes('DEATH_MINUTES'),
      poweroffMinutes: minutes('POWEROFF_MINUTES'),
    },
    smtp: smtpFromEnv(env),
    registry: storageFromEnv(env),
    zone: zoneOf(env),
    instanceType: env.INSTANCE_TYPE || DEFAULTS.instanceType,
    template: env.TEMPLATE || DEFAULTS.template,
    diskSize: DEFAULTS.diskSize,
    securityGroup: DEFAULTS.securityGroup,
    sshKey: DEFAULTS.sshKey,
    onlineSeconds: Number(env.ONLINE_SECONDS || DEFAULTS.onlineSeconds),
    tries: Number(env.LAUNCH_TRIES || DEFAULTS.tries),
    keepMissed: env.KEEP_MISSED || undefined,
    diagSshKey: env.DIAG_SSH_KEY || undefined,
  };
}

export function register(program: Command): void {
  program
    .command('launch')
    .description('launch one throwaway runner for one job: JIT config, instance, wait until the runner is online')
    .argument('<kind>', 'build, test, dummy, or bare (the probe’s user-data)')
    .argument('<label>', 'the one runner label the job asks for')
    .argument('[app]', 'the app, for the instance’s labels')
    .action(async (kind: Kind, label: string, app: string | undefined, _opts: unknown, command: Command) => {
      const ctx = contextOf(command);
      const github = githubOf(ctx);
      if (!github) throw new Error('RUNNER_TOKEN is empty');
      const result = await launch(ctx, exoOf(ctx), github, { ...launchOptionsFromEnv(), kind, label, app });
      ctx.result(result, (r) => `${r.id} ${r.label} ${r.createdAt}`);
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          `id=${result.id}\nlabel=${result.label}\ncreated=${result.createdAt}\n`,
        );
    });
}
