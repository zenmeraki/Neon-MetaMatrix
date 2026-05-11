import { prisma } from "../../config/database.js";
import { buildTargetHash } from "./targetHashService.js";
import { partitionMutationWork } from "./mutationPartitioner.js";

function getClient(db) {
  return db || prisma;
}

export async function buildExecutionPlan(input, db = prisma) {
  const client = getClient(db);
  if (!input?.operationId) {
    const error = new Error("EXECUTION_PLAN_OPERATION_REQUIRED");
    error.code = "EXECUTION_PLAN_OPERATION_REQUIRED";
    throw error;
  }

  const targetHash = buildTargetHash(input);
  const snapshotSet = await client.immutableTargetSnapshotSet.findFirst({
    where: {
      id: input.snapshotSetId,
      shop: input.shop,
    },
    select: {
      id: true,
      mirrorBatchId: true,
      plannerVersion: true,
      compilerVersion: true,
    },
  });
  if (!snapshotSet) {
    const error = new Error("IMMUTABLE_SNAPSHOT_SET_NOT_FOUND");
    error.code = "IMMUTABLE_SNAPSHOT_SET_NOT_FOUND";
    throw error;
  }

  const items = await client.immutableTargetSnapshotItem.findMany({
    where: {
      shop: input.shop,
      snapshotSetId: snapshotSet.id,
    },
    orderBy: { ordinal: "asc" },
    select: {
      productId: true,
      variantId: true,
      ordinal: true,
      targetHash: true,
      plannedChanges: true,
      plannedFieldMutations: true,
      mutationFingerprint: true,
    },
  });

  const partitions = partitionMutationWork(items, input);
  const estimatedMutationBytes = partitions.reduce(
    (acc, partition) => acc + BigInt(Number(partition.estimatedBytes || 0)),
    0n,
  );
  const planJson = {
    operationId: input.operationId,
    intentHash: input.intentHash,
    snapshotSetId: snapshotSet.id,
    partitions,
    partitionCount: partitions.length,
  };
  const planHash = buildTargetHash({
    ...input,
    targetHash,
    partitionCount: partitions.length,
    planJson,
  });

  const record = await client.executionPlan.upsert({
    where: {
      shop_operationId_intentHash_snapshotSetId: {
        shop: input.shop,
        operationId: input.operationId,
        intentHash: input.intentHash,
        snapshotSetId: snapshotSet.id,
      },
    },
    update: {
      mirrorBatchId: snapshotSet.mirrorBatchId,
      status: "CREATED",
      mutationCount: items.length,
      partitionCount: partitions.length,
      estimatedMutationBytes,
      plannerVersion: Number(input.plannerVersion || snapshotSet.plannerVersion || 1),
      planHash,
      planJson,
    },
    create: {
      shop: input.shop,
      operationId: input.operationId,
      intentHash: input.intentHash,
      snapshotSetId: snapshotSet.id,
      mirrorBatchId: snapshotSet.mirrorBatchId,
      status: "CREATED",
      mutationCount: items.length,
      partitionCount: partitions.length,
      estimatedMutationBytes,
      plannerVersion: Number(input.plannerVersion || snapshotSet.plannerVersion || 1),
      planHash,
      planJson,
    },
  });

  const partitionWrites = [
    client.executionPartition.deleteMany({
      where: {
        shop: input.shop,
        executionPlanId: record.id,
        status: "CREATED",
      },
    }),
  ];

  if (partitions.length) {
    partitionWrites.push(client.executionPartition.createMany({
      data: partitions.map((partition) => ({
        shop: input.shop,
        operationId: input.operationId,
        executionPlanId: record.id,
        ordinal: Number(partition.partitionOrdinal || 0),
        status: "CREATED",
        targetStartOrdinal: Number(partition.ordinalStart || 0),
        targetEndOrdinal: Number(partition.ordinalEnd || 0),
        estimatedBytes: BigInt(Number(partition.estimatedBytes || 0)),
        payloadHash: buildTargetHash({
          operationId: input.operationId,
          executionPlanId: record.id,
          ordinal: partition.partitionOrdinal,
          partition,
        }),
      })),
      skipDuplicates: true,
    }));
  }

  await client.$transaction(partitionWrites);

  return {
    targetHash,
    executionPlan: record,
    partitions,
  };
}
