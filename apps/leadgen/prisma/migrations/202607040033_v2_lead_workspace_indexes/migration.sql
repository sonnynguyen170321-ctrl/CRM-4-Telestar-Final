-- Lead-workspace hot-path indexes. Every per-contact LATERAL in queryContactLeads keys on
-- contactId, but these tables had no contactId-leading index; V2LeadAssignment also lacked
-- an updatedAt index for the newest-active-assignment ORDER BY. Additive only.
CREATE INDEX IF NOT EXISTS "V2OutreachActivity_org_contact_occurredAt_idx"
  ON "V2OutreachActivity" ("organizationId", "contactId", "occurredAt");
CREATE INDEX IF NOT EXISTS "V2ActivityRecord_org_contact_occurredAt_idx"
  ON "V2ActivityRecord" ("organizationId", "contactId", "occurredAt");
CREATE INDEX IF NOT EXISTS "V2SequenceEnrollment_org_contact_status_idx"
  ON "V2SequenceEnrollment" ("organizationId", "contactId", "status");
CREATE INDEX IF NOT EXISTS "V2ManagerReviewItem_org_contact_idx"
  ON "V2ManagerReviewItem" ("organizationId", "contactId");
CREATE INDEX IF NOT EXISTS "V2LeadAssignment_contact_updatedAt_idx"
  ON "V2LeadAssignment" ("contactId", "updatedAt");
