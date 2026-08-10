-- Fencing identity for work order execution leases.
--
-- `workOrderId` alone cannot fence a stale holder. The case it misses is two *attempts at the
-- same order*: worker 1 claims for order X and stalls, the lease expires, worker 2 retries
-- order X and reclaims, worker 1 wakes. Its `workOrderId` still matches, so a
-- `workOrderId`-only predicate would let it renew or release a lease it no longer holds.
-- `claimToken` is minted fresh on every claim and reclaim and preserved across renewals, so a
-- superseded holder is fenced out from the moment it is superseded.
--
-- Added nullable, backfilled, then made NOT NULL rather than `ADD COLUMN ... NOT NULL` in one
-- step, which fails on any non-empty table. `WorkOrderLease` is empty in every deployed
-- environment — it was created one migration ago and has no producer outside this branch — but
-- a migration that only replays against an empty table is a migration that fails the first time
-- it meets a developer's database. `gen_random_uuid()` is built in from PostgreSQL 13; the
-- target is 16.
ALTER TABLE "WorkOrderLease" ADD COLUMN "claimToken" TEXT;

UPDATE "WorkOrderLease" SET "claimToken" = gen_random_uuid()::text WHERE "claimToken" IS NULL;

ALTER TABLE "WorkOrderLease" ALTER COLUMN "claimToken" SET NOT NULL;
