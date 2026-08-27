-- ============================================================================
-- TEL-P2-026: Application Role Least-Privilege Hardening
--
-- Revoke CREATEDB and CREATEROLE from the PostgreSQL application role `crm`.
-- Prisma migrations (`prisma migrate deploy`) do not require CREATEDB or CREATEROLE.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm') THEN
    ALTER ROLE crm NOCREATEDB NOCREATEROLE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_app') THEN
    ALTER ROLE crm_app NOCREATEDB NOCREATEROLE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_maintenance') THEN
    ALTER ROLE crm_maintenance NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
