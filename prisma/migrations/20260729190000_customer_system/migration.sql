-- Customer profiles replace the legacy name-only record. Existing names are split conservatively.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "phoneNormalized" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "email" TEXT,
  "creditLimitCents" INTEGER,
  "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("id", "firstName", "lastName", "phone", "phoneNormalized", "address", "email", "createdAt", "updatedAt")
SELECT "id", substr("name", 1, instr("name" || ' ', ' ') - 1), trim(substr("name", instr("name" || ' ', ' ') + 1)), COALESCE("phone", ''), replace(replace(replace(replace(replace(COALESCE("phone", ''), '-', ''), ' ', ''), '(', ''), ')', ''), '+', ''), '', "email", "createdAt", "createdAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_phoneNormalized_idx" ON "Customer"("phoneNormalized");
CREATE INDEX "Customer_lastName_firstName_idx" ON "Customer"("lastName", "firstName");
CREATE TABLE "CreditLedgerEntry" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "customerId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "balanceAfterCents" INTEGER NOT NULL,
  "transactionId" TEXT,
  "note" TEXT,
  "createdByUserId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditLedgerEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CreditLedgerEntry_customerId_createdAt_idx" ON "CreditLedgerEntry"("customerId", "createdAt");
CREATE INDEX "CreditLedgerEntry_transactionId_idx" ON "CreditLedgerEntry"("transactionId");
CREATE TABLE "LoyaltyPointEvent" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "customerId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "pointsAfter" INTEGER NOT NULL,
  "transactionId" TEXT,
  "note" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoyaltyPointEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LoyaltyPointEvent_customerId_createdAt_idx" ON "LoyaltyPointEvent"("customerId", "createdAt");
CREATE INDEX "LoyaltyPointEvent_transactionId_idx" ON "LoyaltyPointEvent"("transactionId");
ALTER TABLE "Transaction" ADD COLUMN "tabAmountCents" INTEGER DEFAULT 0;
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
