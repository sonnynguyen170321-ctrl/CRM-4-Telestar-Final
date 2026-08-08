import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import {
  readReleaseInfo,
  describeRelease,
  describeMutableImageRef,
  UNKNOWN_RELEASE,
} from '@/lib/release';

const FULL_SHA = 'a'.repeat(40);
const DIGEST = 'sha256:' + 'b'.repeat(64);
const IMAGE = 'ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final';

describe('readReleaseInfo', () => {
  it('reports the commit baked into the image', () => {
    const info = readReleaseInfo({ APP_COMMIT: FULL_SHA, APP_BUILT_AT: '2026-08-07T10:00:00Z' });
    expect(info.commit).toBe(FULL_SHA);
    expect(info.commitShort).toBe('aaaaaaa');
    expect(info.isUnknown).toBe(false);
  });

  it('falls back to the commit when no release tag was supplied', () => {
    expect(readReleaseInfo({ APP_COMMIT: FULL_SHA }).version).toBe(FULL_SHA);
  });

  it('prefers an explicit release version over the commit', () => {
    expect(readReleaseInfo({ APP_COMMIT: FULL_SHA, APP_VERSION: 'v1.2.0' }).version).toBe('v1.2.0');
  });

  it('treats a locally built image as having no provenance', () => {
    // The Dockerfile's default is the literal `unknown`; it must not be mistaken for a
    // real identity, or an unpublished build looks like a release.
    const info = readReleaseInfo({ APP_COMMIT: UNKNOWN_RELEASE, APP_VERSION: '  ' });
    expect(info.isUnknown).toBe(true);
    expect(info.commit).toBe(UNKNOWN_RELEASE);
    expect(describeRelease(info)).toContain('not a published release');
  });

  it('treats a completely empty environment as unknown', () => {
    expect(readReleaseInfo({}).isUnknown).toBe(true);
  });
});

describe('describeMutableImageRef', () => {
  it('accepts a digest reference', () => {
    expect(describeMutableImageRef(`${IMAGE}@${DIGEST}`)).toBeNull();
  });

  it('accepts a full-git-sha tag', () => {
    expect(describeMutableImageRef(`${IMAGE}:${FULL_SHA}`)).toBeNull();
  });

  it('rejects :latest by name', () => {
    // The specific default this task exists to remove.
    expect(describeMutableImageRef(`${IMAGE}:latest`)).toMatch(/mutable/);
  });

  it('rejects the short sha- tag CI also publishes', () => {
    expect(describeMutableImageRef(`${IMAGE}:sha-abc1234`)).toMatch(/full 40-character/);
  });

  it('rejects a bare image name, which resolves to :latest', () => {
    expect(describeMutableImageRef('crm-4-telestar-final')).toMatch(/no tag or digest/);
  });

  it('rejects an empty value', () => {
    expect(describeMutableImageRef('   ')).toBe('is empty');
  });

  it('rejects a truncated digest', () => {
    expect(describeMutableImageRef(`${IMAGE}@sha256:abc`)).toMatch(/not an immutable reference/);
  });
});

/**
 * These assert on committed configuration rather than on code. The whole task is "the
 * deployed image reference cannot be mutable", and the place that regresses is a YAML
 * default someone re-adds for convenience.
 */
describe('deployment configuration carries no mutable image default', () => {
  it('docker-compose.yml requires CRM_IMAGE with no fallback', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8');
    expect(compose).toMatch(/\$\{CRM_IMAGE:\?/);
    expect(compose).not.toMatch(/IMAGE_TAG:-latest/);
    expect(compose).not.toMatch(/crm-4-telestar-final:latest/);
  });

  it('web and worker can only resolve to one image', () => {
    // Both inherit the single `x-app-base` anchor, so they cannot be pinned apart by
    // accident — the drift the smoke test can otherwise only catch after the containers
    // are already running.
    //
    // js-yaml does not apply `<<:` merge keys, so `services.web.image` is undefined here
    // even though compose resolves it. That undefined is exactly the assertion we want:
    // it proves neither service declares an image of its own.
    const source = readFileSync('docker-compose.yml', 'utf8');
    const doc = load(source) as {
      'x-app-base': { image?: string };
      services: Record<string, { image?: string }>;
    };

    expect(doc['x-app-base'].image).toMatch(/^\$\{CRM_IMAGE:\?/);
    expect(doc.services.web.image).toBeUndefined();
    expect(doc.services.worker.image).toBeUndefined();
    // ...and there is only one place an image could come from.
    expect(source.match(/\$\{CRM_IMAGE/g) ?? []).toHaveLength(1);
  });

  it('the production env template ships no runnable image default', () => {
    const template = readFileSync('.env.production.example', 'utf8');
    expect(template).not.toMatch(/^IMAGE_TAG=/m);
    // The placeholder must be a placeholder — prod-check-env rejects `<...>` values, so a
    // template that accidentally contained a real digest would silently validate.
    expect(template).toMatch(/^CRM_IMAGE=.*@sha256:<digest>$/m);
  });
});
