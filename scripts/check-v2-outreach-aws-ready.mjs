import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = {
  env: read(".env.example"),
  pkg: read("package.json"),
  smtp: read("lib/v2/outreach/providers/smtpTransport.ts"),
  send: read("lib/v2/outreach/send/emailSendHandler.ts"),
  runtimeWorker: read("scripts/v2-runtime-worker.mjs"),
  imapPoller: read("scripts/v2-imap-poller.mjs"),
  runbook: read("docs/v2/outreach/V2_OUTREACH_AWS_SEND_READY.md"),
};

for (const envName of [
  "APP_URL",
  "APP_BASE_URL",
  "NEXT_PUBLIC_APP_URL",
  "V2_OUTREACH_CREDENTIAL_KEY",
  "V2_WORKER_SECRET",
  "V2_WORKER_APP_URL",
  "V2_WORKER_INTERVAL_MS",
  "V2_IMAP_POLL_INTERVAL_MS",
  "V2_TRACKING_HOST",
  "V2_TRACKING_SECRET",
  "V2_OUTREACH_KILL_SWITCH",
]) {
  assert.match(files.env, new RegExp(`^${envName}=`, "m"), `.env.example documents ${envName}`);
}

assert.match(files.pkg, /"v2:worker"\s*:\s*"node scripts\/v2-runtime-worker\.mjs"/, "canonical outreach worker script exists");
assert.match(files.pkg, /"v2:imap"\s*:\s*"node scripts\/v2-imap-poller\.mjs"/, "IMAP poller script exists");
assert.match(files.runtimeWorker, /process\.env\.APP_URL/, "worker falls back to APP_URL for AWS deploys");
assert.match(files.runtimeWorker, /process\.env\.APP_BASE_URL/, "worker falls back to APP_BASE_URL");
assert.match(files.imapPoller, /process\.env\.APP_URL/, "IMAP poller falls back to app URL envs");

for (const token of ["requireTLS", "tls: { servername: config.host }", "connectionTimeout", "greetingTimeout", "socketTimeout", "pool: true"]) {
  assert.match(files.smtp, new RegExp(escapeRegExp(token)), `SMTP transport keeps production option: ${token}`);
}

assert.match(files.send, /executeSend\(\{ provider, organizationId: context\.organizationId, request, loadCandidates \}\)/, "EMAIL_SEND still routes through executeSend");
assert.match(files.send, /assertNotSuppressed|SuppressedError/, "send handler keeps suppression gate path visible");
assert.match(files.send, /createSenderSmtpAdapter/, "live sender resolves real SMTP adapter");

for (const runbookTerm of [
  "AWS",
  "Amazon SES",
  "email-smtp.<region>.amazonaws.com",
  "STARTTLS",
  "SES SMTP credentials",
  "production access",
  "DKIM",
  "SPF",
  "DMARC",
  "custom MAIL FROM",
  "Hostinger",
  "npm run v2:worker",
  "npm run v2:imap",
  "V2_OUTREACH_KILL_SWITCH",
]) {
  assert.match(files.runbook, new RegExp(escapeRegExp(runbookTerm), "i"), `runbook covers ${runbookTerm}`);
}

console.log("PASS V2 outreach AWS/send-ready smoke");

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}