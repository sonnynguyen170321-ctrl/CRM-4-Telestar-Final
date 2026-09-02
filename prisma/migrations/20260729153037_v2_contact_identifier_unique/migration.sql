-- Idempotent identifier writes (Inv 6): one value per (org, type, value, contact). Collapse any
-- pre-existing duplicates (keep the newest) BEFORE creating the unique index, or index creation fails.
DELETE FROM "V2ContactIdentifier" a
 USING "V2ContactIdentifier" b
 WHERE a."organizationId" = b."organizationId"
   AND a."type" = b."type"
   AND a."normalizedValue" = b."normalizedValue"
   AND a."contactId" = b."contactId"
   AND (a."createdAt" < b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

CREATE UNIQUE INDEX IF NOT EXISTS "V2ContactIdentifier_organizationId_type_normalizedValue_contactId_key"
  ON "V2ContactIdentifier" ("organizationId", "type", "normalizedValue", "contactId");
