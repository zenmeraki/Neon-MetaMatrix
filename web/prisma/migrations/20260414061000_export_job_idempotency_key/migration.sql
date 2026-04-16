ALTER TABLE "ExportJob" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "ExportJob_shop_idempotencyKey_key" ON "ExportJob"("shop", "idempotencyKey");
