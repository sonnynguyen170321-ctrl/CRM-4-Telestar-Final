/**
 * Reading a running container's registry digest out of what `docker image inspect` prints.
 *
 * This is the fifth and sixth link of the release identity chain (TEL-P1-018): whether the
 * web and worker containers were started from the digest the release claims. The answer
 * comes off the deployment host, and everything downstream rests on picking the right entry
 * out of `RepoDigests`.
 *
 * It lives in `lib/` rather than inside `verify-release-identity.mjs` because a parser that
 * decides whether a release is certifiable should be testable without importing a script
 * whose module body probes production.
 */

/** A registry digest, in the only form that identifies an artifact immutably. */
export const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

/**
 * The digest a container's image carries for one specific repository.
 *
 * An image can list digests for several repositories — a mirror, a retag, a registry
 * migration — so "the first entry" is not the same question as "the digest in the release
 * registry". Only an exact repository-name match is accepted, and only when the digest is
 * well formed.
 *
 * @param json  the `RepoDigests` array as printed by `docker image inspect --format`
 * @param repo  the repository name the release publishes to
 * @returns the digest, or null when this image carries none for that repository
 */
export function digestFromRepoDigests(json, repo) {
  let list;
  try {
    list = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;

  for (const entry of list) {
    const [name, digest] = String(entry).split('@');
    if (name === repo && DIGEST_RE.test(digest ?? '')) return digest;
  }
  return null;
}

/**
 * Parses the host probe's output into per-role observations.
 *
 * The probe prints one line per container:
 *   `web imageId=sha256:… repoDigests=[…] revision=<sha>`
 *
 * A line that does not match is ignored rather than guessed at, so a warning banner or an
 * ssh notice on stdout cannot become a digest.
 *
 * @returns `{ web, worker, webImageId, workerImageId, revisions }`
 */
export function parseHostProbe(output, repo) {
  const result = {
    web: null,
    worker: null,
    webImageId: null,
    workerImageId: null,
    revisions: {},
  };

  const LINE = /^(web|worker)\s+imageId=(\S+)\s+repoDigests=(\[.*\])\s+revision=(\S*)\s*$/;

  for (const line of String(output).split('\n')) {
    const match = line.trim().match(LINE);
    if (!match) continue;
    const [, role, imageId, repoDigests, revision] = match;
    result[role] = digestFromRepoDigests(repoDigests, repo);
    result[`${role}ImageId`] = imageId;
    result.revisions[role] = revision || null;
  }

  return result;
}
