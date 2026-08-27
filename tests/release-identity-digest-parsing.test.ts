import { describe, it, expect } from 'vitest';

import { digestFromRepoDigests } from '../scripts/certification/lib/repoDigest.mjs';

/**
 * TEL-P1-018 — the fifth and sixth links of the release identity chain.
 *
 * `verify-release-identity.mjs` now reads the running containers' registry digests off the
 * deployment host instead of accepting them on the command line. Everything downstream —
 * whether the chain holds, whether the release is certifiable — rests on this one parser
 * picking the right digest out of what `docker image inspect` prints.
 *
 * The failure that matters is not a malformed string. It is a container carrying digests
 * for more than one repository — a mirror, a retag, a registry migration — where taking
 * "the first one" silently certifies the wrong artifact.
 */

const REPO = 'ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final';
const DIGEST = 'sha256:78bd7eb087e86e867d604aaf01fb49deab897f94bdcd86bf01b2fc0007c5dc3b';
const OTHER = 'sha256:99fbfe8229e6f298e3c80c8ba280e235ac9b9e528741fc547f3e73fd7364ff2b';

describe('release identity — RepoDigests parsing', () => {
  it('reads the digest for the release repository', () => {
    expect(digestFromRepoDigests(JSON.stringify([`${REPO}@${DIGEST}`]), REPO)).toBe(DIGEST);
  });

  it('picks the release repository even when it is not listed first', () => {
    const mirrored = JSON.stringify([`mirror.internal/telestar@${OTHER}`, `${REPO}@${DIGEST}`]);

    // Taking element zero here returns a digest that is real, well-formed, and from an
    // entirely different registry. That is the mistake this test exists to prevent.
    expect(digestFromRepoDigests(mirrored, REPO)).toBe(DIGEST);
  });

  it('returns null when the release repository is absent entirely', () => {
    const foreign = JSON.stringify([`mirror.internal/telestar@${OTHER}`]);

    expect(digestFromRepoDigests(foreign, REPO)).toBeNull();
  });

  it('returns null for an image that was never pushed', () => {
    // A locally built image has no RepoDigests. A container running one was not started
    // from a published artifact, and the chain must not close over it.
    expect(digestFromRepoDigests('[]', REPO)).toBeNull();
  });

  it('returns null rather than throwing when docker printed something unparseable', () => {
    expect(digestFromRepoDigests('<no value>', REPO)).toBeNull();
    expect(digestFromRepoDigests('null', REPO)).toBeNull();
  });

  it('rejects an entry whose digest is not a well-formed sha256', () => {
    expect(digestFromRepoDigests(JSON.stringify([`${REPO}@sha256:deadbeef`]), REPO)).toBeNull();
    expect(digestFromRepoDigests(JSON.stringify([`${REPO}@latest`]), REPO)).toBeNull();
  });

  it('does not match a repository that merely starts with the release repository name', () => {
    const lookalike = JSON.stringify([`${REPO}-staging@${OTHER}`]);

    expect(digestFromRepoDigests(lookalike, REPO)).toBeNull();
  });
});
