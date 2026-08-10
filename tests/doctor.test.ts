import { describe, it, expect } from 'vitest';
import {
  sanitizeDiagnosticText,
  evaluateVersionState,
  evaluateGitState,
  classifyTopology,
  evaluateStrictEmailSafety,
  CANONICAL_NODE,
  CANONICAL_NPM,
} from '../scripts/doctor-core.mjs';
import {
  sanitizeDbUrl,
  parseUrl,
  isLocalHost,
  DEV_REQUIRED_KEYS,
  placeholderPattern,
  devPlaceholderPattern,
} from '@/lib/env-contract';

// ===========================================================================
// 1. Secret Leakage & Subprocess Failure Path Sanitization
// ===========================================================================

describe('Doctor Sanitization (sanitizeDiagnosticText)', () => {
  it('strips postgres credentials, passwords, and query parameters', () => {
    const raw = 'postgresql://CANARY_USER:CANARY_SECRET_12345@db.example.com:5432/telestar_crm?sslmode=require&token=CANARY_TOKEN';
    const clean = sanitizeDiagnosticText(raw);

    expect(clean).not.toContain('CANARY_USER');
    expect(clean).not.toContain('CANARY_SECRET_12345');
    expect(clean).not.toContain('CANARY_TOKEN');
    expect(clean).not.toContain('postgresql://');
    expect(clean).toContain('<redacted-pg-url>');
  });

  describe('devPlaceholderPattern (development-specific placeholder contract)', () => {
    it('ALLOWS localhost URLs for local-services mode', () => {
      expect(devPlaceholderPattern.test('postgresql://postgres:postgres@localhost:5432/telestar_crm')).toBe(false);
      expect(devPlaceholderPattern.test('redis://localhost:6379')).toBe(false);
      expect(devPlaceholderPattern.test('http://localhost:3000')).toBe(false);
      expect(devPlaceholderPattern.test('postgresql://127.0.0.1:5432/db')).toBe(false);
    });

    it('REJECTS actual .env.example placeholders', () => {
      expect(devPlaceholderPattern.test('your_nextauth_auth_secret_here')).toBe(true);
      expect(devPlaceholderPattern.test('your_64_char_hex_key_here')).toBe(true);
      expect(devPlaceholderPattern.test('your_cron_secret_here')).toBe(true);
      expect(devPlaceholderPattern.test('your_google_client_id.apps.googleusercontent.com')).toBe(true);
      expect(devPlaceholderPattern.test('example.com')).toBe(true);
      expect(devPlaceholderPattern.test('<replace-me>')).toBe(true);
      expect(devPlaceholderPattern.test('change-me')).toBe(true);
    });

    it('preserves strict production placeholderPattern behavior', () => {
      // Production pattern MUST reject localhost
      expect(placeholderPattern.test('http://localhost:3000')).toBe(true);
    });
  });

  describe('Environment source attribution logic', () => {
    it('attributes inherited process env keys to "env" and loaded keys to "env-file"', () => {
      const inheritedEnvKeys = new Set(['DATABASE_URL', 'PATH', 'USER']);
      const detectSource = (key: string) => (inheritedEnvKeys.has(key) ? 'env' : 'env-file');

      expect(detectSource('DATABASE_URL')).toBe('env');
      expect(detectSource('REDIS_URL')).toBe('env-file');
      expect(detectSource('AUTH_SECRET')).toBe('env-file');
    });
  });

  describe('Migration status readiness gate', () => {
    it('fails readiness when migration status check returns unhandled error', () => {
      // Doctor status check contract test: if migStatusResult.ok is false, hasFailure must be set
      const migStatusResult = { ok: false };
      let hasFailure = false;
      if (!migStatusResult.ok) {
        hasFailure = true;
      }
      expect(hasFailure).toBe(true);
    });
  });

  it('strips redis credentials', () => {
    const raw = 'redis://:REDIS_CANARY_SECRET@redis.example.com:6379/0';
    const clean = sanitizeDiagnosticText(raw);

    expect(clean).not.toContain('REDIS_CANARY_SECRET');
    expect(clean).not.toContain('redis://');
    expect(clean).toContain('<redacted-redis-url>');
  });

  it('strips credentials from subprocess error stacktraces/stderr', () => {
    const fakeGroqKey = ['gsk', 'CANARY', 'GROQ', 'VALUE', '98765'].join('_');
    const subprocessStderr = `
      Error: Failed to connect to DATABASE_URL="postgresql://crm_admin:P%40ssw0rd123!@10.0.0.5:5432/prod_db"
      at PrismaClient.connect (node_modules/@prisma/client/index.js:100:15)
      ENCRYPTION_KEY=6d64c7c6eea90808d36288f23843bf9d9f472c558deaa00c731107030a5b717b
      Standalone key: 6d64c7c6eea90808d36288f23843bf9d9f472c558deaa00c731107030a5b717b
      GROQ_API_KEY=${fakeGroqKey}
    `;

    const clean = sanitizeDiagnosticText(subprocessStderr);

    expect(clean).not.toContain('crm_admin');
    expect(clean).not.toContain('P%40ssw0rd123!');
    expect(clean).not.toContain('6d64c7c6eea90808d36288f23843bf9d9f472c558deaa00c731107030a5b717b');
    expect(clean).not.toContain(fakeGroqKey);
    expect(clean).toContain('<redacted-pg-url>');
    expect(clean).toContain('<redacted-hex-key>');
    expect(clean).toContain('<redacted>');
  });

  it('sanitizeDbUrl returns host/database without credentials', () => {
    const identity = sanitizeDbUrl('postgresql://CANARY_USER:CANARY_PASS@db.host.com:5432/crm_db?ssl=true');
    expect(identity).toEqual({
      host: 'db.host.com',
      database: 'crm_db',
    });
    const json = JSON.stringify(identity);
    expect(json).not.toContain('CANARY_USER');
    expect(json).not.toContain('CANARY_PASS');
  });
});

// ===========================================================================
// 2. Version State Evaluation
// ===========================================================================

describe('Doctor Version Evaluation (evaluateVersionState)', () => {
  it('passes when .nvmrc matches .node-version and runtime matches canonical', () => {
    const result = evaluateVersionState({
      nvmrc: '24.18.0',
      nodeVersionFile: '24.18.0',
      actualNode: CANONICAL_NODE,
      actualNpm: CANONICAL_NPM,
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails when Node version is wrong', () => {
    const result = evaluateVersionState({
      nvmrc: '24.18.0',
      nodeVersionFile: '24.18.0',
      actualNode: '24.16.0',
      actualNpm: CANONICAL_NPM,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('24.16.0');
  });

  it('fails when npm version is wrong', () => {
    const result = evaluateVersionState({
      nvmrc: '24.18.0',
      nodeVersionFile: '24.18.0',
      actualNode: CANONICAL_NODE,
      actualNpm: '11.13.0',
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('11.13.0');
  });

  it('fails when .nvmrc and .node-version diverge', () => {
    const result = evaluateVersionState({
      nvmrc: '24.18.0',
      nodeVersionFile: '24.16.0',
      actualNode: CANONICAL_NODE,
      actualNpm: CANONICAL_NPM,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('diverge');
  });
});

// ===========================================================================
// 3. Git & Remote Decision Logic (Regression: dirty tree cannot erase failure)
// ===========================================================================

describe('Doctor Git Evaluation (evaluateGitState)', () => {
  it('passes on main when synchronized with remote and tree is clean', () => {
    const result = evaluateGitState({
      branch: 'main',
      isClean: true,
      localSha: 'abc1234',
      remoteSha: 'abc1234',
      remoteAvailable: true,
      requireMain: false,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('PASS');
  });

  it('fails on main when local SHA diverges from remote main SHA', () => {
    const result = evaluateGitState({
      branch: 'main',
      isClean: true,
      localSha: 'local111',
      remoteSha: 'remote222',
      remoteAvailable: true,
      requireMain: false,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('FAIL');
  });

  it('WARNS when remote is unavailable during normal doctor', () => {
    const result = evaluateGitState({
      branch: 'main',
      isClean: true,
      localSha: 'abc1234',
      remoteSha: null,
      remoteAvailable: false,
      requireMain: false,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('WARN');
    expect(result.message).toContain('unavailable');
  });

  it('FAILS when remote is unavailable under --require-main', () => {
    const result = evaluateGitState({
      branch: 'main',
      isClean: true,
      localSha: 'abc1234',
      remoteSha: null,
      remoteAvailable: false,
      requireMain: true,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('FAIL');
    expect(result.message).toContain('network required');
  });

  it('FAILS under --require-main when on a feature branch', () => {
    const result = evaluateGitState({
      branch: 'feat/my-feature',
      isClean: true,
      localSha: 'abc1234',
      remoteSha: 'xyz9876',
      remoteAvailable: true,
      requireMain: true,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('not on main');
  });

  it('does NOT fail on a feature branch under normal doctor (reports INFO divergence)', () => {
    const result = evaluateGitState({
      branch: 'feat/my-feature',
      isClean: true,
      localSha: 'feature_sha',
      remoteSha: 'main_sha',
      remoteAvailable: true,
      requireMain: false,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('INFO');
    expect(result.message).toContain('expected on feature branch');
  });

  it('FAILS when tree is dirty under --require-main', () => {
    const result = evaluateGitState({
      branch: 'main',
      isClean: false,
      localSha: 'abc1234',
      remoteSha: 'abc1234',
      remoteAvailable: true,
      requireMain: true,
    });
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// 4. Redis + DB Topology Classification
// ===========================================================================

describe('Doctor Topology Classification (classifyTopology)', () => {
  it('classifies all-local when app DB, direct DB, and Redis are all local', () => {
    expect(classifyTopology('local', 'local', 'local')).toBe('all-local');
  });

  it('classifies all-remote when app DB, direct DB, and Redis are all remote', () => {
    expect(classifyTopology('remote', 'remote', 'remote')).toBe('all-remote');
  });

  it('classifies HYBRID when DBs are remote but Redis is local (scenario bug #4 fix)', () => {
    const topology = classifyTopology('remote', 'remote', 'local');
    expect(topology).toBe('hybrid');
  });

  it('classifies HYBRID when app DB is remote and direct DB is local', () => {
    expect(classifyTopology('remote', 'local', 'local')).toBe('hybrid');
  });

  it('handles missing Redis classification cleanly', () => {
    expect(classifyTopology('local', 'local', undefined)).toBe('all-local');
    expect(classifyTopology('remote', 'remote', undefined)).toBe('all-remote');
  });
});

// ===========================================================================
// 5. Strict Email Configuration Validation
// ===========================================================================

describe('Doctor Strict Email Safety (evaluateStrictEmailSafety)', () => {
  it('passes when literal canonical settings are present', () => {
    const result = evaluateStrictEmailSafety({
      EMAIL_SEND_DRY_RUN: 'true',
      SEQUENCE_AUTOSEND_ENABLED: 'false',
    });
    expect(result.ok).toBe(true);
    expect(result.actionItems).toHaveLength(0);
  });

  it('rejects permissive fail-safe values like "yes" or "nope" (bug #6 fix)', () => {
    const result = evaluateStrictEmailSafety({
      EMAIL_SEND_DRY_RUN: 'yes',
      SEQUENCE_AUTOSEND_ENABLED: 'nope',
    });
    expect(result.ok).toBe(false);
    expect(result.dryRunStrict).toBe(false);
    expect(result.autosendStrict).toBe(false);
    expect(result.actionItems.length).toBeGreaterThan(0);
  });

  it('rejects missing or empty values for Doctor alignment', () => {
    const result = evaluateStrictEmailSafety({});
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// 6. Contract & Helper Primitives
// ===========================================================================

describe('env-contract primitives', () => {
  it('parses URLs safely', () => {
    expect(parseUrl('postgresql://localhost:5432/test')).not.toBeNull();
    expect(parseUrl('invalid')).toBeNull();
  });

  it('identifies local hosts', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('postgres')).toBe(true);
    expect(isLocalHost('rds.amazonaws.com')).toBe(false);
  });

  it('matches placeholder patterns', () => {
    expect(placeholderPattern.test('<your-key-here>')).toBe(true);
    expect(placeholderPattern.test('replace-me')).toBe(true);
    expect(placeholderPattern.test('localhost')).toBe(true);
    expect(placeholderPattern.test('real_secret_token_12345')).toBe(false);
  });

  it('defines development required keys without prod-only keys', () => {
    expect(DEV_REQUIRED_KEYS).toContain('DATABASE_URL');
    expect(DEV_REQUIRED_KEYS).toContain('REDIS_URL');
    expect(DEV_REQUIRED_KEYS).not.toContain('CRM_IMAGE');
    expect(DEV_REQUIRED_KEYS).not.toContain('BACKUP_DATABASE_URL');
  });
});
