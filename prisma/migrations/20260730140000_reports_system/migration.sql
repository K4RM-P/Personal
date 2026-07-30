-- Reports System (spec §4): reporting-focused helper columns, indices, and the
-- InventoryAdjustment model. SQLite stores enums as TEXT; SaleType defaults to NORMAL.
-- The catalog_fts* tables are managed outside Prisma and are intentionally untouched.

-- Product: inventory + category columns for valuation & low-stock alerts
ALTER TABLE "Product" ADD COLUMN "currentOnHand" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "reorderPoint" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "categoryCode" TEXT;

-- Transaction: reporting helper columns
ALTER TABLE "Transaction" ADD COLUMN "category" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "saleType" TEXT NOT NULL DEFAULT 'NORMAL';
ALTER TABLE "Transaction" ADD COLUMN "discountApplied" INTEGER;

-- New indices for reporting queries
CREATE INDEX "Product_categoryCode_idx" ON "Product"("categoryCode");
CREATE INDEX "Transaction_category_idx" ON "Transaction"("category");

-- InventoryAdjustment: manual stock corrections audit trail
CREATE TABLE "InventoryAdjustment" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "productId" INTEGER NOT NULL,
  "quantityDelta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "adjustedByUserId" INTEGER,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "InventoryAdjustment_productId_createdAt_idx" ON "InventoryAdjustment"("productId", "createdAt");