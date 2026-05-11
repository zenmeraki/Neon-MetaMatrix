import crypto from "crypto";
import { prisma } from "../config/database.js";
import { waitForRedisReady } from "../config/redis.js";
import { addbulkExportJob, getBulkExportQueue } from "../jobs/queues/bulkExportJob.js";
import { addbulkEditJob, getBulkEditQueue } from "../jobs/queues/bulkEditJob.js";
import { freezeTargetSnapshot } from "../services/productService/productTargetingService.js";

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

async function seedStore(shop, mirrorBatchId) {
  await prisma.store.upsert({
    where: { shopUrl: shop },
    update: {
      activeMirrorBatchId: mirrorBatchId,
      isProductSyncing: true,
      isProductInitialySyning: false,
      syncProgressStage: "SHOPIFY_BULK_RUNNING",
      mirrorHealthState: "HEALTHY",
      shopifyBulkJobCompleted: true,
    },
    create: {
      shopUrl: shop,
      shopEmail: `${shop}.ops@example.com`,
      activeMirrorBatchId: mirrorBatchId,
      isProductSyncing: true,
      isProductInitialySyning: false,
      syncProgressStage: "SHOPIFY_BULK_RUNNING",
      mirrorHealthState: "HEALTHY",
      shopifyBulkJobCompleted: true,
      storeTotalProducts: 1,
    },
  });

  await prisma.storeOperationalState.upsert({
    where: { shop },
    update: {
      activeCatalogBatchId: mirrorBatchId,
      catalogConsistencyStatus: "READY",
      activeWriteOperationId: null,
      writeBlockedReason: null,
    },
    create: {
      shop,
      activeCatalogBatchId: mirrorBatchId,
      catalogConsistencyStatus: "READY",
    },
  });
}

async function runEExportDuringSync(shop) {
  const mirrorBatchId = randomId("mb");
  const productId = `gid://shopify/Product/${Date.now()}`;
  const exportJobId = randomId("exp");
  const fields = ["ProductTitle", "Vendor"];
  const queue = getBulkExportQueue();
  const jobId = `export:${shop}:${exportJobId}`;

  await seedStore(shop, mirrorBatchId);
  await prisma.product.upsert({
    where: {
      shop_id_mirrorBatchId: {
        shop,
        id: productId,
        mirrorBatchId,
      },
    },
    update: {
      title: "Harness Product",
      status: "ACTIVE",
      tags: [],
    },
    create: {
      shop,
      id: productId,
      mirrorBatchId,
      title: "Harness Product",
      status: "ACTIVE",
      tags: [],
    },
  });

  await prisma.exportJob.create({
    data: {
      id: exportJobId,
      shop,
      filename: `harness-${Date.now()}.csv`,
      fields,
      status: "PENDING",
      executionState: "planned",
      targetMirrorBatchId: mirrorBatchId,
    },
  });

  const frozenCount = await freezeTargetSnapshot({
    ownerType: "EXPORT_JOB",
    ownerId: exportJobId,
    shop,
    where: { id: productId },
    mirrorBatchId,
  });

  await prisma.exportJob.updateMany({
    where: { id: exportJobId, shop },
    data: {
      targetSnapshotCount: frozenCount,
      executionState: "queued",
    },
  });

  await addbulkExportJob(
    {
      exportJobId,
      shop,
      fields,
      source: "harness_export_during_sync",
      executionId: exportJobId,
    },
    { jobId },
  );

  const job = await queue.getJob(jobId);
  const snapshotRows = await prisma.targetSnapshot.count({
    where: {
      ownerType: "EXPORT_JOB",
      ownerId: exportJobId,
      shop,
    },
  });

  await queue.remove(jobId).catch(() => {});
  await prisma.targetSnapshot.deleteMany({
    where: { ownerType: "EXPORT_JOB", ownerId: exportJobId, shop },
  });
  await prisma.exportJob.deleteMany({ where: { id: exportJobId, shop } });
  await prisma.product.deleteMany({
    where: { shop, id: productId, mirrorBatchId },
  });

  return {
    scenario: "E_export_during_sync",
    passed: Boolean(job?.id) && snapshotRows > 0 && frozenCount > 0,
    evidence: {
      shop,
      exportJobId,
      jobId,
      queueJobExists: Boolean(job?.id),
      frozenCount,
      snapshotRows,
      mirrorBatchId,
      validatedAt: nowIso(),
      mode: "SNAPSHOT_USED_DURING_SYNC",
    },
  };
}

async function runFScheduledOverlap(shop) {
  const queue = getBulkEditQueue();
  const opPrimary = randomId("op_primary");
  const opSecondary = randomId("op_secondary");
  const historyPrimary = randomId("hist_primary");
  const historySecondary = randomId("hist_secondary");
  const jobPrimary = `bulk:execute:${shop}:${opPrimary}`;
  const jobSecondary = `bulk:execute:${shop}:${opSecondary}`;

  await prisma.storeOperationalState.updateMany({
    where: { shop },
    data: { activeWriteOperationId: opPrimary },
  });

  await addbulkEditJob(
    {
      historyId: historyPrimary,
      shop,
      source: "harness_scheduled_primary",
      executionId: historyPrimary,
      operationId: opPrimary,
    },
    { jobId: jobPrimary },
  );

  let secondaryError = null;
  try {
    await addbulkEditJob(
      {
        historyId: historySecondary,
        shop,
        source: "harness_manual_secondary",
        executionId: historySecondary,
        operationId: opSecondary,
      },
      { jobId: jobSecondary },
    );
  } catch (error) {
    secondaryError = error;
  }

  const queuedPrimary = await queue.getJob(jobPrimary);
  const queuedSecondary = await queue.getJob(jobSecondary);

  await queue.remove(jobPrimary).catch(() => {});
  await queue.remove(jobSecondary).catch(() => {});
  await prisma.storeOperationalState.updateMany({
    where: { shop },
    data: { activeWriteOperationId: null, writeBlockedReason: null },
  });

  return {
    scenario: "F_scheduled_manual_overlap",
    passed:
      Boolean(queuedPrimary?.id) &&
      !queuedSecondary &&
      secondaryError?.code === "WRITE_PIPELINE_BUSY",
    evidence: {
      shop,
      primaryOperationId: opPrimary,
      secondaryOperationId: opSecondary,
      primaryQueued: Boolean(queuedPrimary?.id),
      secondaryQueued: Boolean(queuedSecondary?.id),
      secondaryErrorCode: secondaryError?.code || null,
      secondaryErrorMessage: secondaryError?.message || null,
      validatedAt: nowIso(),
    },
  };
}

async function main() {
  await waitForRedisReady();
  const shop = process.env.CHAOS_SHOP || `chaos-ef-${Date.now()}.myshopify.com`;

  const [eResult, fResult] = await Promise.all([
    runEExportDuringSync(shop),
    runFScheduledOverlap(shop),
  ]);

  console.log(
    JSON.stringify(
      {
        shop,
        results: [eResult, fResult],
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
