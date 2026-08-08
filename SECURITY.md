# Security Policy

Telestar CRM handles client contact data, staff credentials and connected email mailboxes.
A vulnerability here can expose one client's prospects to another, or send mail from a
customer's own inbox. Reports are taken seriously and answered.

## Supported versions

| Version | Supported |
| --- | --- |
| Latest commit on `main` | ✅ |
| Anything else | ❌ |

There is a single deployed environment and no release branches. Fixes land on `main` and
deploy from there; older images are never patched in place. If you are running an older
image, the fix is to deploy a newer one.

## Reporting a vulnerability

**Use GitHub's private vulnerability reporting:**

👉 https://github.com/sonnynguyen170321-ctrl/CRM-4-Telestar-Final/security/advisories/new

It is enabled on this repository. The report is visible only to the maintainers until a fix
ships, and it gives us a private place to ask you questions and to credit you.

> **Do not open a public issue for an exploitable finding.** A previous version of this file
> suggested "opening an issue in a secure manner" — there is no such thing. A public issue
> is a disclosure, and it is a disclosure that reaches attackers before it reaches a fix.
> Public issues remain the right place for everything that is *not* exploitable.

Once the production domain exists, a monitored `security@` mailbox will be added here as a
second channel for reporters who cannot or will not use GitHub. Until then, GitHub private
reporting is the only channel that is actually monitored, and pointing at an unmonitored
address would be worse than pointing at nothing.

### What to include

The more of this you can supply, the faster it gets fixed:

1. **Affected feature or endpoint** — e.g. "the client-report share link", "`POST /api/leads`".
2. **Reproduction** — exact steps, requests, or a short script. Say which role you were
   signed in as, or that you were unauthenticated.
3. **Impact** — what an attacker gets. "Reads another tenant's leads" and "crashes the
   page" are very different reports.
4. **Evidence** — a redacted response, a screenshot, a log excerpt. **Please redact
   credentials and personal data**; we do not need a working exploit against real data to
   believe you.
5. **Suggested mitigation**, if you have one. Optional and always welcome.

### What to expect

| Stage | Target |
| --- | --- |
| Acknowledgement that a human has read it | **2 business days** |
| Initial assessment — severity, whether reproduced | **5 business days** |
| Fix or documented mitigation for a confirmed critical finding | **14 days** |
| Advisory published, with credit if you want it | after the fix is deployed |

**Incident owner:** the repository owner (`@sonnynguyen170321-ctrl`), who is also the
Director-level operator of the deployment. There is currently no second on-call — a real
constraint, stated rather than papered over. If you do not get an acknowledgement in two
business days, escalate by opening a *public* issue that says only "awaiting response on a
private security report", with **no technical detail**.

## Escalation by category

These are the failure modes this system actually has, and what happens for each. Severity
is about blast radius, not about how clever the bug is.

| Category | Examples | Response |
| --- | --- | --- |
| **Credential exposure** | A secret in the repo or an image; a leaked `CRON_SECRET`, `AUTH_SECRET` or `ENCRYPTION_KEY`; a password in a log | **Rotate first, investigate second.** Assume disclosure from the moment it was committed — git history is not a place secrets can be deleted from. `ENCRYPTION_KEY` additionally requires re-encrypting stored mailbox credentials. |
| **Cross-tenant access** | One client's data visible to another; a query missing its `tenantId` scope; an RLS policy gap | Treated as the highest-severity class. The app-layer isolation in `lib/prisma.ts` is currently the only enforcement layer — see `docs/pre-domain-hardening/STATUS.md` — so a bypass has no second net beneath it. |
| **Unauthorized email** | Sending from a connected mailbox without an operator action; a sequence firing while autosend is off; duplicate delivery | Disable sending immediately (`SEQUENCE_AUTOSEND_ENABLED=false`, `EMAIL_SEND_DRY_RUN=true`) before diagnosing. Reputation damage to a customer's sending domain is not reversible. |
| **Database loss or corruption** | A destructive migration, a seed run against the wrong database, mass deletion | Restore from the Cloud SQL backup taken before the change. `prisma/seed-demo.ts` is guarded (`lib/seed-guard.ts`) but the guard is the last line, not the only one. |
| **Remote code execution** | Arbitrary code on the web or worker host; a compromised dependency or base image | Take the deployment offline rather than patch in place. Rotate every secret the host could read, and redeploy from a known-good image digest — `scripts/rollback.sh`. |

## Scope

**In scope:** this application, its API, its workers, its container image, and this
repository's CI configuration.

**Out of scope:** the third-party services it integrates with (Microsoft Graph, Google,
Apollo), automated scanner output with no demonstrated impact, missing headers on endpoints
that serve no content, and denial of service by volume. Social engineering of Telestar staff
is out of scope.

## Known and accepted, as of 2026-08-08

Reporting these is not necessary — they are tracked in
`docs/pre-domain-hardening/PLAN.md`:

- The deployment is served over **plain HTTP** on a bare IP. Credentials cross in cleartext.
  This is why the operating restrictions forbid real client data on it, and it is the single
  largest known weakness.
- **Database-level RLS is not enabled** (`DB_RLS_ENFORCED` is unset). Policies and roles
  exist and are tested; enabling them is pending a staging target.
- **`script-src` allows `'unsafe-inline'`** and CSP runs in report-only mode.
- The seeded demo password `telestar2026` is published in this repository and still works on
  the live demo deployment.

If you find something in one of those areas that is *worse than described*, that is very
much worth reporting.
