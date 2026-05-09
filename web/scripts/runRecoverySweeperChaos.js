import crypto from "crypto";
import { prisma } from "../config/database.js";

function ago(ms) {
  return new Date(Date.now() - ms);
}

async function resolveChaosShop() {
  if (process.env.CHAOS_SHOP) {
    return process.env.CHAOS_SHOP;
  }

  const existing = await prisma.storeOperation.findFirst({
    select: { shop: true },
    where: { shop: { not: "" } },
    orderBy: { createdAt: "desc" },
  });

  if (existing?.shop) {
    return existing.shop;
  }

  throw new Error("NO_EXISTING_SHOP_FOR_CHAOS_TEST");
}

async function seedScenario(shop) {
  const ids = {
    op: `op_${crypto.randomUUID()}`,
    scheduledExport: `se_${crypto.randomUUID()}`,
    run: `run_${crypto.randomUUID()}`,
    exportJob: `exp_${crypto.randomUUID()}`,
    submission: crypto.randomUUID(),
    history: `hist_${crypto.randomUUID()}`,
  };

  await prisma.storeOperationalState.upsert({
    where: { shop },
    update: { activeWriteOperationId: ids.op },
    create: { shop, activeWriteOperationId: ids.op },
  });

  await prisma.storeOperation.create({
    data: {
      id: ids.op,
      shop,
      type: "BULK_EDIT",
      status: "RUNNING",
      source: "chaos_test",
      idempotencyKey: `chaos:${ids.op}`,
      heartbeatAt: ago(10 * 60 * 1000),
      startedAt: ago(10 * 60 * 1000),
    },
  });

  await prisma.scheduledExport.create({
    data: {
      id: ids.scheduledExport,
      shop,
      title: "chaos scheduled export",
      scheduleType: "ONE_TIME",
      timezone: "UTC",
      scheduleConfig: {},
      filterParams: [],
      fields: [],
      filename: "chaos.csv",
      status: "ACTIVE",
      nextRunAt: ago(2 * 60 * 60 * 1000),
    },
  }).catch(() => {});

  await prisma.scheduledExportRun.create({
    data: {
      id: ids.run,
      scheduledExportId: ids.scheduledExport,
      shop,
      scheduledFor: ago(60 * 60 * 1000),
      status: "PROCESSING",
      startedAt: ago(60 * 60 * 1000),
      executionKey: `chaos:${ids.run}`,
    },
  }).catch(() => {});

  await prisma.exportJob.create({
    data: {
      id: ids.exportJob,
      shop,
      filename: "chaos.csv",
      fields: [],
      status: "PENDING",
      executionState: "queued",
      createdAt: ago(20 * 60 * 1000),
    },
  });

  await prisma.bulkMutationSubmission.create({
    data: {
      id: ids.submission,
      shop,
      operationId: ids.op,
      editHistoryId: ids.history,
      batchId: "chaos-batch",
      status: "SHOPIFY_DISPATCHED",
      shopifyBulkOperationId: "gid://shopify/BulkOperation/chaos",
      dispatchJobId: "chaos-job",
      dispatchAttempt: 1,
      createdAt: ago(60 * 60 * 1000),
      updatedAt: ago(60 * 60 * 1000),
    },
  });

  return ids;
}

async function repairStaleStoreOperations() {
  const expired = await prisma.storeOperation.findMany({
    where: {
      status: "RUNNING",
      heartbeatAt: { lt: ago(2 * 60 * 1000) },
    },
    select: { id: true, shop: true },
  });
  if (!expired.length) return { expiredCount: 0 };

  const ids = expired.map((row) => row.id);
  await prisma.storeOperation.updateMany({
    where: { id: { in: ids }, status: "RUNNING" },
    data: {
      status: "EXPIRED",
      failedAt: new Date(),
      errorCode: "OPERATION_HEARTBEAT_EXPIRED",
      errorMessage: "Operation heartbeat expired.",
    },
  });
  await Promise.all(
    expired.map((row) =>
      prisma.storeOperationalState.updateMany({
        where: { shop: row.shop, activeWriteOperationId: row.id },
        data: { activeWriteOperationId: null },
      }),
    ),
  );
  return { expiredCount: ids.length };
}

async function repairStuckScheduledRuns() {
  const staleCutoff = ago(30 * 60 * 1000);
  const stuck = await prisma.scheduledExportRun.findMany({
    where: {
      status: "PROCESSING",
      exportJobId: null,
      startedAt: { lt: staleCutoff },
    },
    select: { id: true },
  });
  if (!stuck.length) return { repairedCount: 0 };

  const ids = stuck.map((row) => row.id);
  await prisma.scheduledExportRun.updateMany({
    where: { id: { in: ids }, status: "PROCESSING", exportJobId: null },
    data: {
      status: "FAILED",
      errorMessage: "RUN_STUCK_WITHOUT_EXPORT_JOB",
      completedAt: new Date(),
    },
  });
  return { repairedCount: ids.length };
}

async function repairStaleSubmittedWithoutFinalization() {
  const staleCutoff = ago(30 * 60 * 1000);
  const stale = await prisma.bulkMutationSubmission.findMany({
    where: {
      status: "SHOPIFY_DISPATCHED",
      updatedAt: { lt: staleCutoff },
    },
    select: { id: true, shop: true, operationId: true, editHistoryId: true },
    take: 100,
  });
  if (!stale.length) return { flaggedCount: 0 };

  for (const row of stale) {
    await prisma.operationFailure.create({
      data: {
        shop: row.shop,
        operationId: row.operationId,
        entityId: row.editHistoryId,
        errorCode: "SUBMISSION_FINALIZATION_STALLED",
        errorMessage: `Submission ${row.id} stalled in SHOPIFY_DISPATCHED`,
      },
    });
  }
  return { flaggedCount: stale.length };
}

async function runRecoverySweeperPassLite() {
  const [ops, runs, submissions] = await Promise.all([
    repairStaleStoreOperations().catch((error) => ({ error: error.message })),
    repairStuckScheduledRuns().catch((error) => ({ error: error.message })),
    repairStaleSubmittedWithoutFinalization().catch((error) => ({ error: error.message })),
  ]);
  return { ops, runs, submissions, exports: { skipped: true, reason: "redis_required" } };
}

async function cleanup(shop, ids) {
  await prisma.operationFailure.deleteMany({
    where: { shop, operationId: ids.op },
  }).catch(() => {});
  await prisma.bulkMutationSubmission.deleteMany({
    where: { id: ids.submission },
  }).catch(() => {});
  await prisma.exportJob.deleteMany({
    where: { id: ids.exportJob },
  }).catch(() => {});
  await prisma.scheduledExportRun.deleteMany({
    where: { id: ids.run },
  }).catch(() => {});
  await prisma.scheduledExport.deleteMany({
    where: { id: ids.scheduledExport },
  }).catch(() => {});
  await prisma.storeOperation.deleteMany({
    where: { id: ids.op },
  }).catch(() => {});
  await prisma.storeOperationalState.updateMany({
    where: { shop, activeWriteOperationId: ids.op },
    data: { activeWriteOperationId: null },
  }).catch(() => {});
}

async function verify(shop, ids) {
  const [op, run, failures] = await Promise.all([
    prisma.storeOperation.findUnique({ where: { id: ids.op } }),
    prisma.scheduledExportRun.findUnique({ where: { id: ids.run } }),
    prisma.operationFailure.findMany({
      where: { shop, operationId: ids.op, errorCode: "SUBMISSION_FINALIZATION_STALLED" },
      take: 5,
    }),
  ]);

  return {
    expiredLeaseRecovered: op?.status === "EXPIRED",
    processingWithoutJobRecovered: run?.status === "FAILED",
    submittedWithoutFinalizationFlagged: failures.length > 0,
  };
}

async function main() {
  const shop = await resolveChaosShop();
  const ids = await seedScenario(shop);
  const sweep = await runRecoverySweeperPassLite();
  const checks = await verify(shop, ids);
  console.log(JSON.stringify({ shop, ids, sweep, checks }, null, 2));
  await cleanup(shop, ids);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
