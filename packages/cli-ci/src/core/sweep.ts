// Layer 5 (ci.md, "Instances"): delete every plexus-ci instance in the zone
// that is stopped or past its death deadline, say so by mail, and delete the
// registry bucket from two months ago (retention by rotation). Nothing of the
// sweep's is clever: an instance the other layers left behind is one that
// something else already failed on, so it goes, and the mail says it went.
import type { Context } from '@plexus-ms/lib';
import { type Exo, type Instance, Storage } from './exoscale.ts';
import { type Smtp, sendMail } from './mail.ts';
import type { ObjectStorage } from './registry.ts';
import { iso, registryBuckets } from './time.ts';

export interface SweepOptions {
  smtp?: Smtp;
  /** With the storage, the bucket from two months ago is deleted. */
  storage?: ObjectStorage;
  owner?: string;
  now?: Date;
}

export interface Sweep {
  removed: { name: string; reason: string }[];
  kept: string[];
  bucket?: string;
}

/** Why an instance goes, or undefined when it stays. */
export function reasonToRemove(instance: Instance, now: string): string | undefined {
  const reasons: string[] = [];
  if (instance.state === 'stopped') reasons.push('stopped');
  const deadline = instance.labels['death-deadline'];
  if (deadline && deadline < now) reasons.push(`past its deadline ${deadline}`);
  return reasons.length > 0 ? reasons.join(', ') : undefined;
}

export async function sweep(ctx: Context, exo: Exo, options: SweepOptions = {}): Promise<Sweep> {
  const now = options.now ?? new Date();
  const result: Sweep = { removed: [], kept: [] };
  for (const i of await exo.listInstances()) {
    if (i.labels['plexus-ci'] !== 'true') continue;
    const reason = reasonToRemove(i, iso(now));
    if (reason === undefined) {
      ctx.say(`${i.name} (${i.id}): ${i.state}, until ${i.labels['death-deadline'] ?? '-'}, kept`);
      result.kept.push(i.name);
      continue;
    }
    ctx.say(`${i.name} (${i.id}): ${reason}`);
    await exo.deleteInstance(i.id);
    result.removed.push({ name: i.name, reason });
  }
  if (result.removed.length > 0 && options.smtp) {
    const text = `The daily sweep removed ${result.removed.length} plexus-ci instance(s) in ${exo.zone} that the other layers left behind:\n\n${result.removed.map((r) => `${r.name} (${r.reason})`).join('\n')}\n`;
    await sendMail(ctx, options.smtp, 'plexus-ci: the sweep removed instances', text, now);
  }
  ctx.say(`sweep: ${result.removed.length} removed`);
  if (options.storage && options.owner) {
    const { expired } = registryBuckets(options.owner, now);
    const sos = new Storage(ctx, options.storage.accessKey, options.storage.secretKey);
    if (await sos.bucketExists(expired)) {
      ctx.say(`sweep: the registry bucket ${expired} is two months old`);
      await sos.removeBucket(expired);
      result.bucket = expired;
    }
  }
  return result;
}
