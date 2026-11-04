// Launch one throwaway CI runner for one job (ci.md, "Instances"): a JIT
// config from GitHub, the raw create-instance call with the labels the sweep
// and the teardown read, user-data that arms the teardown layers first, then a
// wait for the runner to show online, since a boot that stalls arms no timer
// and would leave the job queued for 24 hours. A miss deletes the instance and
// creates one more with the same JIT config, which a runner that never
// connected has not consumed; `tries` misses fail the launch. The first miss
// of a run can be kept and stopped for inspection instead (keepMissed).
import { gzipSync } from 'node:zlib';
import type { Context } from '@plexus-ms/lib';
import { ExecError, run, UsageError } from '@plexus-ms/lib';
import { type CreateInstance, type Exo, sleep } from './exoscale.ts';
import type { GitHubRunners } from './github.ts';
import type { Smtp } from './mail.ts';
import type { ObjectStorage } from './registry.ts';
import { type RunIdentity, repoLabel } from './teardown.ts';
import { deadline, iso, registryBuckets } from './time.ts';
import { BARE_USER_DATA, RUNNER_USER_DATA, render } from './userData.ts';

export type Kind = 'build' | 'test' | 'dummy' | 'bare';

/** What a runner's user-data is told (the launch's environment, ci.md). */
export interface Deadlines {
  noJobMinutes: number;
  deathMinutes: number;
  poweroffMinutes: number;
}

export interface LaunchOptions {
  kind: Kind;
  label: string;
  app?: string;
  run: RunIdentity;
  runnerToken: string;
  selfDelete: { key: string; secret: string };
  /** `off` disarms layers 1, 1b and 2b on the instance while the boot stall is read. */
  selfLayers: 'on' | 'off';
  deadlines: Deadlines;
  smtp?: Smtp;
  registry?: ObjectStorage;
  zone: string;
  instanceType: string;
  template: string;
  diskSize: number;
  securityGroup: string;
  sshKey: string;
  /** Seconds to wait for the runner to show online. */
  onlineSeconds: number;
  /** Instances tried before the launch gives up. */
  tries: number;
  /** A file: the first missed instance of the run is kept, stopped, and its id written there. */
  keepMissed?: string;
  /** The private half of the key the instances get, for a diagnosis over SSH before a missed instance is deleted. */
  diagSshKey?: string;
  now?: () => Date;
}

export const DEFAULTS = {
  zone: 'de-fra-1',
  instanceType: 'cpu.extra-large',
  template: 'Linux Debian 13 (Trixie) 64-bit',
  diskSize: 100,
  securityGroup: 'runners',
  sshKey: 'runners',
  onlineSeconds: 120,
  tries: 2,
  runnerVersion: '2.338.2',
  runnerSha256: 'baebf204307bac6193480852732f0aba2ae97b6c5597c244f4d5558390147c40',
  exoVersion: '1.103.2',
  /** What the API accepts, base64 characters. */
  userDataLimit: 32768,
} as const;

export interface Launch {
  id: string;
  label: string;
  createdAt: string;
  noJobDeadline: string;
  deathDeadline: string;
  /** Instances created, the last one being the launched one. */
  tries: number;
  /** The id of a missed instance kept for inspection. */
  kept?: string;
}

/** The runner's user-data for one launch, rendered: the values written as they are. */
export function renderUserData(options: LaunchOptions, jitconfig: string, now: Date): string {
  if (options.kind === 'bare')
    return render(BARE_USER_DATA, { POWEROFF_MINUTES: String(options.deadlines.poweroffMinutes) });
  const owner = options.run.repo.split('/')[0] ?? options.run.repo;
  const buckets = registryBuckets(owner, now);
  return render(RUNNER_USER_DATA, {
    POWEROFF_MINUTES: String(options.deadlines.poweroffMinutes),
    NO_JOB_MINUTES: String(options.deadlines.noJobMinutes),
    DEATH_MINUTES: String(options.deadlines.deathMinutes),
    ZONE: options.zone,
    LABEL: options.label,
    KIND: options.kind,
    APP: options.app ?? '',
    REPO: options.run.repo,
    RUN: options.run.runId,
    RUNNER_VERSION: DEFAULTS.runnerVersion,
    RUNNER_SHA256: DEFAULTS.runnerSha256,
    EXO_VERSION: DEFAULTS.exoVersion,
    JITCONFIG: jitconfig,
    SELF_DELETE_KEY: options.selfDelete.key,
    SELF_DELETE_SECRET: options.selfDelete.secret,
    SELF_LAYERS: options.selfLayers,
    SMTP_HOST: options.smtp?.host ?? '',
    SMTP_PORT: options.smtp?.port ?? '',
    SMTP_USER: options.smtp?.user ?? '',
    SMTP_PASSWORD: options.smtp?.password ?? '',
    MAIL_FROM: options.smtp?.from ?? '',
    MAIL_TO: options.smtp?.to ?? '',
    REGISTRY_ENDPOINT: options.registry?.endpoint ?? '',
    REGISTRY_REGION: options.registry?.region ?? '',
    REGISTRY_BUCKET: buckets.current,
    REGISTRY_PREVIOUS_BUCKET: buckets.previous,
    REGISTRY_ACCESS_KEY: options.registry?.accessKey ?? '',
    REGISTRY_SECRET_KEY: options.registry?.secretKey ?? '',
  });
}

/** gzip, then base64: plain base64 boots as well (ci.md), gzip is smaller. */
export function encodeUserData(text: string): string {
  const encoded = gzipSync(Buffer.from(text), { level: 9 }).toString('base64');
  if (encoded.length > DEFAULTS.userDataLimit)
    throw new UsageError(`user-data too large: ${encoded.length} bytes base64, ${DEFAULTS.userDataLimit} allowed`);
  return encoded;
}

/** The labels the sweep and the teardown read. */
export function instanceLabels(
  options: LaunchOptions,
  noJobDeadline: string,
  deathDeadline: string,
): Record<string, string> {
  return {
    'plexus-ci': 'true',
    repo: repoLabel(options.run.repo),
    run: options.run.runId,
    attempt: options.run.attempt,
    app: options.app || 'none',
    kind: options.kind,
    'no-job-deadline': noJobDeadline,
    'death-deadline': deathDeadline,
  };
}

export async function launch(ctx: Context, exo: Exo, github: GitHubRunners, options: LaunchOptions): Promise<Launch> {
  const now = options.now ?? (() => new Date());
  const { label, kind } = options;
  if (options.deadlines.poweroffMinutes <= options.deadlines.deathMinutes)
    throw new UsageError('the power-off must come after the death deadline');
  const t0 = now();
  const noJobDeadline = deadline(t0, options.deadlines.noJobMinutes);
  const deathDeadline = deadline(t0, options.deadlines.deathMinutes);

  // One JIT config registers one runner for exactly one job; the runner exits
  // after it, which is what layer 1 keys on. If no instance comes to claim
  // it, the registration is removed again instead of lingering offline.
  const registration = kind === 'bare' ? undefined : await github.generateJitConfig(label, label);
  const jitconfig = registration?.encodedJitConfig ?? '<jitconfig>';
  const unregister = async () => {
    if (!registration) return;
    ctx.say(`launch failed, removing the runner registration ${label} (${registration.runnerId})`);
    await github.deleteRunner(registration.runnerId).catch(() => undefined);
  };

  try {
    const userData = encodeUserData(renderUserData(options, jitconfig, t0));
    const [templateId, instanceTypeId, securityGroupId] = await Promise.all([
      exo.templateId(options.template),
      exo.instanceTypeId(options.instanceType),
      exo.securityGroupId(options.securityGroup),
    ]);
    const request: CreateInstance = {
      name: label,
      templateId,
      instanceTypeId,
      securityGroupId,
      sshKey: options.sshKey,
      diskSize: options.diskSize,
      userDataBase64: userData,
      labels: instanceLabels(options, noJobDeadline, deathDeadline),
    };
    const result: Launch = { id: '<instance-id>', label, createdAt: iso(t0), noJobDeadline, deathDeadline, tries: 0 };
    ctx.say(`→ creating ${label} (${options.instanceType}, ${options.zone})`);
    for (let attempt = 1; attempt <= options.tries; attempt++) {
      const operation = await exo.createInstance(request);
      result.tries = attempt;
      if (operation === undefined) {
        ctx.say(
          `  (then: wait up to ${options.onlineSeconds}s for the runner to show online, replace the instance on a miss)`,
        );
        return result;
      }
      if (!operation.reference) throw new Error(`create-instance returned no instance: ${JSON.stringify(operation)}`);
      result.id = operation.reference;
      result.createdAt = iso(now());
      const state = await exo.waitOperation(operation.id);
      if (state !== 'success') throw new Error(`create-instance ended in state ${state}`);
      ctx.say(`created ${label} (${result.id}) in ${options.zone}, try ${attempt}`);
      if (kind === 'bare') return result;

      const waited = await waitOnline(github, label, options.onlineSeconds);
      if (waited !== undefined) {
        ctx.say(`runner ${label} online after ${waited}s`);
        ctx.say(
          `launched ${label} (${result.id}): no job by ${noJobDeadline}, dies at ${deathDeadline}, powers off ${options.deadlines.poweroffMinutes} minutes after creation`,
        );
        return result;
      }
      ctx.say(`✗ ${label} (${result.id}) did not come online within ${options.onlineSeconds}s`);
      if (options.diagSshKey) await diagnose(ctx, exo, result.id, options.diagSshKey);
      if (options.keepMissed && (await keep(ctx, options.keepMissed, result.id))) {
        // Stopped at once, so that a boot that merely runs late cannot start
        // the runner, fail on the consumed JIT config and delete itself.
        await exo
          .stopInstance(result.id)
          .catch(() => ctx.say('  stop-instance refused; the instance may delete itself'));
        ctx.say(`kept ${label} (${result.id}) for inspection, stopped; run plx-ci inspect ${result.id}`);
        result.kept = result.id;
      } else {
        ctx.say(`deleting ${label} (${result.id})`);
        await exo.deleteInstance(result.id).catch(() => ctx.say(`  delete of ${result.id} failed`));
      }
    }
    await unregister();
    throw new Error(`${options.tries} instance(s) of ${label} failed to boot, giving up`);
  } catch (error) {
    if (!(error instanceof Error && error.message.endsWith('giving up'))) await unregister();
    throw error;
  }
}

/** Seconds until the runner showed online, or undefined after `seconds`. */
async function waitOnline(github: GitHubRunners, label: string, seconds: number): Promise<number | undefined> {
  for (let waited = 0; waited < seconds; waited += 5) {
    await sleep(5000);
    if ((await github.status(label)) === 'online') return waited + 5;
  }
  return undefined;
}

/** The first miss of a run is kept: the id goes into the file only when no other launch wrote it first. */
async function keep(ctx: Context, file: string, id: string): Promise<boolean> {
  try {
    await ctx.stage(run('sh', ['-c', 'set -C && echo "$1" > "$2"', 'keep', id, file]));
    return true;
  } catch (error) {
    if (error instanceof ExecError) return false;
    throw error;
  }
}

/** While the security group allows SSH (the trial), say what a missed instance was doing before it goes. */
async function diagnose(ctx: Context, exo: Exo, id: string, sshKey: string): Promise<void> {
  const ip = (await exo.instance(id))?.publicIp;
  ctx.say(`diagnosis of ${id} at ${ip ?? 'no ip'}:`);
  if (!ip) return;
  try {
    const out = await ctx.read('ssh', [
      '-i',
      sshKey,
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'UserKnownHostsFile=/dev/null',
      '-o',
      'LogLevel=ERROR',
      `debian@${ip}`,
      'sudo cloud-init status --long 2>&1 | head -5; echo "-- runner unit"; sudo systemctl is-active plexus-ci-runner; sudo journalctl -u plexus-ci-runner --no-pager -o short-iso | tail -15; echo "-- plexus-ci"; sudo journalctl -t plexus-ci --no-pager -o short-iso | tail -5',
    ]);
    ctx.say(out.replace(/^/gm, '    '));
  } catch (error) {
    ctx.say(`    no SSH to ${ip}: ${error instanceof ExecError ? error.stderr.trim() : String(error)}`);
  }
}
