import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// O9 smoke: live-send cutover guards. Live send is allowed ONLY when every guard
// passes (kill switch, org/sender flags, per-kind SPF/DKIM/DMARC, warmup, caps,
// List-Unsubscribe). Pure.

const require = createRequire(import.meta.url);
const ts = require("typescript");
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleCache = new Map();

const { canLiveSend, isKillSwitchEngaged } = loadTsModule("lib/v2/outreach/limits/liveSendGuards.ts");

const relayOk = {
  killSwitchEngaged: false,
  orgLiveSendEnabled: true,
  sender: { id: "r", kind: "RELAY", warmupStage: 0, dailyCapCurrent: 0, dailyCapTarget: 5000, sentToday: 100, liveSendEnabled: true },
  deliverability: { spf: true, dkim: true, dmarc: true, customDomainDkim: false, isPlainGmail: false },
  hasListUnsubscribe: true,
};

// 1. A fully-configured relay is allowed
assert.equal(canLiveSend(relayOk).allowed, true, "configured relay allowed");

// 2. Each guard blocks
assert.deepEqual(canLiveSend({ ...relayOk, killSwitchEngaged: true }).reasons.includes("kill_switch_engaged"), true);
assert.ok(canLiveSend({ ...relayOk, orgLiveSendEnabled: false }).reasons.includes("org_live_send_disabled"));
assert.ok(canLiveSend({ ...relayOk, sender: { ...relayOk.sender, liveSendEnabled: false } }).reasons.includes("sender_live_send_disabled"));
assert.ok(canLiveSend({ ...relayOk, hasListUnsubscribe: false }).reasons.includes("missing_list_unsubscribe"), "List-Unsubscribe required (B4)");
assert.ok(canLiveSend({ ...relayOk, deliverability: { ...relayOk.deliverability, dmarc: false } }).reasons.includes("relay_missing_spf_dkim_dmarc"), "relay needs SPF+DKIM+DMARC");
assert.ok(canLiveSend({ ...relayOk, sender: { ...relayOk.sender, sentToday: 5000 } }).reasons.includes("daily_cap_exceeded"), "over cap blocked");
console.log("PASS each live-send guard blocks (kill switch, flags, unsubscribe, SPF/DKIM/DMARC, cap)");

// 3. MAILBOX: warmed + custom DKIM allowed; unwarmed blocked; plain gmail flagged not blocked
const warmedMailbox = {
  ...relayOk,
  sender: { id: "m", kind: "MAILBOX", warmupStage: 5, dailyCapCurrent: 200, dailyCapTarget: 500, sentToday: 10, liveSendEnabled: true },
  deliverability: { spf: true, dkim: true, dmarc: true, customDomainDkim: true, isPlainGmail: false },
};
assert.equal(canLiveSend(warmedMailbox).allowed, true, "warmed Workspace mailbox allowed");
assert.ok(canLiveSend({ ...warmedMailbox, sender: { ...warmedMailbox.sender, warmupStage: 0 } }).reasons.includes("mailbox_not_warmed"), "unwarmed mailbox blocked");
assert.ok(canLiveSend({ ...warmedMailbox, deliverability: { ...warmedMailbox.deliverability, customDomainDkim: false } }).reasons.includes("mailbox_missing_dkim"), "Workspace needs DKIM");
const plainGmail = canLiveSend({ ...warmedMailbox, deliverability: { ...warmedMailbox.deliverability, isPlainGmail: true, customDomainDkim: false } });
assert.equal(plainGmail.allowed, true, "plain gmail allowed");
assert.ok(plainGmail.flags.includes("plain_gmail_low_deliverability"), "plain gmail flagged (capped/weak), not blocked");
console.log("PASS MAILBOX per-kind: warmed+DKIM allowed; unwarmed/no-DKIM blocked; plain gmail flagged");

// 4. Kill switch env
assert.equal(isKillSwitchEngaged({ V2_OUTREACH_KILL_SWITCH: "true" }), true);
assert.equal(isKillSwitchEngaged({ V2_OUTREACH_KILL_SWITCH: "1" }), true);
assert.equal(isKillSwitchEngaged({}), false);
console.log("PASS kill switch env flag");
console.log("PASS V2 live-send cutover guards (O9)");

function loadTsModule(relativePath) {
  const absolutePath = resolve(rootDir, relativePath);
  if (moduleCache.has(absolutePath)) return moduleCache.get(absolutePath).exports;
  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const loadedModule = { exports: {} };
  moduleCache.set(absolutePath, loadedModule);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith(".")) { const base = resolve(dirname(absolutePath), specifier); for (const c of [`${base}.ts`, `${base}/index.ts`]) if (existsSync(c)) return loadTsModule(c.slice(rootDir.length + 1)); }
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
