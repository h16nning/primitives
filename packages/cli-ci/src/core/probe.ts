// The boot probe (ci.md, the boot stall): N bare instances through the same
// create call as a launch, each judged by an SSH login as debian with the key
// the instances get, the outcome tallied, the instance deleted, or kept when
// it failed and `keep` is set.
import type { Context } from '@plexus-ms/lib';
import { type CreateInstance, type Exo, sleep } from './exoscale.ts';
import { sshArgs } from './inspect.ts';
import { DEFAULTS, encodeUserData } from './launch.ts';
import { deadline, iso } from './time.ts';
import { BARE_USER_DATA, render } from './userData.ts';

export interface ProbeOptions {
  template: string;
  instanceType: string;
  zone: string;
  boots: number;
  waitSeconds: number;
  sshKey: string;
  keep?: boolean;
  /** Plain base64 instead of gzip, the encoding once blamed for the stall. */
  plain?: boolean;
  now?: () => Date;
}

export interface Boot {
  name: string;
  id?: string;
  ip?: string;
  /** Seconds to the first login, or the failure. */
  result: string;
  ok: boolean;
}

export async function probe(ctx: Context, exo: Exo, options: ProbeOptions): Promise<Boot[]> {
  const now = options.now ?? (() => new Date());
  const [templateId, instanceTypeId, securityGroupId] = await Promise.all([
    exo.templateId(options.template),
    exo.instanceTypeId(options.instanceType),
    exo.securityGroupId(DEFAULTS.securityGroup),
  ]);
  const text = render(BARE_USER_DATA, { POWEROFF_MINUTES: '60' });
  const userData = options.plain ? Buffer.from(text).toString('base64') : encodeUserData(text);
  const boots: Boot[] = [];
  const started = now();
  for (let i = 1; i <= options.boots; i++) {
    const name = `probe-${iso(now()).slice(11, 19).replaceAll(':', '')}-${i}`;
    const request: CreateInstance = {
      name,
      templateId,
      instanceTypeId,
      securityGroupId,
      sshKey: DEFAULTS.sshKey,
      diskSize: 50,
      userDataBase64: userData,
      labels: { 'plexus-ci': 'true', kind: 'probe', 'death-deadline': deadline(now(), 90) },
    };
    const op = await exo.createInstance(request);
    boots.push({ name, id: op?.reference, result: op ? 'pending' : 'dry run', ok: false });
  }
  if (ctx.dryRun) return boots;
  // Poll until every boot has a verdict or the wait is up.
  const pending = () => boots.filter((b) => b.result === 'pending');
  while (pending().length > 0 && (now().getTime() - started.getTime()) / 1000 < options.waitSeconds) {
    const instances = await exo.listInstances();
    for (const b of pending()) {
      const i = instances.find((x) => x.id === b.id);
      if (!i?.publicIp) continue;
      b.ip = i.publicIp;
      const ok = await ctx.read('ssh', sshArgs(options.sshKey, i.publicIp, 'true')).then(
        () => true,
        () => false,
      );
      if (ok) {
        b.result = `ok ${Math.round((now().getTime() - started.getTime()) / 1000)}s`;
        b.ok = true;
      }
    }
    if (pending().length > 0) await sleep(10000);
  }
  for (const b of boots) {
    if (b.result === 'pending') b.result = b.ip ? 'unreachable' : 'no ip';
    ctx.say(
      `${options.template} ${options.instanceType} boot ${b.name} (${b.id ?? 'no id'}, ${b.ip ?? 'no ip'}): ${b.result}`,
    );
    if (b.id && (b.ok || !options.keep)) await exo.deleteInstance(b.id);
    else if (b.id) ctx.say(`  kept ${b.name} for inspection`);
  }
  const ok = boots.filter((b) => b.ok).length;
  ctx.say(
    `== ${options.template} on ${options.instanceType}: ${ok} ok, ${boots.length - ok} failed of ${boots.length}`,
  );
  return boots;
}
