CREATE TABLE "BlisterPack" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL,
    "prepDate" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "pickupDate" DATETIME,
    "preparedBy" TEXT NOT NULL,
    "numPrescriptions" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BlisterPack_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "BlisterPack_customerId_idx" ON "BlisterPack"("customerId");
CREATE INDEX "BlisterPack_dueDate_idx" ON "BlisterPack"("dueDate");
CREATE INDEX "BlisterPack_pickupDate_idx" ON "BlisterPack"("pickupDate");
