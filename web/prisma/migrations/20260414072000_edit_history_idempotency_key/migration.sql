ALTER TABLE "EditHistory"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "EditHistory_shop_idempotencyKey_key"
ON "EditHistory"("shop", "idempotencyKey");
