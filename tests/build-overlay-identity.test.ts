/**
 * TEL-P1-055. A locally built image must still be able to name the commit it came from.
 *
 * `docker-compose.build.yml` declared `build:` with no `args:`. The Dockerfile defaults
 * APP_COMMIT, APP_VERSION and APP_BUILT_AT to the literal `unknown`, and `lib/release.ts`
 * treats that as no provenance — correctly, and by design. So every image built through that
 * overlay reported itself as `unknown`, and on 2026-08-26 production began answering
 *
 *   {"ok":true,"commit":"unknown","version":"unknown","builtAt":"unknown","schema":"ready"}
 *
 * having reported a real SHA earlier the same day.
 *
 * The publishing pipeline was healthy throughout — docker-image.yml passes all three args and
 * the image for every merged commit carries the matching org.opencontainers.image.revision
 * label — so the running container did not come from it. This overlay is the one path in the
 * repository that produces exactly that symptom, and docs/GCP_DEPLOY.md Phase 7 documented a
 * production deploy that used it.
 *
 * The overlay now requires the three arguments and fails interpolation without them. This
 * asserts the shape rather than shelling out to `docker compose`, so it runs everywhere,
 * including hosts with no container runtime.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(__dirname, '..');
const OVERLAY = readFileSync(path.join(REPO_ROOT, 'docker-compose.build.yml'), 'utf8');
const DOCKERFILE = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8');

const IDENTITY_ARGS = ['APP_COMMIT', 'APP_VERSION', 'APP_BUILT_AT'] as const;

describe('a locally built image must carry its release identity', () => {
  it.each(IDENTITY_ARGS)('the build overlay passes %s as a build arg', (arg) => {
    expect(
      new RegExp(`^\\s*${arg}:\\s*\\$\\{${arg}`, 'm').test(OVERLAY),
      `docker-compose.build.yml must pass ${arg} into the build, or the image reports "unknown"`,
    ).toBe(true);
  });

  it.each(IDENTITY_ARGS)('%s is required, with no silent default', (arg) => {
    // `${VAR:?message}` fails interpolation when unset. `${VAR:-default}` or a bare `${VAR}`
    // would quietly produce an image that cannot name itself, which is the defect.
    expect(
      new RegExp(`\\$\\{${arg}:\\?`).test(OVERLAY),
      `${arg} must use \${${arg}:?message} so compose refuses rather than defaulting`,
    ).toBe(true);
  });

  it('does not invent a commit when none was given', () => {
    // Defaulting APP_COMMIT to anything derived inside the overlay would put a
    // plausible-looking SHA on an image nobody can trace back — worse than `unknown`,
    // because `lib/release.ts` can recognise `unknown` and this program treats it as absent.
    expect(/\$\{APP_COMMIT:-/.test(OVERLAY)).toBe(false);
  });

  it('the Dockerfile still defaults to unknown, which is what makes the requirement load-bearing', () => {
    for (const arg of IDENTITY_ARGS) {
      expect(
        new RegExp(`^ARG ${arg}=unknown\\s*$`, 'm').test(DOCKERFILE),
        `Dockerfile should default ${arg} to "unknown" — an honest absence the overlay then refuses to rely on`,
      ).toBe(true);
    }
  });
});
