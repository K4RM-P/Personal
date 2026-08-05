-- PIPEDA deletion-on-request (B7): marks a customer record as anonymized.
-- Financial ledger/transaction rows are never deleted for accounting integrity.
ALTER TABLE "Customer" ADD COLUMN "deletedAt" DATETIME;
