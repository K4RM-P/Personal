-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Product" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "barcode" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "fallbackPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "currentOnHand" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER NOT NULL DEFAULT 0,
    "categoryCode" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceItemNumber" TEXT,
    "lastCatalogSyncAt" DATETIME,
    "lastSeenBatchId" INTEGER,
    "discontinued" BOOLEAN NOT NULL DEFAULT false,
    "discontinuedAt" DATETIME,
    "nameOverridden" BOOLEAN NOT NULL DEFAULT false,
    "costOverridden" BOOLEAN NOT NULL DEFAULT false,
    "barcodeOverridden" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_Product" ("barcode", "barcodeOverridden", "categoryCode", "costCents", "costOverridden", "createdAt", "currentOnHand", "discontinued", "discontinuedAt", "id", "isPinned", "lastCatalogSyncAt", "lastSeenBatchId", "name", "nameOverridden", "origin", "priceCents", "reorderPoint", "sku", "sourceItemNumber", "updatedAt") SELECT "barcode", "barcodeOverridden", "categoryCode", "costCents", "costOverridden", "createdAt", "currentOnHand", "discontinued", "discontinuedAt", "id", "isPinned", "lastCatalogSyncAt", "lastSeenBatchId", "name", "nameOverridden", "origin", "priceCents", "reorderPoint", "sku", "sourceItemNumber", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_origin_idx" ON "Product"("origin");
CREATE INDEX "Product_sourceItemNumber_idx" ON "Product"("sourceItemNumber");
CREATE INDEX "Product_discontinued_idx" ON "Product"("discontinued");
CREATE INDEX "Product_categoryCode_idx" ON "Product"("categoryCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill: existing CATALOG-origin products that were auto-pinned to McKesson's
-- list price (not a genuine pharmacist override) are now distinguishable because
-- their priceCents still equals the catalogue item's listPriceCents.
UPDATE "Product"
SET "fallbackPinned" = true
WHERE "origin" = 'CATALOG'
  AND "isPinned" = true
  AND EXISTS (
    SELECT 1 FROM "CatalogProduct" cp
    WHERE cp."itemNumber" = "Product"."sourceItemNumber"
      AND cp."listPriceCents" = "Product"."priceCents"
  );
