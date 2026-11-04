// Layer 3 (ci.md, "Instances"): the workflow's own teardown, run by a job that
// needs every job an instance was launched for and runs whatever they ended
// in. Deletes every plexus-ci instance in the zone that this run and attempt
// launched, except those kept for inspection, and removes the runner
// registrations those instances never used. The instance's own layers stay as
// they are: this is for the cases the workflow sees and they do not, a build
// that failed before the runner exited cleanly, a runner that never came online.
import type { Context } from '@plexus-ms/lib';
import type { Exo, Instance } from './exoscale.ts';
import type { GitHubRunners, Runner } from './github.ts';

export interface RunIdentity {
  /** `owner/repo`. */
  repo: string;
  runId: string;
  attempt: string;
}

/** The label `repo` carries, `owner-repo`. */
export const repoLabel = (repo: string): string => repo.replace('/', '-');

/** The instances this run and attempt launched, kept ones left out. */
export function selectRunInstances(instances: Instance[], run: RunIdentity, keep: string[] = []): Instance[] {
  return instances.filter(
    (i) =>
      i.labels['plexus-ci'] === 'true' &&
      i.labels.repo === repoLabel(run.repo) &&
      i.labels.run === run.runId &&
      i.labels.attempt === run.attempt &&
      !keep.includes(i.id),
  );
}

/** The registrations this run's launches minted: `exo-<kind>-<run>[-<app>…]-<attempt>[-<suffix>]`, not busy with a job. */
export function selectRunRegistrations(runners: Runner[], run: RunIdentity): Runner[] {
  const pattern = new RegExp(`^exo-[a-z]+-${run.runId}(-[^-]+)*-${run.attempt}(-[a-z0-9]+)?$`);
  return runners.filter((r) => !r.busy && pattern.test(r.name));
}

export interface Teardown {
  instances: string[];
  kept: string[];
  registrations: string[];
}

export async function teardown(
  ctx: Context,
  exo: Exo,
  github: GitHubRunners | undefined,
  run: RunIdentity,
  keep: string[] = [],
): Promise<Teardown> {
  const all = await exo.listInstances();
  const mine = selectRunInstances(all, run, keep);
  const kept = all.filter((i) => keep.includes(i.id)).map((i) => i.name);
  for (const name of kept) ctx.say(`${name}: kept for inspection`);
  for (const i of mine) {
    ctx.say(`${i.name} (${i.id}): ${i.state}`);
    await exo.deleteInstance(i.id);
  }
  ctx.say(`teardown: ${mine.length} instance(s) of run ${run.runId} attempt ${run.attempt}`);
  const registrations: string[] = [];
  if (github) {
    // A JIT registration stays listed when no job consumed it, online while
    // its instance is still going down and offline afterwards; GitHub refuses
    // to delete only one that is busy with a job.
    for (const r of selectRunRegistrations(await github.list(), run)) {
      ctx.say(`runner ${r.name} (${r.id}): ${r.status}`);
      await github.deleteRunner(r.id);
      registrations.push(r.name);
    }
    ctx.say(`teardown: ${registrations.length} registration(s) removed`);
  }
  return { instances: mine.map((i) => i.name), kept, registrations };
}
