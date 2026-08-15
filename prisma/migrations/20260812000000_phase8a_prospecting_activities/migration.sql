-- Phase 8a — activity types for the AI-managed prospecting transitions.
--
-- `lib/prospects/transitions.ts` requires a typed Activity for every operating-state change,
-- and ActivityType is a database enum. Reusing `stage_changed` would put operating-state moves
-- into the same bucket the Team View leaderboard groups sales-stage changes by, so the three
-- 8a transitions get their own values.
--
-- Additive only: no table, no column, no tenant-owned object. RLS coverage is unchanged.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'prospect_research_started';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'prospect_ready_for_outreach';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'prospect_ai_managed';
