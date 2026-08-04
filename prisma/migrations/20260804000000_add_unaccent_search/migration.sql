-- Accent-insensitive search for Vietnamese (and any other accented) data.
--
-- Folding only the query was not enough: it let "Nguyễn" find a record stored as
-- "Nguyen", but "Giam" could never find "Giám đốc" and "Nguyen Hai" could never find
-- "Nguyễn Hải" — the exact way a Vietnam-based team types. The stored side has to be
-- folded too, which needs the extension.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() is STABLE, not IMMUTABLE, because it depends on a dictionary that could
-- in principle be redefined. Postgres therefore refuses it in an expression index.
-- Pinning the dictionary explicitly makes the call deterministic, which is what lets
-- this wrapper be marked IMMUTABLE and indexed.
CREATE OR REPLACE FUNCTION immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  PARALLEL SAFE
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- Trigram indexes over the folded, lowercased columns. Without these every accent-
-- insensitive search is a sequential scan, which is fine at seed size and not at
-- vendor-list size.
CREATE INDEX IF NOT EXISTS "LeadPoolItem_search_fullname_trgm"
  ON "LeadPoolItem" USING gin (immutable_unaccent(lower(coalesce("fullName", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "LeadPoolItem_search_firstname_trgm"
  ON "LeadPoolItem" USING gin (immutable_unaccent(lower(coalesce("firstName", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "LeadPoolItem_search_lastname_trgm"
  ON "LeadPoolItem" USING gin (immutable_unaccent(lower(coalesce("lastName", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "LeadPoolItem_search_company_trgm"
  ON "LeadPoolItem" USING gin (immutable_unaccent(lower(coalesce("company", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "LeadPoolItem_search_title_trgm"
  ON "LeadPoolItem" USING gin (immutable_unaccent(lower(coalesce("title", ''))) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Lead_search_firstname_trgm"
  ON "Lead" USING gin (immutable_unaccent(lower(coalesce("firstName", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_search_lastname_trgm"
  ON "Lead" USING gin (immutable_unaccent(lower(coalesce("lastName", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_search_company_trgm"
  ON "Lead" USING gin (immutable_unaccent(lower(coalesce("company", ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Lead_search_title_trgm"
  ON "Lead" USING gin (immutable_unaccent(lower(coalesce("title", ''))) gin_trgm_ops);
