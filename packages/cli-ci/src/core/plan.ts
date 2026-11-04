// The plan of a build run (ci.md, "Plan"): for every app, the build hash from
// one Turbo dry run, a look-up in the registry, and one builder per app whose
// image is missing (two without cache in repro mode), launched at once. The
// result is the matrix the build jobs fan out over, and the id of an instance
// kept for inspection, if any.
import type { Context } from '@plexus-ms/lib';
import { UsageError } from '@plexus-ms/lib';
import type { Exo } from './exoscale.ts';
import type { GitHubRunners } from './github.ts';
import { type LaunchOptions, launch } from './launch.ts';
import { digest, layers, tagExists } from './registry.ts';

export type Mode = 'build' | 'force' | 'repro';

export interface Hash {
  app: string;
  hash: string;
}

/** The build hashes from Turbo's dry run (`turbo run build --dry-run=json`), per app package. */
export function hashesOf(dryRun: string, scope: string): Hash[] {
  const data = JSON.parse(dryRun) as { tasks?: { taskId: string; package: string; hash: string }[] };
  return (data.tasks ?? [])
    .filter((t) => t.taskId.endsWith('#build') && t.package.startsWith(`${scope}/`))
    .map((t) => ({ app: t.package.slice(scope.length + 1), hash: t.hash }));
}

export async function readHashes(ctx: Context, dir: string, scope: string): Promise<Hash[]> {
  const pkg = JSON.parse(await ctx.readFile(`${dir}/package.json`)) as { devDependencies?: Record<string, string> };
  const turbo = pkg.devDependencies?.turbo ?? 'latest';
  const out = await ctx.read('npx', ['--yes', `turbo@${turbo}`, 'run', 'build', '--dry-run=json'], { cwd: dir });
  return hashesOf(out, scope);
}

export interface Leg {
  app: string;
  hash: string;
  label: string;
  n: number;
}

/** The legs a mode asks for, before the registry is consulted. */
export function legsOf(apps: string[], hashes: Hash[], mode: Mode, runId: string, attempt: string): Leg[] {
  return apps.flatMap((app) => {
    const hash = hashes.find((h) => h.app === app)?.hash;
    if (!hash) throw new UsageError(`no build hash for ${app}; is it an app package of the workspace?`);
    const copies = mode === 'repro' ? 2 : 1;
    return Array.from({ length: copies }, (_, i) => {
      const n = i + 1;
      const base = `exo-build-${runId}-${app}-${attempt}`;
      return { app, hash, label: mode === 'repro' ? `${base}-${n}` : base, n };
    });
  });
}

export interface Plan {
  legs: Leg[];
  skipped: { app: string; hash: string; port: number }[];
  kept?: string;
}

export interface PlanOptions {
  apps: string[];
  mode: Mode;
  hashes: Hash[];
  /** The launch options every leg shares; label and app are set per leg. */
  launch: Omit<LaunchOptions, 'label' | 'app' | 'kind'>;
}

export async function plan(ctx: Context, exo: Exo, github: GitHubRunners, options: PlanOptions): Promise<Plan> {
  const result: Plan = { legs: [], skipped: [] };
  const wanted: Leg[] = [];
  for (const leg of legsOf(
    options.apps,
    options.hashes,
    options.mode,
    options.launch.run.runId,
    options.launch.run.attempt,
  )) {
    if (options.mode === 'build') {
      const port = await tagExists(ctx, leg.app, `build-${leg.hash}`);
      if (port !== undefined) {
        ctx.say(`${leg.app}: build-${leg.hash} exists in the registry on :${port}, nothing to build`);
        result.skipped.push({ app: leg.app, hash: leg.hash, port });
        continue;
      }
    }
    wanted.push(leg);
  }
  // At once: each launch waits for its runner, and the waits overlap.
  const launches = await Promise.allSettled(
    wanted.map((leg) => launch(ctx, exo, github, { ...options.launch, kind: 'build', label: leg.label, app: leg.app })),
  );
  const failed = launches.filter((l) => l.status === 'rejected');
  for (const l of launches) if (l.status === 'fulfilled' && l.value.kept) result.kept = l.value.kept;
  if (failed.length > 0) {
    for (const f of failed) ctx.say(`✗ ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`);
    throw new Error(`${failed.length} launch(es) failed`);
  }
  result.legs = wanted;
  return result;
}

export interface Comparison {
  app: string;
  hash: string;
  digest?: string;
  /** In repro mode: the two builds' digests and the layers that differ. */
  repro?: { one?: string; two?: string; identical: boolean; layers: number; same: number; differing: string[] };
}

/** What the registry holds after a run: every app's digest, and in repro mode the two builds compared layer by layer. */
export async function report(ctx: Context, legs: Leg[], mode: Mode, runId: string): Promise<Comparison[]> {
  const apps = [...new Set(legs.map((l) => l.app))].sort();
  const out: Comparison[] = [];
  for (const app of apps) {
    const hash = legs.find((l) => l.app === app)?.hash ?? '';
    const c: Comparison = { app, hash, digest: await digest(ctx, app, `build-${hash}`) };
    ctx.say(`${app} build-${hash}: ${c.digest ?? 'missing'}`);
    if (mode === 'repro') {
      const [one, two] = await Promise.all([
        digest(ctx, app, `repro-${runId}-1`),
        digest(ctx, app, `repro-${runId}-2`),
      ]);
      const identical = one !== undefined && one === two;
      const [l1, l2] = identical
        ? [[], []]
        : await Promise.all([layers(ctx, app, `repro-${runId}-1`), layers(ctx, app, `repro-${runId}-2`)]);
      const differing: string[] = [];
      const a = l1 ?? [];
      const b = l2 ?? [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i]?.digest !== b[i]?.digest)
          differing.push(
            `layer ${i + 1}: ${a[i]?.digest ?? '-'} (${a[i]?.size ?? '-'}) vs ${b[i]?.digest ?? '-'} (${b[i]?.size ?? '-'})`,
          );
      }
      c.repro = { one, two, identical, layers: a.length, same: a.length - differing.length, differing };
      if (identical) ctx.say(`  reproducible: both builds are ${one}`);
      else {
        ctx.say(
          `  not identical: ${one ?? '-'} vs ${two ?? '-'}; layers: ${a.length} in each, ${a.length - differing.length} identical`,
        );
        for (const d of differing) ctx.say(`  ${d}`);
      }
    }
    out.push(c);
  }
  return out;
}
