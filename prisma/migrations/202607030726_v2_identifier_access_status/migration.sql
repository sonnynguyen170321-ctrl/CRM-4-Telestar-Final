-- Add LinkedIn-access states to the contact-identifier validity enum (additive; no rewrite).
-- Used to filter contacts whose LinkedIn is 404 / private during upload, scoring, and leads.
ALTER TYPE "V2ContactIdentifierValidityStatus" ADD VALUE IF NOT EXISTS 'NOT_FOUND';
ALTER TYPE "V2ContactIdentifierValidityStatus" ADD VALUE IF NOT EXISTS 'PRIVATE';
