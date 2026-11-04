// Read a stalled instance (ci.md, the boot stall): start it (the launch stops
// a kept instance) or reboot it through the API, log in the moment sshd
// answers, mask the runner and the timers before cloud-init's commands start
// them (a rebooted instance would otherwise register, fail and delete itself
// within a minute), and copy the previous boot's logs to a directory here.
import { join } from 'node:path';
import type { Context } from '@plexus-ms/lib';
import { ExecError, run, UsageError, write } from '@plexus-ms/lib';
import { type Exo, sleep } from './exoscale.ts';

export interface InspectOptions {
  id: string;
  /** The private half of the key the instances get. */
  sshKey: string;
  /** Where the logs land; default ./inspect-<id>. */
  out?: string;
}

const LOGS: [string, string][] = [
  ['journal-previous-boot.log', 'sudo journalctl -b -1 --no-pager -o short-iso'],
  [
    'journal-previous-boot-network.log',
    'sudo journalctl -b -1 --no-pager -o short-iso -u systemd-networkd -u cloud-init-local -u cloud-init -u "ifup@*" -u networking -k',
  ],
  ['cloud-init.log', 'sudo cat /var/log/cloud-init.log'],
  ['cloud-init-output.log', 'sudo cat /var/log/cloud-init-output.log'],
  [
    'system.txt',
    'sudo journalctl --list-boots --no-pager; echo; cat /etc/cloud/cloud.cfg.d/*.cfg 2>/dev/null; echo; ls -la /etc/network/interfaces.d/ /etc/systemd/network/ /run/systemd/network/ 2>/dev/null; echo; cat /etc/network/interfaces.d/* /etc/systemd/network/* /run/systemd/network/* 2>/dev/null; echo; ip -br link; ip -br addr',
  ],
];

export function sshArgs(key: string, ip: string, command: string): string[] {
  return [
    '-i',
    key,
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=5',
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    '-o',
    'LogLevel=ERROR',
    `debian@${ip}`,
    command,
  ];
}

export async function inspect(ctx: Context, exo: Exo, options: InspectOptions): Promise<string> {
  const instance = await exo.instance(options.id);
  if (!instance) throw new UsageError(`no instance ${options.id} in ${exo.zone}`);
  if (!instance.publicIp) throw new UsageError(`instance ${options.id} has no public address`);
  const ip = instance.publicIp;
  const out = options.out ?? `inspect-${options.id}`;
  const ssh = (command: string) => ctx.read('ssh', sshArgs(options.sshKey, ip, command));
  ctx.say(`inspect: ${options.id} at ${ip}, state ${instance.state}`);
  if (instance.state === 'stopped') {
    ctx.say('inspect: starting (the launch stopped it when it kept it)');
    await exo.startInstance(options.id);
  } else {
    const before = await ssh('true').then(
      () => true,
      () => false,
    );
    ctx.say(
      before
        ? '  SSH answers before the reboot (not a stall?)'
        : '  no SSH before the reboot, as expected of a stalled boot',
    );
    ctx.say('inspect: rebooting');
    await exo.rebootInstance(options.id);
  }
  if (ctx.dryRun) {
    ctx.say(`  (then: wait for SSH, mask plexus-ci-runner and the timers, copy the previous boot's logs to ${out}/)`);
    return out;
  }
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await sleep(2000);
    reached = await ssh('true').then(
      () => true,
      () => false,
    );
  }
  if (!reached) throw new Error('no SSH after the reboot');
  ctx.say('inspect: in, masking the units');
  await ssh(
    'sudo systemctl mask --runtime --now plexus-ci-runner.service plexus-ci-no-job.timer plexus-ci-death.timer plexus-ci-poweroff.timer 2>&1 | tail -2; sudo systemctl stop plexus-ci-runner.service 2>/dev/null || true',
  );
  ctx.say('inspect: copying the logs');
  await ctx.apply([run('mkdir', ['-p', out])]);
  for (const [file, command] of LOGS) {
    let text: string;
    try {
      text = await ssh(command);
    } catch (error) {
      text = error instanceof ExecError ? `${error.message}\n` : String(error);
    }
    await ctx.apply([write(join(out, file), text)]);
  }
  ctx.say(`inspect: done; the instance ${options.id} is still running, delete it when finished`);
  return out;
}
