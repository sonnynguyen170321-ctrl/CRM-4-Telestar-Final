-- Contacts & Leads mock: add PAUSED workflow status. Isolated in its own migration
-- so the enum value commits before any later migration uses it. Additive only.
ALTER TYPE "V2LeadWorkflowStatus" ADD VALUE IF NOT EXISTS 'PAUSED' AFTER 'NURTURE';
