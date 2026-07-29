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
  "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("id", "firstName", "lastName", "phone", "phoneNormalized", "address", "email", "loyaltyEnabled", "notes", "createdAt", "updatedAt")
SELECT "id", "firstName", "lastName", "phone", "phoneNormalized", "address", "email", "loyaltyEnabled", "notes", "createdAt", "updatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE INDEX "Customer_phoneNormalized_idx" ON "Customer"("phoneNormalized");
CREATE INDEX "Customer_lastName_firstName_idx" ON "Customer"("lastName", "firstName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
