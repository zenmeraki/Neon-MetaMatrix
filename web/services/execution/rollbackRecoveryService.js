import { prisma } from "../../config/database.js";
import { operationEventRepository } from "../../repositories/operationEventRepository.js";
import { loadRollbackArtifactFromPlan } from "./rollbackArtifactService.js";
import { addRollbackRecoveryJob } from "../../jobs/queues/rollbackRecoveryQueue.js";

export async function enqueueRollbackRecovery({
  shop,
  operationId,
  reason = "PARTIAL_FAILURE",
  requestedBy = "system",
}) {
  return addRollbackRecoveryJob({
    shop,
    operationId,
    reason,
    requestedBy,
  });
}

export async function replayRollbackArtifact({
  shop,
  operationId,
  reason = "PARTIAL_FAILURE",
  requestedBy = "system",
}) {
  const executionPlan = await prisma.executionPlan.findFirst({
    where: { shop, operationId },
    orderBy: { createdAt: "desc" },
    select: { id: true, planJson: true },
  });

  if (!executionPlan) {
    const error = new Error("EXECUTION_PLAN_NOT_FOUND");
    error.code = "EXECUTION_PLAN_NOT_FOUND";
    error.statusCode = 404;
    throw error;
  }

  const { artifact, rows } = await loadRollbackArtifactFromPlan({
    planJson: executionPlan.planJson,
  });

  const batchSize = Math.max(Number(process.env.ROLLBACK_RECOVERY_BATCH_SIZE || 200), 1);
  let replayedCount = 0;
  let batchCount = 0;

  for (let idx = 0; idx < rows.length; idx += batchSize) {
    const batch = rows.slice(idx, idx + batchSize);
    // Command replay hook: in this first pass, we replay by deterministic command emission.
    await operationEventRepository.emit({
      shop,
      operationId,
      type: "ROLLBACK_RECOVERY_REPLAYED",
      payload: {
        executionPlanId: executionPlan.id,
        artifactId: artifact.artifactId,
        requestedBy,
        reason,
        batchOrdinal: batchCount + 1,
        batchSize: batch.length,
        commandRows: batch,
      },
    });
    replayedCount += batch.length;
    batchCount += 1;
  }

  return {
    operationId,
    executionPlanId: executionPlan.id,
    artifactId: artifact.artifactId,
    replayedCount,
    batchCount,
    reason,
  };
}

