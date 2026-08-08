/**
 * What this running process actually is.
 *
 * A deployment is only verifiable if the running container can name the commit it was
 * built from. Without that, "web and worker are on the same version" is a claim about a
 * tag — and a tag is mutable, so it is a claim about nothing.
 *
 * The values are baked into the image at build time (Dockerfile `ARG` -> `ENV`), so they
 * describe the image itself and cannot be changed by editing an env file on the host.
 *
 * Pure and dependency-free so both the web route and the worker can report identically,
 * and so it can be tested without a container.
 */

/** The literal the Dockerfile bakes in when no build arg was supplied. */
export const UNKNOWN_RELEASE = 'unknown';

export type ReleaseInfo = {
  /** Full 40-character commit SHA, or `unknown` when the image was built without one. */
  commit: string;
  /** Short form, for logs and the deployment record. */
  commitShort: string;
  /** Release version — the git tag when one exists, otherwise the commit. */
  version: string;
  /** RFC 3339 build timestamp. */
  builtAt: string;
  /** True when the image carries no build provenance at all. */
  isUnknown: boolean;
};

/**
 * Read the release identity from an environment.
 *
 * Takes the environment as an argument rather than reaching for `process.env` so the
 * "image built without build args" case is testable.
 */
export function readReleaseInfo(
  // Not `NodeJS.ProcessEnv`: this project augments it with required keys, which would
  // force every caller to supply a whole environment just to read three variables.
  env: Readonly<Record<string, string | undefined>> = process.env
): ReleaseInfo {
  const commit = nonEmpty(env.APP_COMMIT) ?? UNKNOWN_RELEASE;
  const version = nonEmpty(env.APP_VERSION) ?? commit;
  const builtAt = nonEmpty(env.APP_BUILT_AT) ?? UNKNOWN_RELEASE;

  return {
    commit,
    commitShort: commit === UNKNOWN_RELEASE ? UNKNOWN_RELEASE : commit.slice(0, 7),
    version,
    builtAt,
    isUnknown: commit === UNKNOWN_RELEASE,
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  // The Dockerfile's default is the literal string `unknown`; treat it as absent so a
  // locally-built image is not mistaken for a build with real provenance.
  if (trimmed === '' || trimmed === UNKNOWN_RELEASE) return undefined;
  return trimmed;
}

// ─── Image reference immutability ────────────────────────────────────────────

/** `registry/name@sha256:<64 hex>` — the only reference that cannot be repointed. */
const DIGEST_REF = /@sha256:[0-9a-f]{64}$/;
/** `registry/name:<40 hex>` — a full-git-sha tag. Mutable in principle, unique in practice. */
const FULL_SHA_TAG = /:[0-9a-f]{40}$/;

/**
 * Explain why an image reference is not safe to deploy, or return null when it is.
 *
 * Accepts a digest (preferred) or a full-git-sha tag. Everything else is rejected,
 * including `:latest` and the `:sha-<7>` short tag CI also publishes: seven hex characters
 * collide often enough to be a bad primary key for a deployment, and a short tag can be
 * moved to different content without the reference changing.
 *
 * Returns a phrase that reads correctly after "CRM_IMAGE ".
 */
export function describeMutableImageRef(ref: string): string | null {
  const value = ref.trim();
  if (value === '') return 'is empty';

  if (DIGEST_REF.test(value) || FULL_SHA_TAG.test(value)) return null;

  if (/:latest$/.test(value)) {
    return 'is pinned to :latest, which is mutable — two deployments a week apart can ' +
      'start different code. Use a digest (…@sha256:…) or a full-git-sha tag.';
  }
  if (/:sha-[0-9a-f]{7}$/.test(value)) {
    return 'uses the short :sha-<7> tag. Use the full 40-character SHA tag, or better, ' +
      'the digest (…@sha256:…).';
  }
  if (!value.includes('@') && !value.includes(':')) {
    return 'has no tag or digest, so it resolves to :latest. Use a digest (…@sha256:…).';
  }
  return 'is not an immutable reference. Use a digest (…@sha256:…) or a full-git-sha tag.';
}

/** One line for a worker's startup log, so a container says what it is on boot. */
export function describeRelease(info: ReleaseInfo): string {
  if (info.isUnknown) {
    return 'release: unknown (image built without build args — not a published release)';
  }
  return `release: ${info.version} (commit ${info.commitShort}, built ${info.builtAt})`;
}
