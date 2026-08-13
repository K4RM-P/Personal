-- CreateTable
CREATE TABLE "TransactionTender" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transactionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "cashGivenCents" INTEGER,
    "changeCents" INTEGER,
    "depositedToTabCents" INTEGER,
    "cardType" TEXT,
    "surchargeCents" INTEGER,
    "processorTransactionId" TEXT,
    "cardLastFour" TEXT,
    "eTransferEmail" TEXT,
    "eTransferConfirmed" BOOLEAN,
    "customerId" INTEGER,
    "creditLedgerEntryId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "failureReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "TransactionTender_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TransactionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "productId" INTEGER,
    "quantity" INTEGER NOT NULL,
    "costCents" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "discountCents" INTEGER DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "isVoided" BOOLEAN NOT NULL DEFAULT false,
    "hstApplied" BOOLEAN NOT NULL DEFAULT true,
    "lineType" TEXT NOT NULL DEFAULT 'PRODUCT',
    CONSTRAINT "TransactionItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransactionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_TransactionItem" ("costCents", "discountCents", "hstApplied", "id", "isVoided", "lineType", "productId", "quantity", "totalCents", "transactionId", "unitPriceCents") SELECT "costCents", "discountCents", "hstApplied", "id", "isVoided", "lineType", "productId", "quantity", "totalCents", "transactionId", "unitPriceCents" FROM "TransactionItem";
DROP TABLE "TransactionItem";
ALTER TABLE "new_TransactionItem" RENAME TO "TransactionItem";
CREATE INDEX "TransactionItem_transactionId_idx" ON "TransactionItem"("transactionId");
CREATE INDEX "TransactionItem_productId_idx" ON "TransactionItem"("productId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "TransactionTender_transactionId_idx" ON "TransactionTender"("transactionId");
