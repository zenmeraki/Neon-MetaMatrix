-- AlterTable
ALTER TABLE "Variant" ADD COLUMN     "cost" DOUBLE PRECISION,
ADD COLUMN     "countryOfOrigin" TEXT,
ADD COLUMN     "hsTariffCode" TEXT,
ADD COLUMN     "weight" DOUBLE PRECISION,
ADD COLUMN     "weightUnit" TEXT;

-- CreateIndex
CREATE INDEX "Variant_shop_barcode_idx" ON "Variant"("shop", "barcode");
