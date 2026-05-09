import { stableHash } from "../../utils/idempotencyKey.js";

export function buildTargetHash(input = {}) {
  return stableHash({
    shop: input.shop || null,
    operationId: input.operationId || null,
    intentId: input.intentId || null,
    mirrorBatchId: input.mirrorBatchId || null,
    filterHash: input.filterHash || null,
    canonicalOrderBy: input.canonicalOrderBy || null,
    targetCount: Number(input.targetCount || 0),
  });
}

