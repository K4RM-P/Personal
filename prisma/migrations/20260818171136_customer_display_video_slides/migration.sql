-- AlterTable: add video slide support and per-slide duration override
ALTER TABLE "CustomerDisplaySlide" ADD COLUMN "videoFilePath" TEXT;
ALTER TABLE "CustomerDisplaySlide" ADD COLUMN "durationSeconds" INTEGER;
