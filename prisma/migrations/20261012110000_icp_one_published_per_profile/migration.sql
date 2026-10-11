-- One published version per ICP profile, kept by the database as well as by publishIcpDraft and
-- approveIcpVersion (both archive the old published version in the same transaction as they publish
-- the new one). The resolver follows the profile's NEWEST published version, so an older one still
-- marked published would be dead weight that two concurrent publishes could resurrect.
--
-- Any profile that somehow holds more than one is reduced to its newest first; the older rows were
-- never scored against (the resolver picks the newest), so this only corrects their label. Prisma cannot
-- express partial indexes; migrate diff ignores them (see tests/partial-unique-indexes.test.ts).
UPDATE "IcpVersion" SET "status" = 'archived'
WHERE "status" = 'published'
  AND "id" NOT IN (
    SELECT DISTINCT ON ("icpProfileId") "id" FROM "IcpVersion"
    WHERE "status" = 'published'
    ORDER BY "icpProfileId", "versionNumber" DESC
  );

CREATE UNIQUE INDEX "icp_version_one_published_per_profile" ON "IcpVersion"("icpProfileId") WHERE "status" = 'published';
