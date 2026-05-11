import { prisma } from "../../config/database.js";

export async function createExecutionPlanRecord({
  shop,
  operationId,
  intentHash,
  snapshotSetId,
  mirrorBatchId,
  mutationCount,
  planHash,
  planJson,
}) {
  return prisma.executionPlan.upsert({
    where: {
      shop_operationId_intentHash_snapshotSetId: {
        shop,
        operationId,
        intentHash,
        snapshotSetId,
      },
    },
    update: {
      mirrorBatchId,
      mutationCount,
      planHash,
      planJson,
      status: "CREATED",
    },
    create: {
      shop,
      operationId,
      intentHash,
      snapshotSetId,
      mirrorBatchId,
      mutationCount,
      planHash,
      planJson,
      status: "CREATED",
    },
  });
}
