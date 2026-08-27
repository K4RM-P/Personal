-- BlisterPack.frequency (WEEKLY/BIWEEKLY/MONTHLY) -> intervalDays (plain day count)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BlisterPack" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "prepDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "pickupDate" DATETIME,
    "preparedBy" TEXT NOT NULL,
    "numPrescriptions" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BlisterPack_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BlisterPack" ("id", "customerId", "intervalDays", "prepDate", "dueDate", "pickupDate", "preparedBy", "numPrescriptions", "createdAt", "updatedAt")
SELECT "id", "customerId",
  CASE "frequency" WHEN 'WEEKLY' THEN 7 WHEN 'BIWEEKLY' THEN 14 WHEN 'MONTHLY' THEN 28 ELSE 7 END,
  "prepDate", "dueDate", "pickupDate", "preparedBy", "numPrescriptions", "createdAt", "updatedAt"
FROM "BlisterPack";
DROP TABLE "BlisterPack";
ALTER TABLE "new_BlisterPack" RENAME TO "BlisterPack";
CREATE INDEX "BlisterPack_customerId_idx" ON "BlisterPack"("customerId");
CREATE INDEX "BlisterPack_dueDate_idx" ON "BlisterPack"("dueDate");
CREATE INDEX "BlisterPack_pickupDate_idx" ON "BlisterPack"("pickupDate");

-- Customer.phone / phoneNormalized -> optional
CREATE TABLE "new_Customer" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT,
  "phoneNormalized" TEXT,
  "address" TEXT NOT NULL,
  "email" TEXT,
  "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "createdByUserId" INTEGER,
  "deletedAt" DATETIME
);
INSERT INTO "new_Customer" ("id", "firstName", "lastName", "phone", "phoneNormalized", "address", "email", "loyaltyEnabled", "notes", "createdAt", "updatedAt", "createdByUserId", "deletedAt")
SELECT "id", "firstName", "lastName", "phone", "phoneNormalized", "address", "email", "loyaltyEnabled", "notes", "createdAt", "updatedAt", "createdByUserId", "deletedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_phoneNormalized_idx" ON "Customer"("phoneNormalized");
CREATE INDEX "Customer_lastName_firstName_idx" ON "Customer"("lastName", "firstName");
PRAGMA foreign_keys=ON;
