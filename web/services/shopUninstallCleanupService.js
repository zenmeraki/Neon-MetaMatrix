import { connection } from "../config/redis.js";
import { prisma } from "../config/database.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import { transitionOperation } from "./operationTransitionService.js";
import crypto from "crypto";
import { exportStorageService } from "../modules/productExports/exportStorageService.js";
import { importStorageService } from "../modules/productImports/importStorageService.js";
import { assertShopOperational } from "./shopOperationalGuardService.js";
import {
  OPERATION_QUEUE_NAMES,
  getOperationQueue,
} from "../jobs/queues/operationQueueRegistry.js";

const JOB_STATES_TO_REMOVE = [
  "waiting",
  "delayed",
  "prioritized",
  "paused",
];
const UNINSTALL_CLEANUP_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_STEP_TIMEOUT_MS = 30_000;
const QUEUE_STEP_TIMEOUT_MS = 20_000;

function jobBelongsToShop(job, shop) {
  return job?.data?.shop === shop || job?.data?.shopUrl === shop;
}

async function removeShopJobsFromQueue(queue, shop) {
  let removed = 0;
  const failedRemovals = [];
  const pageSize = 500;

  for (const state of JOB_STATES_TO_REMOVE) {
    let start = 0;
    while (true) {
      const jobs = await queue.getJobs([state], start, start + pageSize - 1, true);
      if (!jobs.length) break;

      for (const job of jobs) {
        if (!jobBelongsToShop(job, shop)) continue;
        try {
          await job.remove();
          removed += 1;
        } catch (error) {
          failedRemovals.push({
            jobId: job?.id || null,
            queue: queue?.name || null,
            state,
            error: error?.message || String(error),
          });
        }
      }

      start += pageSize;
    }
  }

  return { removed, failedRemovals };
}

function escapeRedisGlob(value) {
  return String(value).replace(/[[\]{}()*?\\]/g, "\\$&");
}

async function withTimeout(promise, ms, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label}_TIMEOUT`);
      error.code = `${label}_TIMEOUT`;
      reject(error);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function emitCleanupPhase(shop, phase, payload = {}) {
  await prisma.operationEvent
    .create({
      data: {
        shop,
        operationId: `shop_uninstall_cleanup:${shop}`,
        type: phase,
        payload: {
          ...payload,
          recordedAt: new Date().toISOString(),
        },
      },
    })
    .catch(() => {});
}

function toNormalizedObjectKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  if (raw.startsWith("s3://")) {
    const slashIndex = raw.indexOf("/", "s3://".length);
    if (slashIndex === -1) return null;
    return raw.slice(slashIndex + 1).replace(/^\/+/, "").trim() || null;
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const key = parsed.pathname.replace(/^\/+/, "").trim();
      return key || null;
    } catch {
      return null;
    }
  }

  if (raw.includes("/")) {
    return raw.replace(/^\/+/, "").trim() || null;
  }

  return null;
}

async function revokeExternalArtifacts(shop) {
  await prisma.exportHistory.updateMany({
    where: {
      shop,
      status: { in: ["PENDING", "PROCESSING", "READY"] },
    },
    data: {
      status: "EXPIRED",
      exportedData: null,
      errorMessage: "SHOP_UNINSTALLED",
    },
  });

  await prisma.exportJob.updateMany({
    where: {
      shop,
      status: { in: ["PENDING", "PROCESSING"] },
    },
    data: {
      status: "CANCELLED",
      fileUrl: null,
      error: "SHOP_UNINSTALLED",
      completedAt: new Date(),
    },
  });

  await prisma.operationSubmission.updateMany({
    where: {
      shop,
      status: { in: ["PLANNED", "STAGED", "SUBMITTED", "AWAITING_SHOPIFY"] },
    },
    data: {
      errorCode: "SHOP_UNINSTALLED",
      errorMessage: "Shop uninstalled before submission completion.",
      resultUrl: null,
    },
  });

  const [exportArtifacts, exportJobs, submissions, spreadsheetFiles] = await Promise.all([
    prisma.exportArtifact.findMany({
      where: {
        shop,
        status: { in: ["PLANNED", "GENERATING", "STORED"] },
      },
      select: { id: true, storageKey: true, fileKey: true },
    }),
    prisma.exportJob.findMany({
      where: { shop },
      select: { id: true, fileKey: true },
    }),
    prisma.operationSubmission.findMany({
      where: { shop },
      select: { id: true, stagedUploadPath: true },
    }),
    prisma.spreadsheetFile.findMany({
      where: { shop },
      select: { id: true, fileUrl: true },
    }),
  ]);

  const revokedExportKeys = new Set();
  const revokedImportKeys = new Set();

  const exportKeys = new Set();
  for (const artifact of exportArtifacts) {
    if (artifact?.storageKey) exportKeys.add(artifact.storageKey);
    if (artifact?.fileKey) exportKeys.add(artifact.fileKey);
  }
  for (const job of exportJobs) {
    if (job?.fileKey) exportKeys.add(job.fileKey);
  }

  for (const key of exportKeys) {
    try {
      await exportStorageService.deleteFile({ key });
      revokedExportKeys.add(key);
    } catch {}
  }

  const importKeys = new Set();
  for (const submission of submissions) {
    const key = toNormalizedObjectKey(submission?.stagedUploadPath);
    if (key) importKeys.add(key);
  }
  for (const file of spreadsheetFiles) {
    const key = toNormalizedObjectKey(file?.fileUrl);
    if (key) importKeys.add(key);
  }

  for (const key of importKeys) {
    try {
      await importStorageService.deleteObject({ shop, key });
      revokedImportKeys.add(key);
    } catch {}
  }

  await prisma.exportArtifact.updateMany({
    where: {
      shop,
      status: { in: ["PLANNED", "GENERATING", "STORED"] },
    },
    data: {
      status: "EXPIRED",
      downloadUrl: null,
      fileUrl: null,
    },
  });

  await prisma.operationSubmission.updateMany({
    where: { shop },
    data: {
      stagedUploadPath: null,
      stagedUploadUrl: null,
    },
  });

  return {
    revokedExportObjectCount: revokedExportKeys.size,
    revokedImportObjectCount: revokedImportKeys.size,
  };
}

async function clearShopLocks(shop) {
  const safeShop = escapeRedisGlob(shop);
  const patterns = [
    `lock:*:${safeShop}`,
    `lock:*:${safeShop}:*`,
  ];
  let deleted = 0;

  for (const pattern of patterns) {
    let cursor = "0";

    do {
      const [nextCursor, keys] = await connection.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      cursor = nextCursor;

      if (keys.length) {
        deleted += await connection.unlink(...keys);
      }
    } while (cursor !== "0");
  }

  return deleted;
}

async function clearShopRateLimitKeys(shop) {
  const safeShop = escapeRedisGlob(shop);
  const key = `shop:${safeShop}:ops_per_minute`;
  return connection.unlink(key).catch(() => 0);
}

export async function assertShopStillInstalled(shop) {
  await assertShopOperational(shop);

  const state = await prisma.storeOperationalState.findUnique({
    where: { shop },
    select: { writeBlockedReason: true },
  });

  if (state?.writeBlockedReason === "SHOP_UNINSTALLED") {
    const error = new Error("SHOP_UNINSTALLED");
    error.code = "SHOP_UNINSTALLED";
    throw error;
  }
}

export async function assertShopCanEnqueueOperation(shop) {
  return assertShopStillInstalled(shop);
}

export const shopUninstallCleanupService = {
  async cleanupShop(shop) {
    if (!shop) {
      throw new Error("shop is required for uninstall cleanup");
    }

    const cleanupLockKey = `shop:${shop}:uninstall_cleanup`;
    const cleanupLockToken = `${Date.now()}:${crypto.randomUUID()}`;
    const acquired = await connection.set(
      cleanupLockKey,
      cleanupLockToken,
      "PX",
      UNINSTALL_CLEANUP_LEASE_MS,
      "NX",
    );

    if (!acquired) {
      return { skipped: true, reason: "UNINSTALL_CLEANUP_ALREADY_RUNNING", shop };
    }

    const cleanupStartedAt = new Date();
    try {
      await withTimeout(
        prisma.storeOperationalState.upsert({
          where: { shop },
          create: {
            shop,
            activeWriteOperationId: null,
            activeSyncOperationId: null,
            activeImportOperationId: null,
            writeBlockedReason: "SHOP_UNINSTALLED",
            writesBlockedUntil: null,
          },
          update: {
            activeWriteOperationId: null,
            activeSyncOperationId: null,
            activeImportOperationId: null,
            writeBlockedReason: "SHOP_UNINSTALLED",
            writesBlockedUntil: null,
          },
        }),
        DEFAULT_STEP_TIMEOUT_MS,
        "UNINSTALL_BLOCK_SHOP",
      );

      await withTimeout(
        prisma.store.updateMany({
          where: { shopUrl: shop },
          data: {
            isUnInstalled: true,
            unInstalledAt: cleanupStartedAt,
            accessToken: null,
          },
        }),
        DEFAULT_STEP_TIMEOUT_MS,
        "UNINSTALL_REVOKE_SESSION",
      );

      await emitCleanupPhase(shop, "UNINSTALL_BLOCKED_SHOP");

      await withTimeout(
        prisma.recurringEdit.updateMany({
          where: { shop, status: { in: ["ACTIVE", "PAUSED"] } },
          data: { status: "CANCELLED" },
        }),
        DEFAULT_STEP_TIMEOUT_MS,
        "UNINSTALL_DISABLE_RECURRING_EDITS",
      );

      await withTimeout(
        prisma.scheduledExport.updateMany({
          where: { shop, status: { in: ["ACTIVE", "PAUSED"] } },
          data: { status: "CANCELLED" },
        }),
        DEFAULT_STEP_TIMEOUT_MS,
        "UNINSTALL_DISABLE_SCHEDULED_EXPORTS",
      );

      await withTimeout(
        prisma.automaticProductRule.updateMany({
          where: { shop, status: { in: ["ACTIVE", "PAUSED"] } },
          data: { status: "CANCELLED" },
        }),
        DEFAULT_STEP_TIMEOUT_MS,
        "UNINSTALL_DISABLE_AUTOMATION_RULES",
      );

      await emitCleanupPhase(shop, "UNINSTALL_DISABLED_SCHEDULES");

      const activeOperations = await prisma.merchantOperation.findMany({
        where: {
          shop,
          status: {
            in: [
              "PLANNED",
              "SNAPSHOTTING",
              "SNAPSHOTTED",
              "DISPATCHING",
              "AWAITING_SHOPIFY",
              "APPLYING_RESULTS",
            ],
          },
        },
        select: { id: true, status: true },
      });

      let transitionedCount = 0;
      const transitionFailures = [];
      const cancellableStatuses = new Set(["PLANNED", "SNAPSHOTTING", "SNAPSHOTTED"]);

      for (const operation of activeOperations) {
        try {
          const terminalStatus = cancellableStatuses.has(operation.status)
            ? "CANCELLED"
            : "FAILED";
          const now = new Date();

          await transitionOperation({
            shop,
            operationId: operation.id,
            from: operation.status,
            to: terminalStatus,
            data: {
              ...(terminalStatus === "CANCELLED"
                ? { completedAt: now }
                : { failedAt: now }),
              errorCode: "SHOP_UNINSTALLED",
              errorMessage: "Shop uninstalled before operation completed.",
            },
          });

          transitionedCount += 1;
        } catch (error) {
          transitionFailures.push({
            operationId: operation.id,
            fromStatus: operation.status,
            error: error?.message || String(error),
          });
        }
      }
      await emitCleanupPhase(shop, "UNINSTALL_TRANSITIONED_OPERATIONS", {
        transitionedCount,
        transitionFailureCount: transitionFailures.length,
      });

      const queueResults = await Promise.all(
        Object.values(OPERATION_QUEUE_NAMES).map(async (queueName) => {
          try {
            const result = await withTimeout(
              removeShopJobsFromQueue(getOperationQueue(queueName), shop),
              QUEUE_STEP_TIMEOUT_MS,
              `UNINSTALL_QUEUE_${queueName.toUpperCase()}`,
            );
            return {
              queueName,
              removed: result.removed,
              failedRemovals: result.failedRemovals,
            };
          } catch (error) {
            return {
              queueName,
              removed: 0,
              failedRemovals: [
                {
                  jobId: null,
                  queue: queueName,
                  state: null,
                  error: error?.message || String(error),
                },
              ],
            };
          }
        }),
      );

      const removedJobs = queueResults.reduce((sum, result) => sum + result.removed, 0);
      const failedRemovals = queueResults.flatMap((result) => result.failedRemovals);
      await emitCleanupPhase(shop, "UNINSTALL_REMOVED_JOBS", {
        removedJobs,
        failedRemovalCount: failedRemovals.length,
      });

      const artifactRevocation = await withTimeout(
        revokeExternalArtifacts(shop),
        DEFAULT_STEP_TIMEOUT_MS,
        "UNINSTALL_REVOKE_FILES",
      );
      await emitCleanupPhase(shop, "UNINSTALL_REVOKED_FILES", artifactRevocation);

      await withTimeout(
        Promise.all([
          clearKeyCaches(`${shop}:fetchHistories`),
          clearKeyCaches(`${shop}:historyDetails:`),
          clearKeyCaches(`${shop}:historyChanges:`),
          clearKeyCaches(`${shop}:fetchExportHistories:`),
          clearKeyCaches(`${shop}:ProductFetch`),
          clearKeyCaches(`${shop}:ProductFetch:`),
          clearKeyCaches(`${shop}:ProductFilterValues:`),
          clearKeyCaches(`${shop}:productTypes:`),
          clearKeyCaches(`${shop}:sync_`),
        ]),
        DEFAULT_STEP_TIMEOUT_MS,
        "UNINSTALL_CLEAR_CACHE",
      );
      await emitCleanupPhase(shop, "UNINSTALL_CLEARED_CACHE");

      const clearedLocks = await withTimeout(
        clearShopLocks(shop),
        DEFAULT_STEP_TIMEOUT_MS,
        "CLEAR_SHOP_LOCKS",
      );
      const clearedRateLimitKeys = await withTimeout(
        clearShopRateLimitKeys(shop),
        DEFAULT_STEP_TIMEOUT_MS,
        "CLEAR_SHOP_RATE_LIMIT_KEYS",
      );

      await prisma.operationEvent
        .create({
          data: {
            shop,
            operationId: `shop_uninstall_cleanup:${shop}`,
            type: "SHOP_UNINSTALL_CLEANUP_COMPLETED",
            payload: {
              transitionedCount,
              removedJobs,
              clearedLocks,
              clearedRateLimitKeys,
              queueResults,
              transitionFailures,
              failedRemovals,
              artifactRevocation,
              completedAt: new Date().toISOString(),
            },
          },
        })
        .catch(() => {});

      await emitCleanupPhase(shop, "UNINSTALL_COMPLETED");

      const partialFailure =
        transitionFailures.length > 0 || failedRemovals.length > 0;

      return {
        ok: !partialFailure,
        partialFailure,
        cancelledOperations: transitionedCount,
        transitionFailures,
        removedJobs,
        failedRemovals,
        artifactRevocation,
        clearedLocks,
        clearedRateLimitKeys,
        queues: queueResults,
      };
    } finally {
      await connection
        .eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          1,
          cleanupLockKey,
          cleanupLockToken,
        )
        .catch(() => {});
    }
  },
};
