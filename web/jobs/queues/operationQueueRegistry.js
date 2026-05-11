import { Queue, Worker } from "bullmq";
import { connection } from "../../config/redis.js";
import {
  createLazyQueueProxy,
  mergeJobOptions,
  withRetryJitter,
} from "../../utils/jobQueueUtils.js";
import { addDeadLetterJob } from "./deadLetterQueue.js";
import { applyQueueBackpressure } from "./queueBackpressure.js";
import {
  observeQueueDepth,
  recordOperationFailed,
  recordRetry,
} from "../../utils/metricsUtils.js";
import { alertingService } from "../../services/operationalAlertService.js";
import { prisma } from "../../config/database.js";

export const OPERATION_QUEUE_NAMES = {
  SYNC_CATALOG_START: "sync.catalog.start",
  SYNC_CATALOG_INGEST: "sync.catalog.ingest",
  SYNC_CATALOG_FINALIZE: "sync.catalog.finalize",
  BULK_TARGET_FREEZE: "bulk.target.freeze",
  BULK_EDIT_EXECUTE: "bulk.edit.execute",
  BULK_EDIT_FINALIZE: "bulk.edit.finalize",
  SCHEDULED_CLAIM: "scheduled.claim",
  SCHEDULED_DISPATCH: "scheduled.dispatch",
  RULES_DISPATCH: "rules.dispatch",
  EXPORT_EXECUTE: "export.execute",
  UNDO_EXECUTE: "undo.execute",
  OPERATION_REPAIR: "operation.repair",
  OPERATION_DLQ: "operation.dlq",
};

export const OPERATION_QUEUE_CONCURRENCY = {
  [OPERATION_QUEUE_NAMES.SYNC_CATALOG_START]: 2,
  [OPERATION_QUEUE_NAMES.SYNC_CATALOG_INGEST]: 2,
  [OPERATION_QUEUE_NAMES.SYNC_CATALOG_FINALIZE]: 1,
  [OPERATION_QUEUE_NAMES.BULK_TARGET_FREEZE]: 2,
  [OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE]: 3,
  [OPERATION_QUEUE_NAMES.BULK_EDIT_FINALIZE]: 2,
  [OPERATION_QUEUE_NAMES.SCHEDULED_CLAIM]: 1,
  [OPERATION_QUEUE_NAMES.SCHEDULED_DISPATCH]: 2,
  [OPERATION_QUEUE_NAMES.RULES_DISPATCH]: 2,
  [OPERATION_QUEUE_NAMES.EXPORT_EXECUTE]: 2,
  [OPERATION_QUEUE_NAMES.UNDO_EXECUTE]: 2,
  [OPERATION_QUEUE_NAMES.OPERATION_REPAIR]: 1,
};

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: "exponential",
    delay: withRetryJitter(5_000),
  },
  removeOnComplete: {
    age: 48 * 3600,
    count: 5_000,
  },
  removeOnFail: {
    age: 14 * 24 * 3600,
    count: 20_000,
  },
};

export const WRITE_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: withRetryJitter(15_000),
  },
  removeOnComplete: {
    age: 7 * 24 * 3600,
    count: 20_000,
  },
  removeOnFail: {
    age: 30 * 24 * 3600,
    count: 50_000,
  },
};

const PER_SHOP_CONCURRENCY_CEILINGS = {
  BULK_EDIT_EXECUTE: Number(process.env.MAX_ACTIVE_EXECUTIONS_PER_SHOP || 1),
  EXPORT_EXECUTE: Number(process.env.MAX_EXPORTS_PER_SHOP || 1),
  SYNC_CATALOG_START: Number(process.env.MAX_SYNC_JOBS_PER_SHOP || 1),
};

const queueInstances = new Map();

function getDefaultOptionsForQueue(name) {
  return name === OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE ||
    name === OPERATION_QUEUE_NAMES.UNDO_EXECUTE
    ? WRITE_JOB_OPTIONS
    : DEFAULT_JOB_OPTIONS;
}

export function getOperationQueue(name) {
  if (!queueInstances.has(name)) {
    queueInstances.set(
      name,
      applyQueueBackpressure(new Queue(name, {
        connection,
        defaultJobOptions: getDefaultOptionsForQueue(name),
      })),
    );
  }

  return queueInstances.get(name);
}

export function createOperationQueueProxy(name) {
  return createLazyQueueProxy(() => getOperationQueue(name));
}

function minuteBucket(date = new Date()) {
  const bucket = new Date(date);
  bucket.setSeconds(0, 0);
  return bucket.toISOString();
}

function normalizeShopPriority(data = {}, options = {}) {
  const priority = options.priority ?? data.shopWeight ?? data.priority;
  const parsed = Number(priority);

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function requireFields(queueName, data, fields = []) {
  for (const field of fields) {
    if (!data?.[field]) {
      throw new Error(`MISSING_${field}_FOR_${queueName}`);
    }
  }
}

async function assertPerShopConcurrencyCeiling(queueName, data = {}) {
  const shop = data.shop || data.shopId;
  if (!shop) return;

  if (queueName === OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE) {
    const active = await prisma.editHistory.count({
      where: {
        shop,
        status: "processing",
        executionState: { in: ["dispatching", "awaiting_shopify", "finalizing"] },
      },
    });
    if (active >= PER_SHOP_CONCURRENCY_CEILINGS.BULK_EDIT_EXECUTE) {
      const error = new Error("MAX_ACTIVE_EXECUTIONS_PER_SHOP_REACHED");
      error.code = "MAX_ACTIVE_EXECUTIONS_PER_SHOP_REACHED";
      throw error;
    }
  }

  if (queueName === OPERATION_QUEUE_NAMES.EXPORT_EXECUTE) {
    const active = await prisma.exportJob.count({
      where: {
        shop,
        status: "PROCESSING",
      },
    });
    if (active >= PER_SHOP_CONCURRENCY_CEILINGS.EXPORT_EXECUTE) {
      const error = new Error("MAX_EXPORTS_PER_SHOP_REACHED");
      error.code = "MAX_EXPORTS_PER_SHOP_REACHED";
      throw error;
    }
  }

  if (queueName === OPERATION_QUEUE_NAMES.SYNC_CATALOG_START) {
    const active = await prisma.syncRun.count({
      where: {
        shop,
        status: { in: ["queued", "started", "processing"] },
      },
    });
    if (active >= PER_SHOP_CONCURRENCY_CEILINGS.SYNC_CATALOG_START) {
      const error = new Error("MAX_SYNC_JOBS_PER_SHOP_REACHED");
      error.code = "MAX_SYNC_JOBS_PER_SHOP_REACHED";
      throw error;
    }
  }
}

export function buildOperationJobId(queueName, data = {}) {
  const shop = data.shop || data.shopId;

  switch (queueName) {
    case OPERATION_QUEUE_NAMES.SYNC_CATALOG_START:
      requireFields(queueName, { shop, syncRunId: data.syncRunId }, ["shop", "syncRunId"]);
      return `sync:start:${shop}:${data.syncRunId}`;
    case OPERATION_QUEUE_NAMES.SYNC_CATALOG_INGEST:
      requireFields(queueName, { shop, syncRunId: data.syncRunId }, ["shop", "syncRunId"]);
      return `sync:ingest:${shop}:${data.syncRunId}`;
    case OPERATION_QUEUE_NAMES.SYNC_CATALOG_FINALIZE:
      requireFields(queueName, { shop, syncRunId: data.syncRunId }, ["shop", "syncRunId"]);
      return `sync:finalize:${shop}:${data.syncRunId}`;
    case OPERATION_QUEUE_NAMES.BULK_TARGET_FREEZE:
      requireFields(queueName, { shop, operationId: data.operationId }, ["shop", "operationId"]);
      return `bulk:freeze:${shop}:${data.operationId}`;
    case OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE:
      requireFields(queueName, { shop, operationId: data.operationId }, ["shop", "operationId"]);
      return `bulk:execute:${shop}:${data.operationId}`;
    case OPERATION_QUEUE_NAMES.BULK_EDIT_FINALIZE:
      requireFields(queueName, { shop, operationId: data.operationId }, ["shop", "operationId"]);
      return `bulk:finalize:${shop}:${data.operationId}`;
    case OPERATION_QUEUE_NAMES.SCHEDULED_CLAIM:
      requireFields(queueName, { shop }, ["shop"]);
      return `scheduled:claim:${shop}:${data.minuteBucket || minuteBucket(data.runAt)}`;
    case OPERATION_QUEUE_NAMES.SCHEDULED_DISPATCH:
      requireFields(queueName, { shop, scheduledRunId: data.scheduledRunId }, [
        "shop",
        "scheduledRunId",
      ]);
      return `scheduled:dispatch:${shop}:${data.scheduledRunId}`;
    case OPERATION_QUEUE_NAMES.RULES_DISPATCH:
      requireFields(queueName, { shop, ruleRunId: data.ruleRunId || data.runId }, [
        "shop",
        "ruleRunId",
      ]);
      return `rule:dispatch:${shop}:${data.ruleRunId || data.runId}`;
    case OPERATION_QUEUE_NAMES.EXPORT_EXECUTE:
      requireFields(queueName, { shop, exportJobId: data.exportJobId }, ["shop", "exportJobId"]);
      return `export:${shop}:${data.exportJobId}`;
    case OPERATION_QUEUE_NAMES.UNDO_EXECUTE:
      requireFields(
        queueName,
        { shop, undoOperationId: data.undoOperationId || data.operationId || data.executionId },
        ["shop", "undoOperationId"],
      );
      return `undo:${shop}:${data.undoOperationId || data.operationId || data.executionId}`;
    case OPERATION_QUEUE_NAMES.OPERATION_REPAIR:
      return `repair:${data.minuteBucket || minuteBucket(data.runAt)}`;
    default:
      throw new Error(`UNSAFE_JOB_ID_GENERATION:${queueName}`);
  }
}

export async function addShopScopedJob(queueName, name, data = {}, options = {}) {
  const defaultOptions = getDefaultOptionsForQueue(queueName);
  const priority = normalizeShopPriority(data, options);

  const WRITE_OPERATION_QUEUES = new Set([
    OPERATION_QUEUE_NAMES.BULK_EDIT_EXECUTE,
    OPERATION_QUEUE_NAMES.BULK_EDIT_FINALIZE,
    OPERATION_QUEUE_NAMES.UNDO_EXECUTE,
    OPERATION_QUEUE_NAMES.EXPORT_EXECUTE,
    OPERATION_QUEUE_NAMES.SCHEDULED_DISPATCH,
    OPERATION_QUEUE_NAMES.RULES_DISPATCH,
    OPERATION_QUEUE_NAMES.BULK_TARGET_FREEZE,
  ]);

  if (WRITE_OPERATION_QUEUES.has(queueName) && !options.jobId) {
    throw new Error("jobId must be explicitly provided for write operations");
  }

  const queue = getOperationQueue(queueName);
  await assertPerShopConcurrencyCeiling(queueName, data);
  const job = await queue.add(
    name,
    data,
    mergeJobOptions(defaultOptions, {
      ...options,
      ...(priority ? { priority } : {}),
      jobId: options.jobId || buildOperationJobId(queueName, data),
    }),
  );

  await observeQueueDepth(queueName, queue).catch(() => {});
  const counts = await queue
    .getJobCounts("waiting", "delayed", "active")
    .catch(() => null);
  if (
    counts &&
    Number(counts.waiting || 0) + Number(counts.delayed || 0) >
      Number(process.env.QUEUE_STUCK_ALERT_THRESHOLD || 10_000)
  ) {
    alertingService.queueStuck({ queueName, counts });
  }
  return job;
}

export function createOperationWorker(queueName, processor, options = {}) {
  const worker = new Worker(queueName, processor, {
    connection,
    concurrency: options.concurrency ?? OPERATION_QUEUE_CONCURRENCY[queueName] ?? 1,
    limiter: options.limiter,
  });

  worker.on("failed", async (job, error) => {
    recordOperationFailed({
      shop: job?.data?.shop || job?.data?.shopUrl || "unknown",
      operationType: queueName,
      reason: error?.code || error?.message || "UNKNOWN",
    });

    if (job?.attemptsMade > 0) {
      recordRetry({
        shop: job?.data?.shop || job?.data?.shopUrl || "unknown",
        queueName,
      });
    }

    await alertingService.evaluateOperationFailureRate({
      shop: job?.data?.shop || job?.data?.shopUrl || "unknown",
      operationType: queueName,
    }).catch(() => {});

    if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
      await addDeadLetterJob(OPERATION_QUEUE_NAMES.OPERATION_DLQ, {
        job,
        error,
        reason: `${queueName}:FINAL_ATTEMPT_FAILED`,
        originalJobId: job.id,
      }).catch(() => {});
    }
  });

  return worker;
}

export const operationQueues = Object.fromEntries(
  Object.values(OPERATION_QUEUE_NAMES).map((name) => [
    name,
    createOperationQueueProxy(name),
  ]),
);
