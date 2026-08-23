-- Index the foreign keys whose parent the application actually deletes.
--
-- PostgreSQL does not index the referencing side of a foreign key. Deleting a parent therefore
-- scans every child table once to apply the referential action. This schema has 72 single-column
-- foreign keys with no index on the child column (23 pointing at "User", 9 at "Lead"), which is
-- why a single DELETE FROM "Lead" ran for over six minutes during a cleanup on 2026-08-23.
--
-- Only three of those 72 point at a parent the running application deletes. Everything reachable
-- from "Tenant", "User", "Lead", "Campaign" and "Client" is soft-deleted by policy, so those
-- foreign keys only guard deletes performed by tests and by scripts/purge-test-tenants.mjs, which
-- builds the indexes it needs and drops them again. Indexing all 72 permanently would add write
-- amplification to the hottest tables in the product to speed up an operation production never
-- performs.
--
-- These three are different: deleting a Template or an AbTestVariant is an action a user can take,
-- and it sets the columns below to NULL on every matching row. "OutboundMessage" is one of the
-- largest tables in the schema.
CREATE INDEX "OutboundMessage_templateId_idx" ON "OutboundMessage"("templateId");
CREATE INDEX "OutboundMessage_abVariantId_idx" ON "OutboundMessage"("abVariantId");
CREATE INDEX "SequenceStep_templateId_idx" ON "SequenceStep"("templateId");
