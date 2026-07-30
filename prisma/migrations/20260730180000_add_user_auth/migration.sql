-- DropIndex
DROP INDEX "Role_name_key";

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "createdByUserId" INTEGER;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Role";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receiptNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "tenderType" TEXT NOT NULL DEFAULT 'CASH',
    "tenderedCents" INTEGER NOT NULL,
    "changeCents" INTEGER NOT NULL,
    "voidReason" TEXT,
    "customerId" INTEGER,
    "tabAmountCents" INTEGER DEFAULT 0,
    "surchargeCents" INTEGER DEFAULT 0,
    "email" TEXT,
    "userId" INTEGER,
    "cashierId" INTEGER,
    "voidedByUserId" INTEGER,
    "discountIssuedByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "category" TEXT,
    "saleType" TEXT NOT NULL DEFAULT 'NORMAL',
    "discountApplied" INTEGER,
    CONSTRAINT "Transaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" ("category", "changeCents", "createdAt", "customerId", "discountApplied", "email", "id", "receiptNumber", "saleType", "status", "subtotalCents", "surchargeCents", "tabAmountCents", "taxCents", "tenderType", "tenderedCents", "totalCents", "updatedAt", "userId", "voidReason") SELECT "category", "changeCents", "createdAt", "customerId", "discountApplied", "email", "id", "receiptNumber", "saleType", "status", "subtotalCents", "surchargeCents", "tabAmountCents", "taxCents", "tenderType", "tenderedCents", "totalCents", "updatedAt", "userId", "voidReason" FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE UNIQUE INDEX "Transaction_receiptNumber_key" ON "Transaction"("receiptNumber");
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");
CREATE INDEX "Transaction_customerId_idx" ON "Transaction"("customerId");
CREATE INDEX "Transaction_category_idx" ON "Transaction"("category");
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "lastLogin" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "id") SELECT "createdAt", "id" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_fullName_key" ON "User"("fullName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

