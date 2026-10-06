-- Own migration: a value added with ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction that adds it, and the next migration's code path writes it.
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'qualification_reviewed';
