-- Add `archived` value to the LeadgenActivityType enum (standalone migration:
-- Postgres forbids using a newly added enum value in the same transaction).
ALTER TYPE "LeadgenActivityType" ADD VALUE IF NOT EXISTS 'archived';
