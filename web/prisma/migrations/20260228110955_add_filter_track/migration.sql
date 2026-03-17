-- CreateEnum
CREATE TYPE "FilterTrackType" AS ENUM ('filter', 'preview');

-- CreateTable
CREATE TABLE "FilterTrack" (
    "id" TEXT NOT NULL,
    "shop" TEXT,
    "filterParams" JSONB,
    "previewFilterParams" JSONB,
    "respondProductCount" INTEGER,
    "previewResCount" INTEGER,
    "type" "FilterTrackType" NOT NULL DEFAULT 'filter',
    "field" TEXT,
    "editOption" TEXT,
    "searchKey" TEXT,
    "replaceText" TEXT,
    "supportValue" TEXT,
    "value" JSONB,
    "en" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FilterTrack_shop_idx" ON "FilterTrack"("shop");

-- CreateIndex
CREATE INDEX "FilterTrack_type_idx" ON "FilterTrack"("type");
