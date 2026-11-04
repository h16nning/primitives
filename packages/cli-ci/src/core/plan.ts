// The plan of a run (ci.md, "Plan"): for every app, the build and the test
// hash from one Turbo dry run, a look-up in the registry, and one builder per
// app whose image is missing (two without cache in repro mode) and one test
// runner per app whose test tag is missing, launched at once. The result is
// the matrices the build and the test jobs fan out over, the apps with their
// hashes for the release, and the id of an instance kept for inspection, if any.
import type { Context } from '@plexus-ms/lib';
import { UsageError } from '@plexus-ms/lib';
import type { Exo } from './exoscale.ts';
import type { GitHubRunners } from './github.ts';
import { type LaunchOptions, launch } from './launch.ts';
import { digest, layers, tagExists } from './registry.ts';

export type Mode = 'build' | 'force' | 'repro';

/** One app's hashes: of its build task, and of its test task when it has one. */
export interface Hash {
  app: string;
  hash: string;
  test?: string;
}

/** Turbo's marker for a task whose script the package does not define. */
const NONEXISTENT = '<NONEXISTENT>';

/** The build and test hashes from Turbo's dry run (`turbo run build test --dry-run=json`), per app package. */
export function hashesOf(dryRun: string, scope: string): Hash[] {
  const data = JSON.parse(dryRun) as {
    tasks?: { taskId: string; package: string; hash: string; command?: string }[];
  };
  const tasks = (data.tasks ?? []).filter((t) => t.package.startsWith(`${scope}/`) && t.command !== NONEXISTENT);
  const app = (t: { package: string }) => t.package.slice(scope.length + 1);
  return tasks
    .filter((t) => t.taskId.endsWith('#build'))
    .map((b) => {
      const test = tasks.find((t) => t.package === b.package && t.taskId.endsWith('#test'));
      return { app: app(b), hash: b.hash, ...(test ? { test: test.hash } : {}) };
    });
}

export async function readHashes(ctx: Context, dir: string, scope: string): Promise<Hash[]> {
  const pkg = JSON.parse(await ctx.readFile(`${dir}/package.json`)) as { devDependencies?: Record<string, string> };
  const turbo = pkg.devDependencies?.turbo ?? 'latest';
  const out = await ctx.read('npx', ['--yes', `turbo@${turbo}`, 'run', 'build', 'test', '--dry-run=json'], {
    cwd: dir,
  });
  return hashesOf(out, scope);
}

/** A build job: one app, its build hash, the runner label it asks for. */
export interface Leg {
  app: string;
  hash: string;
  label: string;
  n: number;
}

/** A test job: one app, its test hash, the build it tests, the runner label it asks for. */
export interface TestLeg {
  app: string;
  hash: string;
  build: string;
  label: string;
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

/** The test legs: one per app that has a test task. */
export function testLegsOf(apps: string[], hashes: Hash[], runId: string, attempt: string): TestLeg[] {
  return apps.flatMap((app) => {
    const h = hashes.find((x) => x.app === app);
    if (!h?.test) return [];
    return [{ app, hash: h.test, build: h.hash, label: `exo-test-${runId}-${app}-${attempt}` }];
  });
}

export interface Plan {
  legs: Leg[];
  tests: TestLeg[];
  /** Every app planned, with its hashes: what the release and the deploy fan out over. */
  apps: Hash[];
  skipped: { app: string; hash: string; port: number }[];
  skippedTests: { app: string; hash: string; port: number }[];
  kept?: string;
}

export interface PlanOptions {
  apps: string[];
  mode: Mode;
  /** Plan test runners too (the pipeline); off for the build measurements. */
  tests?: boolean;
  hashes: Hash[];
  /** The launch options every leg shares; label and app are set per leg. */
  launch: Omit<LaunchOptions, 'label' | 'app' | 'kind'>;
}

export async function plan(ctx: Context, exo: Exo, github: GitHubRunners, options: PlanOptions): Promise<Plan> {
  const { runId, attempt } = options.launch.run;
  const result: Plan = {
    legs: [],
    tests: [],
    apps: options.apps.map((app) => {
      const h = options.hashes.find((x) => x.app === app);
      if (!h) throw new UsageError(`no build hash for ${app}; is it an app package of the workspace?`);
      return h;
    }),
    skipped: [],
    skippedTests: [],
  };
  const builds: Leg[] = [];
  for (const leg of legsOf(options.apps, options.hashes, options.mode, runId, attempt)) {
    if (options.mode === 'build') {
      const port = await tagExists(ctx, leg.app, `build-${leg.hash}`);
      if (port !== undefined) {
        ctx.say(`${leg.app}: build-${leg.hash} exists in the registry on :${port}, nothing to build`);
        result.skipped.push({ app: leg.app, hash: leg.hash, port });
        continue;
      }
    }
    builds.push(leg);
  }
  const tests: TestLeg[] = [];
  if (options.tests && options.mode !== 'repro') {
    for (const leg of testLegsOf(options.apps, options.hashes, runId, attempt)) {
      if (options.mode === 'build') {
        const port = await tagExists(ctx, leg.app, `test-${leg.hash}`);
        if (port !== undefined) {
          ctx.say(`${leg.app}: test-${leg.hash} exists in the registry on :${port}, nothing to test`);
          result.skippedTests.push({ app: leg.app, hash: leg.hash, port });
          continue;
        }
      }
      tests.push(leg);
    }
  }
  // At once: each launch waits for its runner, and the waits overlap.
  const launches = await Promise.allSettled([
    ...builds.map((leg) =>
      launch(ctx, exo, github, { ...options.launch, kind: 'build', label: leg.label, app: leg.app }),
    ),
    ...tests.map((leg) =>
      launch(ctx, exo, github, { ...options.launch, kind: 'test', label: leg.label, app: leg.app }),
    ),
  ]);
  const failed = launches.filter((l) => l.status === 'rejected');
  for (const l of launches) if (l.status === 'fulfilled' && l.value.kept) result.kept = l.value.kept;
  if (failed.length > 0) {
    for (const f of failed) ctx.say(`✗ ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`);
    throw new Error(`${failed.length} launch(es) failed`);
  }
  result.legs = builds;
  result.tests = tests;
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
