-- Pre-onboarding health check (deploy/hostinger/preflight-health.sql). READ ONLY: a read-only transaction, rolled back.
-- Run on the VPS: $DC exec -T crm-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < deploy/hostinger/preflight-health.sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL app.bypass_rls = 'true';
\pset pager off
\echo '== 1. Active users by role'
SELECT role, count(*) FILTER (WHERE "isActive") AS active, count(*) FILTER (WHERE NOT "isActive") AS inactive FROM "User" GROUP BY role ORDER BY role;

\echo '== 2. Active SDRs/team leads and their open leads (lowest first)'
SELECT u.email, u.role, count(l.id) AS open_leads
FROM "User" u LEFT JOIN "Lead" l ON l."assignedToId" = u.id AND l."archivedAt" IS NULL
WHERE u."isActive" AND u.role IN ('sdr','team_lead')
GROUP BY u.email, u.role ORDER BY open_leads ASC, u.email LIMIT 60;

\echo '== 3. Active SDRs/team leads with NO active mailbox'
SELECT u.email, u.role FROM "User" u
WHERE u."isActive" AND u.role IN ('sdr','team_lead')
  AND NOT EXISTS (SELECT 1 FROM "EmailAccount" e WHERE e."userId" = u.id AND e."isActive")
ORDER BY u.email;

\echo '== 4. Active mailboxes with no usable credential / with a plaintext refresh token'
SELECT count(*) FILTER (WHERE "encRefreshToken" IS NULL AND "encPassword" IS NULL) AS no_credential,
       count(*) FILTER (WHERE "refreshToken" IS NOT NULL) AS plaintext_refresh_token,
       count(*) FILTER (WHERE "lastSyncAt" < now() - interval '1 day' OR "lastSyncAt" IS NULL) AS not_synced_24h,
       count(*) AS active_total
FROM "EmailAccount" WHERE "isActive";

\echo '== 5. Outbound email, last 7 days, by status'
SELECT status, count(*) FROM "OutboundMessage" WHERE "createdAt" > now() - interval '7 days' GROUP BY status ORDER BY 2 DESC;

\echo '== 6. Top send errors, last 7 days'
SELECT left("errorMessage", 90) AS error, count(*) FROM "OutboundMessage"
WHERE "createdAt" > now() - interval '7 days' AND "errorMessage" IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10;

\echo '== 7. Sequence enrollments by status; active ones on archived leads'
SELECT status, count(*) FROM "SequenceEnrollment" GROUP BY status ORDER BY 2 DESC;
SELECT count(*) AS active_on_archived_leads FROM "SequenceEnrollment" se JOIN "Lead" l ON l.id = se."leadId"
WHERE se.status = 'active' AND l."archivedAt" IS NOT NULL;

\echo '== 8. Suppression list size, ICP profiles'
SELECT (SELECT count(*) FROM "SuppressionEntry") AS email_suppressions,
       (SELECT count(*) FROM "IcpProfile") AS icp_profiles,
       (SELECT count(*) FROM "IcpProfile" WHERE "isDefault") AS default_icp_profiles;

\echo '== 8b. Unsubscribes that block a whole domain (should be 0; see the cleanup in the audit notes)'
SELECT domain, count(*) FROM "SuppressionEntry" WHERE reason = 'unsubscribed' AND email IS NOT NULL AND domain IS NOT NULL GROUP BY domain ORDER BY 2 DESC LIMIT 20;

\echo '== 9. Background jobs, last 24 hours'
SELECT "queueName", status, count(*) FROM "JobRun" WHERE "enqueuedAt" > now() - interval '24 hours' GROUP BY 1, 2 ORDER BY 1, 2;
SELECT "queueName", left("failedReason", 80) AS reason, count(*) FROM "JobRun"
WHERE status = 'failed' AND "enqueuedAt" > now() - interval '24 hours' GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8;
SELECT "queueName", count(*) AS stuck_over_1h FROM "JobRun" WHERE status IN ('queued','active') AND "enqueuedAt" < now() - interval '1 hour' GROUP BY 1;

\echo '== 10. Overdue open tasks per person (top 15)'
SELECT u.email, count(*) AS overdue FROM "Task" t JOIN "User" u ON u.id = t."userId"
WHERE t.status = 'pending' AND t."dueDate" < now() GROUP BY u.email ORDER BY 2 DESC LIMIT 15;

\echo '== 11. Database: size, connections, WAL'
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size,
       (SELECT count(*) FROM pg_stat_activity) AS connections_now,
       current_setting('max_connections') AS max_connections,
       current_setting('archive_mode') AS archive_mode;
SELECT count(*) AS wal_files, pg_size_pretty(sum(size)) AS wal_size FROM pg_ls_waldir();
SELECT relname AS table, pg_size_pretty(pg_total_relation_size(relid)) AS size FROM pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 8;
ROLLBACK;
