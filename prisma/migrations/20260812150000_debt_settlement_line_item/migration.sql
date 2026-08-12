-- Support a non-product "debt settlement" line on a Transaction: productId becomes
-- optional and a lineType discriminator distinguishes it from normal PRODUCT lines.
-- CreditEntryType.DEBT_SETTLED needs no table change — CreditLedgerEntry.type is
-- stored as plain TEXT with no CHECK constraint.

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
    CONSTRAINT "TransactionItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TransactionItem" ("id", "transactionId", "productId", "quantity", "costCents", "unitPriceCents", "discountCents", "totalCents", "isVoided", "hstApplied")
SELECT "id", "transactionId", "productId", "quantity", "costCents", "unitPriceCents", "discountCents", "totalCents", "isVoided", "hstApplied" FROM "TransactionItem";
DROP TABLE "TransactionItem";
ALTER TABLE "new_TransactionItem" RENAME TO "TransactionItem";
CREATE INDEX "TransactionItem_transactionId_idx" ON "TransactionItem"("transactionId");
CREATE INDEX "TransactionItem_productId_idx" ON "TransactionItem"("productId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
