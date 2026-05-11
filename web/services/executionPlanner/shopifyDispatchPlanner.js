import { stableHash } from "../../utils/idempotencyKey.js";

export function buildShopifyDispatchPlan({
  shop,
  operationId,
  partitions = [],
  submissionType = "SHOPIFY_BULK_MUTATION",
}) {
  return partitions.map((partition, index) => ({
    shop,
    merchantOperationId: operationId,
    type: submissionType,
    status: "PLANNED",
    partitionOrdinal: Number(partition.partitionOrdinal || index + 1),
    payloadHash: stableHash({
      operationId,
      partitionOrdinal: Number(partition.partitionOrdinal || index + 1),
      mutationType: partition.mutationType,
      entityType: partition.entityType,
      ordinalStart: partition.ordinalStart,
      ordinalEnd: partition.ordinalEnd,
      targets: partition.targets,
    }),
    payloadBytes: BigInt(Number(partition.estimatedBytes || 0)),
    metadata: {
      mutationType: partition.mutationType,
      entityType: partition.entityType,
      ordinalStart: partition.ordinalStart,
      ordinalEnd: partition.ordinalEnd,
      targetCount: partition.targetCount,
    },
    targets: partition.targets,
  }));
}
