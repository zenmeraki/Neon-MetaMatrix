import { prisma } from "../../config/database.js";

export async function createExecutionPlanRecord({
  shop,
  intentHash,
  snapshotSetId,
  mirrorBatchId,
  mutationCount,
  planHash,
  planJson,
}) {
  return prisma.executionPlan.upsert({
    where: {
      shop_intentHash_snapshotSetId: {
        shop,
        intentHash,
        snapshotSetId,
      },
    },
    update: {},
    create: {
      shop,
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
