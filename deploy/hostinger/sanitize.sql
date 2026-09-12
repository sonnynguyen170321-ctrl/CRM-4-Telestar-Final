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

COMMIT;
