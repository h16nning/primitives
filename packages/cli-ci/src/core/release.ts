// Release one app's tested image to the registry production pulls from (ci.md,
// "Release"): copy the manifest, by digest and without an index, from the
// sidecar to GHCR as build-<hash>, then tag it test-<hash> and <sha>; or, when
// GHCR already holds build-<hash> (a promotion, a re-run), only add the tags.
// crane does the copying, logged in to GHCR by the job.
import type { Context } from '@plexus-ms/lib';
import { run } from '@plexus-ms/lib';
import { tagExists } from './registry.ts';

export interface ReleaseOptions {
  app: string;
  /** Turbo's hash of the app's build task; the tag copied. */
  build: string;
  /** Turbo's hash of the app's test task when it has one; the tag the copy is read from, proof the tests passed. */
  test?: string;
  sha: string;
  /** Where the images live, `ghcr.io/<owner>`; lower-cased, as registries want. */
  prefix: string;
}

export interface Release {
  app: string;
  image: string;
  /** Whether the manifest was copied, or found there already. */
  copied: boolean;
  tags: string[];
}

export const imageName = (prefix: string, app: string): string => `${prefix.toLowerCase().replace(/\/$/, '')}/${app}`;

/** Whether `ref` resolves on its registry. */
async function exists(ctx: Context, ref: string): Promise<boolean> {
  try {
    await ctx.read('crane', ['digest', ref]);
    return true;
  } catch {
    return false;
  }
}

export async function release(ctx: Context, options: ReleaseOptions): Promise<Release> {
  const { app, build, test, sha } = options;
  const image = imageName(options.prefix, app);
  const target = `${image}:build-${build}`;
  const copied = !(await exists(ctx, target));
  if (copied) {
    const source = test ? `test-${test}` : `build-${build}`;
    const port = await tagExists(ctx, app, source);
    if (port === undefined && !ctx.dryRun)
      throw new Error(
        `${app}:${source} is in no registry here; ${test ? 'the tests did not pass on this build' : 'the build never ran'}`,
      );
    ctx.say(`release: ${app}:${source} -> ${target}`);
    await ctx.apply([run('crane', ['copy', '--insecure', `localhost:${port ?? 5000}/${app}:${source}`, target])]);
  } else ctx.say(`release: ${target} is there already, tagging only`);
  const tags = [sha, ...(test ? [`test-${test}`] : [])];
  await ctx.apply(tags.map((t) => run('crane', ['tag', target, t])));
  return { app, image, copied, tags: [`build-${build}`, ...tags] };
}
