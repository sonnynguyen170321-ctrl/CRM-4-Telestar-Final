import { parseEnvFile } from './prod-env';
import { describeMutableImageRef } from '@/lib/release';
import {
  placeholderPattern,
  parseUrl,
  isLocalHost,
} from '@/lib/env-contract';

type Level = 'PASS' | 'WARN' | 'FAIL';
type Check = { level: Level; message: string };

const envPath = process.argv.includes('--file')
  ? process.argv[process.argv.indexOf('--file') + 1]
  : '.env.production';

const requiredKeys = [
  'DEPLOY_TARGET',
  'CRM_IMAGE',
  'DATABASE_URL',
  'DIRECT_URL',
  'BACKUP_DATABASE_URL',
  'REDIS_URL',
  'CRM_DOMAIN',
  'NEXTAUTH_URL',
  'CADDY_SITE_ADDRESS',
  'AUTH_SECRET',
  'ENCRYPTION_KEY',
  'CRON_SECRET',
  'EMAIL_SEND_DRY_RUN',
  'SEQUENCE_AUTOSEND_ENABLED',
  // Telestar AI routes across three providers and fails over between them. Requiring all
  // three is the point: a deployment with one key has no failover, and the production chat
  // outage this check exists to prevent was exactly that — one provider, one withdrawn model,
  // nothing else reachable.
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GROQ_API_KEY',
];

/** Provider credentials, reported by presence only. Never echo a key, or any part of one. */
const aiProviderKeys = ['OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'];

const add = (checks: Check[], level: Level, message: string) => {
  checks.push({ level, message });
};

const validate = (): Check[] => {
  const checks: Check[] = [];
  let env: Record<string, string>;
  try {
    env = parseEnvFile(envPath);
  } catch (err) {
    add(checks, 'FAIL', err instanceof Error ? err.message : 'Unable to read env file');
    return checks;
  }

  for (const key of requiredKeys) {
    if (!env[key]) add(checks, 'FAIL', `${key} is required`);
  }

  for (const key of aiProviderKeys) {
    // Presence, and nothing else. No prefix, no suffix, no length — each of those narrows the
    // search space for anyone reading a CI log or a screen share.
    if (env[key]) add(checks, 'PASS', `${key} configured`);
  }

  for (const [key, value] of Object.entries(env)) {
    if (value && placeholderPattern.test(value)) {
      add(checks, 'FAIL', `${key} contains a placeholder or local/example value`);
    }
  }

  if (env.DEPLOY_TARGET && !['gcp', 'self-hosted'].includes(env.DEPLOY_TARGET)) {
    add(checks, 'FAIL', 'DEPLOY_TARGET must be "gcp" or "self-hosted"');
  }

  if (env.CRM_IMAGE) {
    const problem = describeMutableImageRef(env.CRM_IMAGE);
    if (problem) add(checks, 'FAIL', `CRM_IMAGE ${problem}`);
  }

  const dbUrls = ['DATABASE_URL', 'DIRECT_URL', 'BACKUP_DATABASE_URL'].map((key) => ({
    key,
    url: parseUrl(env[key]),
  }));
  for (const item of dbUrls) {
    if (!item.url) {
      add(checks, 'FAIL', `${item.key} must be a valid URL`);
    } else if (!item.url.protocol.startsWith('postgres')) {
      add(checks, 'FAIL', `${item.key} must use a postgres protocol`);
    } else if (isLocalHost(item.url.hostname)) {
      add(checks, 'FAIL', `${item.key} must point to RDS, not ${item.url.hostname}`);
    }
  }

  const dbHosts = dbUrls.map((item) => item.url?.hostname).filter(Boolean);
  if (dbHosts.length === 3 && new Set(dbHosts).size !== 1) {
    add(checks, 'FAIL', 'DATABASE_URL, DIRECT_URL, and BACKUP_DATABASE_URL must use the same host');
  }

  const redisUrl = parseUrl(env.REDIS_URL);
  if (!redisUrl || !['redis:', 'rediss:'].includes(redisUrl.protocol)) {
    add(checks, 'FAIL', 'REDIS_URL must be a valid redis:// or rediss:// URL');
  }

  const nextAuthUrl = parseUrl(env.NEXTAUTH_URL);
  if (!nextAuthUrl || !['http:', 'https:'].includes(nextAuthUrl.protocol)) {
    add(checks, 'FAIL', 'NEXTAUTH_URL must be a valid http(s) URL');
  } else if (env.CADDY_SITE_ADDRESS === ':80' && nextAuthUrl.protocol !== 'http:') {
    add(checks, 'FAIL', 'IP HTTP mode requires NEXTAUTH_URL to use http://');
  } else if (env.CADDY_SITE_ADDRESS && env.CADDY_SITE_ADDRESS !== ':80' && nextAuthUrl.protocol !== 'https:') {
    add(checks, 'FAIL', 'Domain mode requires NEXTAUTH_URL to use https://');
  }
  if (nextAuthUrl && env.CRM_DOMAIN && nextAuthUrl.hostname !== env.CRM_DOMAIN) {
    add(checks, 'FAIL', 'NEXTAUTH_URL hostname must match CRM_DOMAIN');
  }

  if (env.ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(env.ENCRYPTION_KEY)) {
    add(checks, 'FAIL', 'ENCRYPTION_KEY must be 64 hex characters');
  }
  if (env.AUTH_SECRET && env.AUTH_SECRET.length < 32) {
    add(checks, 'FAIL', 'AUTH_SECRET should be at least 32 characters');
  }
  if (env.CRON_SECRET && env.CRON_SECRET.length < 32) {
    add(checks, 'FAIL', 'CRON_SECRET should be at least 32 characters');
  }
  if (env.EMAIL_SEND_DRY_RUN === 'false') {
    if (env.LIVE_EMAIL_CANARY_MODE !== 'true' && env.ALLOW_UNRESTRICTED_LIVE_EMAIL !== 'true') {
      add(checks, 'FAIL', 'EMAIL_SEND_DRY_RUN cannot be false without LIVE_EMAIL_CANARY_MODE=true or ALLOW_UNRESTRICTED_LIVE_EMAIL=true');
    }
    if (env.LIVE_EMAIL_CANARY_MODE === 'true' && !env.LIVE_EMAIL_ALLOWED_RECIPIENTS) {
      add(checks, 'FAIL', 'LIVE_EMAIL_CANARY_MODE=true requires LIVE_EMAIL_ALLOWED_RECIPIENTS to be configured');
    }
  } else if (env.EMAIL_SEND_DRY_RUN && env.EMAIL_SEND_DRY_RUN !== 'true') {
    add(checks, 'FAIL', 'EMAIL_SEND_DRY_RUN must be "true" or "false"');
  }

  if (env.SEQUENCE_AUTOSEND_ENABLED && !['true', 'false'].includes(env.SEQUENCE_AUTOSEND_ENABLED)) {
    add(checks, 'FAIL', 'SEQUENCE_AUTOSEND_ENABLED must be "true" or "false"');
  }

  if (!checks.some((check) => check.level === 'FAIL')) {
    add(checks, 'PASS', 'Production env passed validation');
  }
  return checks;
};

const checks = validate();
for (const check of checks) {
  console.log(`${check.level}: ${check.message}`);
}

if (checks.some((check) => check.level === 'FAIL')) {
  process.exit(1);
}
