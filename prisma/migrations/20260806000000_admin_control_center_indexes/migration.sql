-- Indexes the Admin Control Center depends on.
--
-- `User` carried only @@index([tenantId]) — every org-tree build, every
-- "who reports to X" lookup and every role filter was a scan over the whole
-- user table. Small today, but the admin pages hit these on every render.
--
-- `AuditLog` had no index on `action`, so the audit-log page's `admin.*` filter
-- could not use an index at all. The table receives a row on every write in the
-- app, so that read has to be indexed before the page ships.

CREATE INDEX IF NOT EXISTS "User_tenantId_managerId_idx"
  ON "User" ("tenantId", "managerId");

CREATE INDEX IF NOT EXISTS "User_tenantId_role_isActive_idx"
  ON "User" ("tenantId", "role", "isActive");

CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_action_createdAt_idx"
  ON "AuditLog" ("tenantId", "action", "createdAt");
