-- Whether the open pixel went out with each message: the open rate's denominator.
-- Nullable and without a default: rows sent before this are unknown, not untracked.
ALTER TABLE "OutboundMessage" ADD COLUMN "openTracked" BOOLEAN;
