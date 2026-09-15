-- User.timezone: default "UTC" -> "Asia/Ho_Chi_Minh", and move every user still on the old
-- default.
--
-- Why the UPDATE is safe: on the live database every one of the 48 users is "UTC", and none of
-- them chose it — it was the schema default, the Settings picker offered three zones and
-- displayed Ho Chi Minh by default, and nobody saved. The company is in Vietnam.
--
-- What this changes, stated because it is a behaviour change at a moment in time: a lead with
-- no timezone of its own resolves to its assignee's for sequence send windows. With every
-- assignee on UTC, a 09:00-17:00 window was being computed in UTC, i.e. 16:00-00:00 for a
-- Singapore prospect. After this, the same window is 10:00-18:00 SGT. That is a fix to a live
-- defect, not a regression. nextActionAt values already stored are not recomputed here; each
-- enrollment picks up the new window at its next evaluation. Apply outside send hours.
ALTER TABLE "User" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Ho_Chi_Minh';

UPDATE "User" SET "timezone" = 'Asia/Ho_Chi_Minh' WHERE "timezone" = 'UTC';
