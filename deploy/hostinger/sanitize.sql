-- Scrub a restored copy of the CRM database before it leaves the VPS (backup.sh --sanitize).
-- Runs against a throwaway scratch database, never the live one. Keeps row counts, ids and
-- relationships intact so a production bug reproduces locally; replaces every value that
-- identifies a person or grants access.
--
-- Emails keep their uniqueness (id-derived) so unique indexes and dedupe logic still behave.
-- Add a line here whenever a migration adds a PII or credential column — the column list
-- comes from prisma/schema.prisma, grep for email|phone|token|secret|password|keyHash.

BEGIN;

-- People
UPDATE "User"     SET email = 'user-' || id || '@example.invalid', "firstName" = 'User', "lastName" = left(id, 6), password = 'sanitized';
UPDATE "Contact"  SET email = CASE WHEN email IS NULL THEN NULL ELSE 'contact-' || id || '@example.invalid' END,
                      "normalizedEmail" = CASE WHEN "normalizedEmail" IS NULL THEN NULL ELSE 'contact-' || id || '@example.invalid' END,
                      "alternateEmail" = NULL, "alternateEmailValidation" = NULL,
                      phone = NULL, "secondaryPhone" = NULL, "normalizedPhone" = NULL,
                      "firstName" = 'Contact', "lastName" = left(id, 6);
UPDATE "Lead"     SET email = CASE WHEN email IS NULL THEN NULL ELSE 'lead-' || id || '@example.invalid' END,
                      "normalizedEmail" = CASE WHEN "normalizedEmail" IS NULL THEN NULL ELSE 'lead-' || id || '@example.invalid' END,
                      phone = NULL, "normalizedPhone" = NULL,
                      "firstName" = 'Lead', "lastName" = left(id, 6);
UPDATE "LeadPoolItem" SET email = CASE WHEN email IS NULL THEN NULL ELSE 'pool-' || id || '@example.invalid' END,
                      phone = NULL, "firstName" = 'Pool', "lastName" = left(id, 6);
UPDATE "Account"  SET "companyPhone" = NULL;
UPDATE "Client"   SET "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN NULL ELSE 'client-' || id || '@example.invalid' END;
UPDATE "Meeting"  SET "prospectEmail" = 'meeting-' || id || '@example.invalid', "clientOwnerEmail" = NULL;
UPDATE "Opportunity" SET "contactEmail" = NULL, "contactPhone" = NULL, "clientOwnerEmail" = NULL;
UPDATE "BookingLink" SET "ownerEmail" = 'booking-' || id || '@example.invalid';
UPDATE "ClientReportRecipient" SET email = 'recipient-' || id || '@example.invalid';
UPDATE "InboundMessage" SET "fromEmail" = 'inbound-' || id || '@example.invalid';
UPDATE "SuppressionEntry" SET email = 'suppressed-' || id || '@example.invalid';

-- Credentials and grants: invalidate outright.
UPDATE "EmailAccount" SET "accessToken" = NULL, "refreshToken" = NULL,
                          "encAccessToken" = NULL, "encRefreshToken" = NULL, "encPassword" = NULL,
                          email = 'mailbox-' || id || '@example.invalid';
UPDATE "ApiKey" SET "keyHash" = 'sanitized-' || id;
UPDATE "Webhook" SET secret = 'sanitized';
UPDATE "ClientReportShareLink" SET "tokenHash" = 'sanitized-' || id, "passwordHash" = NULL;
UPDATE "WorkOrderLease" SET "claimToken" = 'sanitized-' || id;
UPDATE "AccountResearchCache" SET "claimToken" = NULL WHERE "claimToken" IS NOT NULL;
UPDATE "ContactResearchCache" SET "claimToken" = NULL WHERE "claimToken" IS NOT NULL;

-- Message bodies can quote people. Keep subjects (useful for repro), blank bodies.
UPDATE "OutboundMessage" SET body = '[sanitized]' WHERE body IS NOT NULL;
UPDATE "InboundMessage"  SET body = '[sanitized]' WHERE body IS NOT NULL;

-- ── Free text a human typed, and JSON that echoes it ────────────────────────────────────────
-- Everything below was missed by the first version of this file. A note body, an audit-log diff
-- or a raw import row carries exactly the names, addresses and email addresses the UPDATEs above
-- remove from their own columns — scrubbing the structured copy and leaving the free-text one is
-- not a scrub. `scripts/check-sanitize-coverage.mjs` derives the list from prisma/schema.prisma
-- so a new column cannot be forgotten; anything deliberately kept is recorded with its reason in
-- sanitize-exemptions.json.
UPDATE "Note"               SET content = '[sanitized]';
UPDATE "Reminder"           SET text = '[sanitized]';
UPDATE "Notification"       SET text = '[sanitized]';
UPDATE "Task"               SET description = NULL, notes = NULL;
UPDATE "AiMemory"           SET memory = '[sanitized]';
UPDATE "EmailHealthAlert"   SET message = '[sanitized]';
UPDATE "SuppressionEntry"   SET reason = '[sanitized]';
UPDATE "CampaignLeadRequirement" SET notes = NULL;
UPDATE "ClientReport"       SET summary = NULL;
UPDATE "CompanySignal"      SET summary = '[sanitized]';
UPDATE "ContactEvidence"    SET summary = NULL;

-- Audit trails record the before/after of the very fields scrubbed above, plus the operator's IP.
UPDATE "AuditLog" SET "changedFields" = NULL, "ipAddress" = NULL, "userAgent" = NULL;

-- Activity feeds quote lead and contact details in their description and metadata.
UPDATE "Activity"            SET description = NULL, metadata = NULL;
UPDATE "LeadgenActivity"     SET description = NULL, metadata = NULL;
UPDATE "OpportunityActivity" SET description = NULL, metadata = NULL;
UPDATE "OutcomeSignal"       SET metadata = NULL;

-- Uploaded rows staged before promotion: the raw CSV, names and addresses included.
UPDATE "ImportRow" SET data = '{}', errors = NULL;

-- Correspondence. `body` alone was blanked before, leaving the HTML part with the full quoted
-- thread, and the subject line with the prospect's name in it.
UPDATE "InboundMessage"  SET subject = '[sanitized]', "bodyHtml" = NULL;
UPDATE "OutboundMessage" SET subject = '[sanitized]';

-- Copy rendered for one contact — merge fields already substituted, so this is personal data.
-- The reusable Template and AbTestVariant it was rendered from are exempt and kept.
UPDATE "SequenceStepCopy" SET subject = '[sanitized]', body = '[sanitized]';

-- Base64 file blobs hanging off templates: contracts, brochures, anything an operator attached.
UPDATE "Attachment" SET content = '[sanitized]';

-- Display names the earlier pass missed, and the sender identity block, which carries the user's
-- real name, title and direct phone number.
UPDATE "Contact"      SET "fullName" = 'Contact ' || left(id, 6) WHERE "fullName" IS NOT NULL;
UPDATE "LeadPoolItem" SET "fullName" = 'Pool ' || left(id, 6) WHERE "fullName" IS NOT NULL;
UPDATE "EmailAccount" SET signature = NULL;

-- Person names carried alongside the email columns already scrubbed above. Missed by the first
-- pass because it grepped for `email|phone|token`; `contactName` and `prospectName` hold exactly
-- the same person. Derived from the row id so the value stays unique and renderable.
UPDATE "Client"      SET "contactName" = 'Contact ' || left(id, 6);
UPDATE "BookingLink" SET "ownerName" = NULL;
UPDATE "Meeting"     SET "prospectName" = 'Prospect ' || left(id, 6), "clientOwnerName" = NULL;
UPDATE "Opportunity" SET "contactName" = NULL, "clientOwnerName" = NULL;

-- ── Research discovery (added by the crm4 work) ──────────────────────────────────────────────
-- Candidates and prospects harvested from the open web: a guessed work address, a phone and a
-- LinkedIn profile are a named individual just as much as Contact.email is. Caught by
-- scripts/check-sanitize-coverage.mjs when the schema grew from 68 models to 81 — which is the
-- point of deriving the list rather than maintaining it.
UPDATE "ResearchCandidate" SET "emailGuess" = NULL, "emailStatus" = NULL, phone = NULL, "linkedinUrl" = NULL;
UPDATE "ResearchProspect"  SET "displayName" = 'Prospect ' || left(id, 6), "linkedinUrl" = NULL;

-- The normalised form of the name scrubbed above; leaving it re-identifies the row.
UPDATE "Contact" SET "fullNameNormalized" = NULL;

COMMIT;
