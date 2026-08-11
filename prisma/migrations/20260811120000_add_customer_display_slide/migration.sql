-- Customer-facing display (second screen): idle slideshow slides.
CREATE TABLE "CustomerDisplaySlide" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "text" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "CustomerDisplaySlide_sortOrder_idx" ON "CustomerDisplaySlide"("sortOrder");
