-- Customer-facing display slides: allow each slide to be TEXT or an uploaded IMAGE.
ALTER TABLE "CustomerDisplaySlide" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'TEXT';
ALTER TABLE "CustomerDisplaySlide" ADD COLUMN "imageDataUrl" TEXT;
