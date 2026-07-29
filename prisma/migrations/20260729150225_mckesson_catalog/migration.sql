-- CreateTable
CREATE TABLE "CatalogProduct" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "itemNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "effectiveDate" TEXT,
    "categoryCode" TEXT,
    "din" TEXT,
    "packSize" INTEGER,
    "province" TEXT NOT NULL,
    "strength" TEXT,
    "dosageForm" TEXT,
    "genericCode" TEXT,
    "genericName" TEXT,
    "mfrPartNumber" TEXT,
    "deptCode" TEXT,
    "vendorCode" TEXT,
    "listPriceCents" INTEGER NOT NULL DEFAULT 0,
    "costPriceCents" INTEGER NOT NULL DEFAULT 0,
    "uomGroup" TEXT,
    "uomType" TEXT,
    "gtinPrimary" TEXT,
    "gtinPrimaryNorm" TEXT,
    "gtinCase" TEXT,
    "gtinCaseNorm" TEXT,
    "importBatchId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogProduct_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "CatalogImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogDeal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "catalogProductId" INTEGER NOT NULL,
    "dealType" TEXT NOT NULL,
    "dealNumber" TEXT NOT NULL,
    "date1" TEXT,
    "date2" TEXT,
    "date3" TEXT,
    "date4" TEXT,
    "allowanceCents" INTEGER NOT NULL DEFAULT 0,
    "dealPriceCents" INTEGER NOT NULL DEFAULT 0,
    "tierFlag" TEXT,
    CONSTRAINT "CatalogDeal_catalogProductId_fkey" FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogImportBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "filename" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL,
    "totalLines" INTEGER NOT NULL DEFAULT 0,
    "productsNew" INTEGER NOT NULL DEFAULT 0,
    "productsUpdated" INTEGER NOT NULL DEFAULT 0,
    "productsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "dealsImported" INTEGER NOT NULL DEFAULT 0,
    "linesRejected" INTEGER NOT NULL DEFAULT 0,
    "errorReport" TEXT,
    "reconcileReport" TEXT,
    "repricedCount" INTEGER NOT NULL DEFAULT 0,
    "discontinuedCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "supersededAt" DATETIME
);

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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
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
INSERT INTO "new_Product" ("barcode", "costCents", "createdAt", "id", "isPinned", "name", "priceCents", "sku", "updatedAt") SELECT "barcode", "costCents", "createdAt", "id", "isPinned", "name", "priceCents", "sku", "updatedAt" FROM "Product";
DROP TABLE "Product";
ALTER TABLE "new_Product" RENAME TO "Product";
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
CREATE INDEX "Product_origin_idx" ON "Product"("origin");
CREATE INDEX "Product_sourceItemNumber_idx" ON "Product"("sourceItemNumber");
CREATE INDEX "Product_discontinued_idx" ON "Product"("discontinued");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "CatalogProduct_itemNumber_idx" ON "CatalogProduct"("itemNumber");

-- CreateIndex
CREATE INDEX "CatalogProduct_gtinPrimaryNorm_idx" ON "CatalogProduct"("gtinPrimaryNorm");

-- CreateIndex
CREATE INDEX "CatalogProduct_gtinCaseNorm_idx" ON "CatalogProduct"("gtinCaseNorm");

-- CreateIndex
CREATE INDEX "CatalogProduct_din_idx" ON "CatalogProduct"("din");

-- CreateIndex
CREATE INDEX "CatalogProduct_province_idx" ON "CatalogProduct"("province");

-- CreateIndex
CREATE INDEX "CatalogProduct_vendorCode_idx" ON "CatalogProduct"("vendorCode");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogProduct_importBatchId_itemNumber_key" ON "CatalogProduct"("importBatchId", "itemNumber");

-- CreateIndex
CREATE INDEX "CatalogDeal_catalogProductId_idx" ON "CatalogDeal"("catalogProductId");

-- CreateIndex
CREATE INDEX "CatalogImportBatch_isActive_idx" ON "CatalogImportBatch"("isActive");
