// The registry sidecars (ci.md, "The registry"): `registry:2` on
// 127.0.0.1:5000 for this month's bucket, read-write, and on 127.0.0.1:5001
// for the previous month's, read-only. Both are the same registry API over
// the same object storage; nothing reads the bucket layout directly. The
// GitHub-hosted jobs start them with this module; an instance's user-data
// starts the same two containers. In the first month the previous bucket does
// not exist and registry:2 answers 503 (its storage health check fails): that
// sidecar is optional, and a build names it as a cache source only when it
// answers 200.
import type { Context } from '@plexus-ms/lib';
import { run } from '@plexus-ms/lib';
import { Storage, sleep } from './exoscale.ts';
import { registryBuckets } from './time.ts';

export interface ObjectStorage {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

export const CURRENT_PORT = 5000;
export const PREVIOUS_PORT = 5001;
export const REGISTRY_IMAGE = 'registry:2';
const ACCEPT =
  'application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json';

/** The storage from the environment the vault item bucket-registry fills. */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStorage | undefined {
  const { REGISTRY_ENDPOINT, REGISTRY_REGION, REGISTRY_ACCESS_KEY, REGISTRY_SECRET_KEY } = env;
  if (!REGISTRY_ENDPOINT || !REGISTRY_REGION || !REGISTRY_ACCESS_KEY || !REGISTRY_SECRET_KEY) return undefined;
  return {
    endpoint: REGISTRY_ENDPOINT,
    region: REGISTRY_REGION,
    accessKey: REGISTRY_ACCESS_KEY,
    secretKey: REGISTRY_SECRET_KEY,
  };
}

/** The `docker run` of one sidecar; the key on argv is the same exposure as the job's own secrets (ci.md, "Secrets"). */
export function sidecarArgs(
  name: string,
  port: number,
  bucket: string,
  storage: ObjectStorage,
  readOnly: boolean,
): string[] {
  return [
    'run',
    '-d',
    '--name',
    name,
    '--restart',
    readOnly ? 'on-failure:3' : 'unless-stopped',
    '-p',
    `127.0.0.1:${port}:5000`,
    '-e',
    'REGISTRY_STORAGE=s3',
    '-e',
    `REGISTRY_STORAGE_S3_REGIONENDPOINT=${storage.endpoint}`,
    '-e',
    `REGISTRY_STORAGE_S3_REGION=${storage.region}`,
    '-e',
    `REGISTRY_STORAGE_S3_BUCKET=${bucket}`,
    '-e',
    `REGISTRY_STORAGE_S3_ACCESSKEY=${storage.accessKey}`,
    '-e',
    `REGISTRY_STORAGE_S3_SECRETKEY=${storage.secretKey}`,
    '-e',
    'REGISTRY_STORAGE_S3_FORCEPATHSTYLE=true',
    '-e',
    // registry:2 panics on the read-only flag as one nested variable
    // (…_READONLY_ENABLED=true): the map it builds from it has the wrong
    // type. The whole key as one YAML value is read as from a config file.
    readOnly ? 'REGISTRY_STORAGE_MAINTENANCE_READONLY={"enabled":true}' : 'REGISTRY_STORAGE_DELETE_ENABLED=true',
    REGISTRY_IMAGE,
  ];
}

/** Whether a sidecar answers `/v2/`. */
export async function answers(ctx: Context, port: number): Promise<boolean> {
  try {
    await ctx.read('curl', ['-fsS', '--max-time', '3', `http://127.0.0.1:${port}/v2/`]);
    return true;
  } catch {
    return false;
  }
}

export interface Sidecars {
  current: string;
  previous: string;
  /** Whether the previous month's sidecar answers. */
  previousAnswers: boolean;
}

/**
 * Create this month's bucket when it does not exist yet (the ci-storage key
 * may), start both sidecars, wait for the current one and briefly for the
 * previous one. Where the current one answers already, the machine runs the
 * pair for its jobs (a slot of a runner host, ci_hybrid_host, which keeps
 * the pair on this month's buckets and gives the slot no Docker socket):
 * nothing is started and no bucket is touched.
 */
export async function startSidecars(
  ctx: Context,
  storage: ObjectStorage | undefined,
  owner: string,
  zone: string,
  now = new Date(),
): Promise<Sidecars> {
  const buckets = registryBuckets(owner, now);
  if (!ctx.dryRun && (await answers(ctx, CURRENT_PORT))) {
    const previousAnswers = await answers(ctx, PREVIOUS_PORT);
    ctx.say(`registry: :${CURRENT_PORT} answers already, the host's pair; nothing started`);
    return { current: buckets.current, previous: buckets.previous, previousAnswers };
  }
  if (!storage)
    throw new Error('REGISTRY_ENDPOINT, REGISTRY_REGION, REGISTRY_ACCESS_KEY and REGISTRY_SECRET_KEY are needed');
  const sos = new Storage(ctx, storage.accessKey, storage.secretKey);
  if (!(await sos.bucketExists(buckets.current))) {
    ctx.say(`→ creating the bucket ${buckets.current} in ${zone}`);
    await sos.makeBucket(buckets.current, zone);
  }
  await ctx.apply([
    run('docker', sidecarArgs('registry', CURRENT_PORT, buckets.current, storage, false)),
    run('docker', sidecarArgs('registry-previous', PREVIOUS_PORT, buckets.previous, storage, true)),
  ]);
  if (!ctx.dryRun) {
    for (let i = 0; i < 30 && !(await answers(ctx, CURRENT_PORT)); i++) await sleep(1000);
    for (let i = 0; i < 5 && !(await answers(ctx, PREVIOUS_PORT)); i++) await sleep(1000);
  }
  const previousAnswers = ctx.dryRun ? false : await answers(ctx, PREVIOUS_PORT);
  ctx.say(
    `registry: :${CURRENT_PORT} on ${buckets.current} (read-write), :${PREVIOUS_PORT} on ${buckets.previous} (${previousAnswers ? 'read-only' : 'not answering, bucket missing?'})`,
  );
  return { current: buckets.current, previous: buckets.previous, previousAnswers };
}

/** The HTTP status of a manifest HEAD against one sidecar, `000` when nothing answers. */
async function manifestStatus(ctx: Context, port: number, app: string, tag: string): Promise<string> {
  try {
    return (
      await ctx.read('curl', [
        '-s',
        '-o',
        '/dev/null',
        '-w',
        '%{http_code}',
        '-I',
        '-H',
        `Accept: ${ACCEPT}`,
        `http://127.0.0.1:${port}/v2/${app}/manifests/${tag}`,
      ])
    ).trim();
  } catch {
    return '000';
  }
}

/** The port of the sidecar that holds `app:tag`, or undefined. */
export async function tagExists(ctx: Context, app: string, tag: string): Promise<number | undefined> {
  for (const port of [CURRENT_PORT, PREVIOUS_PORT]) {
    if ((await manifestStatus(ctx, port, app, tag)) === '200') return port;
  }
  return undefined;
}

/** The digest of `app:tag` on one sidecar, or undefined. */
export async function digest(ctx: Context, app: string, tag: string, port = CURRENT_PORT): Promise<string | undefined> {
  try {
    const head = await ctx.read('curl', [
      '-fsS',
      '-I',
      '-H',
      `Accept: ${ACCEPT}`,
      `http://127.0.0.1:${port}/v2/${app}/manifests/${tag}`,
    ]);
    return head.match(/^docker-content-digest:\s*(\S+)/im)?.[1];
  } catch {
    return undefined;
  }
}

export interface Layer {
  digest: string;
  size: number;
}

/** The layers of `app:tag`'s manifest on one sidecar, or undefined. */
export async function layers(
  ctx: Context,
  app: string,
  tag: string,
  port = CURRENT_PORT,
): Promise<Layer[] | undefined> {
  try {
    const body = await ctx.read('curl', [
      '-fsS',
      '-H',
      `Accept: ${ACCEPT}`,
      `http://127.0.0.1:${port}/v2/${app}/manifests/${tag}`,
    ]);
    const data = JSON.parse(body) as { layers?: Layer[] };
    return (data.layers ?? []).map((l) => ({ digest: l.digest, size: l.size }));
  } catch {
    return undefined;
  }
}
