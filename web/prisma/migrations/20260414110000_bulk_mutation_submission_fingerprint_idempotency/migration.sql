CREATE UNIQUE INDEX IF NOT EXISTS "BulkMutationSubmission_shop_mutationType_inputRowHash_key"
  ON "BulkMutationSubmission"("shop", "mutationType", "inputRowHash")
  WHERE "inputRowHash" IS NOT NULL;
