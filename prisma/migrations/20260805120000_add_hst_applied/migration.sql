-- Add per-line HST toggle to transaction items, defaulting to charged (true) for existing rows.
ALTER TABLE "TransactionItem" ADD COLUMN "hstApplied" BOOLEAN NOT NULL DEFAULT true;
