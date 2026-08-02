-- Promote legacy leadgen managers to the explicit leadgen_manager role.
-- A leadgen user is a MEMBER iff their manager is also leadgen. Everyone else
-- with role 'leadgen' was treated as a manager by the old getLeadgenScope
-- heuristic, so they become leadgen_manager to preserve current behavior.

UPDATE "User"
SET "role" = 'leadgen_manager'
WHERE "role" = 'leadgen'
  AND NOT EXISTS (
    SELECT 1 FROM "User" m WHERE m."id" = "User"."managerId" AND m."role" = 'leadgen'
  );
