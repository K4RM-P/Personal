-- AlterTable
ALTER TABLE "CreditLedgerEntry" ADD COLUMN "refundId" INTEGER;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "billDiscountCents" INTEGER DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "cardLast4" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "processorTransactionId" TEXT;

-- AlterTable
ALTER TABLE "TransactionItem" ADD COLUMN "discountCents" INTEGER DEFAULT 0;

-- CreateTable
CREATE TABLE "Refund" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT,
    "customerEmail" TEXT,
    "providerRefundId" TEXT,
    "refundedByUserId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Refund_refundedByUserId_fkey" FOREIGN KEY ("refundedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Discount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "transactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "itemId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "originalCents" INTEGER NOT NULL,
    "finalCents" INTEGER NOT NULL,
    "reason" TEXT,
    "appliedByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Discount_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Refund_transactionId_idx" ON "Refund"("transactionId");

-- CreateIndex
CREATE INDEX "Refund_refundedByUserId_idx" ON "Refund"("refundedByUserId");

-- CreateIndex
CREATE INDEX "Discount_transactionId_idx" ON "Discount"("transactionId");

-- CreateIndex
CREATE INDEX "Discount_appliedByUserId_idx" ON "Discount"("appliedByUserId");
