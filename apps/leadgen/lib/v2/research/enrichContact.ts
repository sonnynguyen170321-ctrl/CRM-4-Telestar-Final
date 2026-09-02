import "server-only";

import { createHash } from "node:crypto";
import { resolveMx, resolveTxt } from "node:dns/promises";

import { safeFetch } from "@telestar/core-search/safeFetch";
import { bestEmailGuess, guessEmailPatterns } from "./findContactEmail";
import { extractEmails, extractPhones, pickBestEmail } from "./contactExtract";

// Contact email waterfall (clean-room OpenLeads-style): public exact email -> learned pattern
// -> common pattern -> DNS/MX/SPF/DMARC -> optional Reacher -> optional Gravatar -> optional
// SMTP through @devmehq. Network-heavy probes are env-gated; failed/missing signals are recorded
// but never increase confidence.

export type EmailStatus = "VERIFIED" | "LIKELY" | "GUESSED" | "RISKY" | "INVALID" | "MISSING";
export type ContactChannelKind = "EMAIL" | "PHONE";
export type ContactChannelScope = "PERSON" | "COMPANY" | "UNKNOWN";
export type ContactChannelVerification = "VERIFIED" | "CORROBORATED" | "UNVERIFIED" | "INVALID";
export type ContactChannelUsageDecision = "AUTO_USABLE" | "MANUAL_APPROVED" | "REVIEW_REQUIRED" | "BLOCKED";
export type ContactChannelDecision = {
  kind: ContactChannelKind;
  value: string;
  scope: ContactChannelScope;
  verification: ContactChannelVerification;
  usageDecision: ContactChannelUsageDecision;
  confidence: number;
  reasons: string[];
  source: "public_exact_email" | "learned_pattern" | "common_pattern" | "public_company_phone";
};
export type ContactWaterfallStage =
  | "public_exact_email"
  | "learned_pattern"
  | "common_pattern"
  | "mx"
  | "spf"
  | "dmarc"
  | "reacher"
  | "gravatar"
  | "smtp"
  | "final_assessment";
export type ContactWaterfallStep = {
  stage: ContactWaterfallStage;
  status: "hit" | "miss" | "skipped" | "failed";
  detail: string;
  email?: string | null;
};
export type ContactDetails = {
  email: string | null;
  emailStatus: EmailStatus;
  phone: string | null;
  waterfall: ContactWaterfallStep[];
  emailDecision: ContactChannelDecision | null;
  phoneDecision: ContactChannelDecision | null;
};

export type ContactEnrichmentContext = { organizationId?: string | null; runId?: string | null; candidateId?: string | null };

type EmailCandidate = { email: string; source: "public_exact_email" | "learned_pattern" | "common_pattern"; baseStatus: EmailStatus; detail: string };
type VerifySignals = { validFormat: boolean; validMx: boolean | null; validSmtp: boolean | null; reacher: "safe" | "risky" | "invalid" | "unknown" | "skipped"; spf: boolean | null; dmarc: boolean | null; gravatar: boolean | null };

const HARVEST_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us"];
const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 400_000;
const ROLE_LOCAL_PARTS = new Set(["admin", "billing", "careers", "contact", "hello", "hr", "info", "jobs", "marketing", "media", "office", "press", "sales", "security", "support", "team"]);

/** Pure: map verifier results to the final contact email tier. */
export function classifyVerify(
  r: { validFormat: boolean; validMx: boolean | null; validSmtp: boolean | null; reacher?: "safe" | "risky" | "invalid" | "unknown" | "skipped" },
  source: "public_exact_email" | "learned_pattern" | "common_pattern"
): EmailStatus {
  if (!r.validFormat) return "INVALID";
  if (r.validMx === false || r.reacher === "invalid") return "INVALID";
  if (r.validSmtp === true || r.reacher === "safe") return "VERIFIED";
  if (r.reacher === "risky") return "RISKY";
  if (source === "public_exact_email") return r.validMx === true ? "LIKELY" : "LIKELY";
  if (source === "learned_pattern") return r.validMx === true ? "LIKELY" : "GUESSED";
  return r.validMx === true ? "GUESSED" : "RISKY";
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, { method: "GET", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; TelestarResearchBot/1.0)" } });
    if (!res.ok || res.status >= 400) return null;
    const buf = await res.response.arrayBuffer();
    return Buffer.from(buf.slice(0, MAX_HTML_BYTES)).toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyViaReacher(email: string, reacherUrl: string): Promise<"safe" | "risky" | "invalid" | "unknown"> {
  try {
    const res = await safeFetch(`${reacherUrl.replace(/\/$/, "")}/v0/check_email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to_email: email }),
    });
    if (!res.ok) return "unknown";
    const json = (await res.response.json()) as { is_reachable?: string };
    if (json.is_reachable === "safe") return "safe";
    if (json.is_reachable === "invalid") return "invalid";
    if (json.is_reachable === "risky") return "risky";
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function verifyEmailAddress(email: string, source: EmailCandidate["source"], env: NodeJS.ProcessEnv, steps: ContactWaterfallStep[]): Promise<{ status: EmailStatus; signals: VerifySignals }> {
  const domain = email.split("@")[1] ?? "";
  const validFormat = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email);
  const signals: VerifySignals = { validFormat, validMx: null, validSmtp: null, reacher: "skipped", spf: null, dmarc: null, gravatar: null };
  if (!validFormat) {
    steps.push({ stage: "final_assessment", status: "failed", detail: "Email syntax is invalid.", email });
    return { status: "INVALID", signals };
  }

  signals.validMx = await hasMx(domain);
  steps.push({ stage: "mx", status: signals.validMx ? "hit" : signals.validMx === false ? "failed" : "miss", detail: signals.validMx ? "MX record exists." : signals.validMx === false ? "No MX record found." : "MX lookup unavailable.", email });
  signals.spf = await hasTxtSignal(domain, "spf1");
  steps.push({ stage: "spf", status: signals.spf ? "hit" : signals.spf === false ? "miss" : "failed", detail: signals.spf ? "SPF record found." : signals.spf === false ? "No SPF record found." : "SPF lookup unavailable.", email });
  signals.dmarc = await hasTxtSignal(`_dmarc.${domain}`, "v=dmarc1");
  steps.push({ stage: "dmarc", status: signals.dmarc ? "hit" : signals.dmarc === false ? "miss" : "failed", detail: signals.dmarc ? "DMARC record found." : signals.dmarc === false ? "No DMARC record found." : "DMARC lookup unavailable.", email });

  const reacherUrl = env.REACHER_URL?.trim();
  if (reacherUrl) {
    signals.reacher = await verifyViaReacher(email, reacherUrl);
    steps.push({ stage: "reacher", status: signals.reacher === "safe" ? "hit" : signals.reacher === "invalid" ? "failed" : signals.reacher === "risky" ? "hit" : "miss", detail: `Reacher result: ${signals.reacher}.`, email });
  } else {
    steps.push({ stage: "reacher", status: "skipped", detail: "Reacher not configured.", email });
  }

  if ((env.RESEARCH_GRAVATAR_SIGNAL ?? "").trim() === "1") {
    signals.gravatar = await hasGravatar(email);
    steps.push({ stage: "gravatar", status: signals.gravatar ? "hit" : signals.gravatar === false ? "miss" : "failed", detail: signals.gravatar ? "Gravatar profile exists." : signals.gravatar === false ? "No Gravatar profile." : "Gravatar lookup unavailable.", email });
  } else {
    steps.push({ stage: "gravatar", status: "skipped", detail: "Gravatar disabled.", email });
  }

  try {
    const { verifyEmail } = await import("@devmehq/email-validator-js");
    const result = await verifyEmail({
      emailAddress: email,
      verifyMx: false,
      verifySmtp: (env.RESEARCH_SMTP_PROBE ?? "").trim() === "1",
      timeout: 8000,
    });
    signals.validSmtp = result.validSmtp;
    steps.push({ stage: "smtp", status: result.validSmtp === true ? "hit" : (env.RESEARCH_SMTP_PROBE ?? "").trim() === "1" ? "miss" : "skipped", detail: (env.RESEARCH_SMTP_PROBE ?? "").trim() === "1" ? "SMTP probe completed." : "SMTP disabled.", email });
  } catch {
    steps.push({ stage: "smtp", status: (env.RESEARCH_SMTP_PROBE ?? "").trim() === "1" ? "failed" : "skipped", detail: (env.RESEARCH_SMTP_PROBE ?? "").trim() === "1" ? "SMTP probe failed." : "SMTP disabled.", email });
  }

  const status = classifyVerify({ validFormat, validMx: signals.validMx, validSmtp: signals.validSmtp, reacher: signals.reacher }, source);
  steps.push({ stage: "final_assessment", status: status === "INVALID" ? "failed" : "hit", detail: `Final email tier: ${status}.`, email });
  return { status, signals };
}

/** Waterfall lookup for a person at a company domain. */
export async function findContactDetails(
  input: { fullName: string; companyDomain: string | null; defaultCountry?: string | null } & ContactEnrichmentContext,
  env: NodeJS.ProcessEnv = process.env
): Promise<ContactDetails> {
  const domain = cleanDomain(input.companyDomain);
  const steps: ContactWaterfallStep[] = [];
  if (!domain) {
    steps.push({ stage: "final_assessment", status: "miss", detail: "No company domain; contact email cannot be inferred." });
    return finish(input, { email: null, emailStatus: "MISSING", phone: null, waterfall: steps, emailDecision: null, phoneDecision: null });
  }

  const emails = new Set<string>();
  const phones: string[] = [];
  let pagesFetched = 0;
  for (const path of HARVEST_PATHS) {
    const html = await fetchHtml(`https://${domain}${path}`);
    if (!html) continue;
    pagesFetched += 1;
    for (const e of extractEmails(html, domain)) emails.add(e);
    if (phones.length === 0) phones.push(...extractPhones(html, (input.defaultCountry as never) || undefined));
    if (emails.size > 0 && phones.length > 0) break;
  }
  steps.push({ stage: "public_exact_email", status: emails.size > 0 ? "hit" : "miss", detail: pagesFetched > 0 ? `${emails.size} public emails harvested from ${pagesFetched} pages.` : "No public pages could be harvested." });

  const candidates = await buildEmailCandidates(input.fullName, domain, Array.from(emails), input.organizationId ?? null, steps);
  const selected = candidates[0] ?? null;
  if (!selected) {
    steps.push({ stage: "final_assessment", status: "miss", detail: "No personal email candidate found. Role emails were kept as company evidence only." });
    const phone = phones[0] ?? null;
    return finish(input, { email: null, emailStatus: "MISSING", phone, waterfall: steps, emailDecision: null, phoneDecision: phone ? decidePhoneChannel(phone) : null });
  }

  const { status } = await verifyEmailAddress(selected.email, selected.source, env, steps);
  const phone = phones[0] ?? null;
  return finish(input, {
    email: selected.email,
    emailStatus: status,
    phone,
    waterfall: steps,
    emailDecision: decideEmailChannel(selected.email, status, selected.source),
    phoneDecision: phone ? decidePhoneChannel(phone) : null,
  });
}

async function buildEmailCandidates(fullName: string, domain: string, harvestedEmails: string[], organizationId: string | null, steps: ContactWaterfallStep[]): Promise<EmailCandidate[]> {
  const out: EmailCandidate[] = [];
  const personalHarvested = harvestedEmails.filter((email) => !isRoleEmail(email));
  const exact = pickBestEmail(personalHarvested, fullName, domain);
  if (exact && emailLocalMatchesName(exact, fullName)) {
    out.push({ email: exact, source: "public_exact_email", baseStatus: "LIKELY", detail: "Public same-domain personal email matches the contact name." });
    steps.push({ stage: "public_exact_email", status: "hit", detail: "Public exact person email found.", email: exact });
  } else {
    steps.push({ stage: "public_exact_email", status: "miss", detail: personalHarvested.length > 0 ? "Public emails exist but do not confidently match the person." : "No public personal email found." });
  }

  if (organizationId) {
    const { listResearchEmailPatterns } = await import("./evidenceStore");
    const patterns = await listResearchEmailPatterns(organizationId, domain, 5);
    for (const pattern of patterns) {
      const email = applyPattern(fullName, domain, pattern.pattern);
      if (email) out.push({ email, source: "learned_pattern", baseStatus: "LIKELY", detail: `Learned pattern ${pattern.pattern} (${pattern.confidence} confidence).` });
    }
    steps.push({ stage: "learned_pattern", status: patterns.length > 0 ? "hit" : "miss", detail: patterns.length > 0 ? `${patterns.length} learned patterns available.` : "No learned pattern for this domain." });
  } else {
    steps.push({ stage: "learned_pattern", status: "skipped", detail: "No organization context for learned pattern lookup." });
  }

  const common = bestEmailGuess(fullName, domain)?.email ?? guessEmailPatterns(fullName, domain)[0] ?? null;
  if (common) {
    out.push({ email: common, source: "common_pattern", baseStatus: "GUESSED", detail: "Common first.last pattern guess." });
    steps.push({ stage: "common_pattern", status: "hit", detail: "Common pattern candidate generated.", email: common });
  } else {
    steps.push({ stage: "common_pattern", status: "miss", detail: "Name/domain did not produce a common pattern." });
  }

  const seen = new Set<string>();
  return out.filter((candidate) => {
    const key = candidate.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function finish(input: ContactEnrichmentContext, details: ContactDetails): Promise<ContactDetails> {
  if (!input.organizationId || !input.candidateId) return details;
  const { buildResearchEvidenceKey, recordResearchEvidence, recordResearchFieldObservation, recordResearchProviderAttempt } = await import("./evidenceStore");
  const evidenceId = await recordResearchEvidence({
    organizationId: input.organizationId,
    runId: input.runId ?? null,
    candidateId: input.candidateId,
    idempotencyKey: buildResearchEvidenceKey(["contact-waterfall", input.candidateId, details.email ?? "missing"]),
    sourceKind: "contact_email_waterfall",
    provider: "telestar_waterfall",
    confidence: statusConfidence(details.emailStatus),
    evidenceJson: { email: details.email, emailStatus: details.emailStatus, phone: details.phone, emailDecision: details.emailDecision, phoneDecision: details.phoneDecision, waterfall: details.waterfall },
  });
  await recordResearchFieldObservation({ organizationId: input.organizationId, candidateId: input.candidateId, evidenceId, fieldName: "email_tier", valueText: details.emailStatus, confidence: statusConfidence(details.emailStatus), sourceKind: "contact_email_waterfall" });
  if (details.email) await recordResearchFieldObservation({ organizationId: input.organizationId, candidateId: input.candidateId, evidenceId, fieldName: "email", valueText: details.email, confidence: statusConfidence(details.emailStatus), sourceKind: "contact_email_waterfall" });
  if (details.phone) await recordResearchFieldObservation({ organizationId: input.organizationId, candidateId: input.candidateId, evidenceId, fieldName: "phone", valueText: details.phone, confidence: 65, sourceKind: "contact_email_waterfall" });
  await recordResearchProviderAttempt({
    organizationId: input.organizationId,
    runId: input.runId ?? null,
    candidateId: input.candidateId,
    stage: "research.contact_enrich",
    provider: "telestar_waterfall",
    status: details.email || details.phone ? "SUCCEEDED" : "SKIPPED",
    responseJson: { emailStatus: details.emailStatus, steps: details.waterfall.map((step) => ({ stage: step.stage, status: step.status })) },
  });
  return details;
}

export function decideEmailChannel(email: string, status: EmailStatus, source: "public_exact_email" | "learned_pattern" | "common_pattern"): ContactChannelDecision {
  const generic = isRoleEmail(email);
  if (status === "INVALID") {
    return {
      kind: "EMAIL",
      value: email,
      scope: generic ? "COMPANY" : "UNKNOWN",
      verification: "INVALID",
      usageDecision: "BLOCKED",
      confidence: 0,
      reasons: ["email_invalid"],
      source,
    };
  }

  if (status === "VERIFIED" && !generic) {
    return {
      kind: "EMAIL",
      value: email,
      scope: "PERSON",
      verification: "VERIFIED",
      usageDecision: "AUTO_USABLE",
      confidence: statusConfidence(status),
      reasons: ["person_email_verified"],
      source,
    };
  }

  return {
    kind: "EMAIL",
    value: email,
    scope: generic ? "COMPANY" : "UNKNOWN",
    verification: status === "LIKELY" ? "CORROBORATED" : "UNVERIFIED",
    usageDecision: generic ? "BLOCKED" : "REVIEW_REQUIRED",
    confidence: statusConfidence(status),
    reasons: generic ? ["role_email_not_person"] : [`email_${status.toLowerCase()}_requires_review`],
    source,
  };
}

export function decidePhoneChannel(phone: string): ContactChannelDecision {
  return {
    kind: "PHONE",
    value: phone,
    scope: "COMPANY",
    verification: "UNVERIFIED",
    usageDecision: "REVIEW_REQUIRED",
    confidence: 65,
    reasons: ["public_company_phone_not_person_direct"],
    source: "public_company_phone",
  };
}

export function canPersistContactDecision(decision: ContactChannelDecision | null): boolean {
  return decision?.usageDecision === "AUTO_USABLE" || decision?.usageDecision === "MANUAL_APPROVED";
}

export function contactIdentifierValidity(decision: ContactChannelDecision): "VALID" | "INVALID" | "UNKNOWN" {
  if (decision.verification === "VERIFIED") return "VALID";
  if (decision.verification === "INVALID" || decision.usageDecision === "BLOCKED") return "INVALID";
  return "UNKNOWN";
}

async function hasMx(domain: string): Promise<boolean | null> {
  try {
    const rows = await resolveMx(domain);
    return rows.length > 0;
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "ENODATA" || code === "ENOTFOUND" ? false : null;
  }
}

async function hasTxtSignal(domain: string, needle: string): Promise<boolean | null> {
  try {
    const rows = await resolveTxt(domain);
    return rows.some((row) => row.join("").toLowerCase().includes(needle.toLowerCase()));
  } catch (error) {
    const code = (error as { code?: string }).code;
    return code === "ENODATA" || code === "ENOTFOUND" ? false : null;
  }
}

async function hasGravatar(email: string): Promise<boolean | null> {
  try {
    const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
    const res = await safeFetch(`https://www.gravatar.com/avatar/${hash}?d=404`, { method: "HEAD" });
    if (!res.ok) return null;
    if (res.response.status === 200) return true;
    if (res.response.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

function applyPattern(fullName: string, domain: string, pattern: string): string | null {
  const { first, last } = nameParts(fullName);
  if (!first) return null;
  const local = pattern
    .toLowerCase()
    .replace(/first_initial/g, first[0] ?? "")
    .replace(/last_initial/g, last?.[0] ?? "")
    .replace(/first/g, first)
    .replace(/last/g, last ?? "");
  if (!local || local.includes("undefined")) return null;
  return `${local}@${domain}`;
}

function emailLocalMatchesName(email: string, fullName: string): boolean {
  const local = email.split("@")[0] ?? "";
  const { first, last } = nameParts(fullName);
  return Boolean(first && local.includes(first)) || Boolean(last && local.includes(last));
}

export function isRoleEmail(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return ROLE_LOCAL_PARTS.has(local) || local.includes("+");
}

function nameParts(fullName: string): { first: string; last: string | null } {
  const tokens = fullName.trim().split(/\s+/).map(asciiFold).filter(Boolean);
  if (tokens.length === 0) return { first: "", last: null };
  if (tokens.length === 1) return { first: tokens[0], last: null };
  return { first: tokens[0], last: tokens[tokens.length - 1] };
}

function asciiFold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/g, "d").replace(/\u0110/g, "D").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanDomain(domain: string | null | undefined): string | null {
  const raw = domain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw) ? raw : null;
}

function statusConfidence(status: EmailStatus): number {
  if (status === "VERIFIED") return 95;
  if (status === "LIKELY") return 78;
  if (status === "GUESSED") return 58;
  if (status === "RISKY") return 35;
  if (status === "INVALID") return 0;
  return 0;
}
