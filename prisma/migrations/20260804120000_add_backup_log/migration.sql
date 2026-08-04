-- CreateTable
CREATE TABLE "BackupLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "backupPath" TEXT NOT NULL,
    "driveName" TEXT NOT NULL,
    "drivePath" TEXT NOT NULL,
    "backupSizeBytes" INTEGER NOT NULL,
    "dataSnapshot" TEXT NOT NULL,
    "initiatedByUserId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    CONSTRAINT "BackupLog_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BackupLog_initiatedByUserId_idx" ON "BackupLog"("initiatedByUserId");

-- CreateIndex
CREATE INDEX "BackupLog_timestamp_idx" ON "BackupLog"("timestamp");
