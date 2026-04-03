import { addbulkExportJob } from "../Jobs/Queues/bulkExportJob.js";
import { prisma } from "../config/database.js";
import {
  freezeTargetSnapshot,
} from "./productService/productTargetingService.js";
import { EXPORT_EXECUTION_STATES, appendSerializedExportError, buildExportExecutionError } from "./exportExecutionStateService.js";
import {
  createIdempotencyFingerprint,
  stableStringify,
  withAdvisoryLock,
} from "../utils/idempotencyUtils.js";
import { clearKeyCaches } from "../utils/cacheUtils.js";
import logger from "../utils/loggerUtils.js";
import {
  bindOperationFingerprintToResource,
  markOperationFingerprintFailed,
  reserveOperationFingerprint,
} from "./operationFingerprintService.js";
import { persistExportJobTargetingMetadata } from "./historyTargetingMetadataService.js";
import { buildQueueExecutionPayload } from "../utils/executionIdentity.js";
import { clearExportHistoryCaches } from "./exportHistoryCacheService.js";

async function markExportKickoffFailed({ exportJobId, exportHistoryId = null, shop, error }) {
  const exportJob = await prisma.exportJob.findFirst({
    where: { id: exportJobId, shop },
    select: { error: true },
  });

  await prisma.exportJob.updateMany({
    where: {
      id: exportJobId,
      shop,
      fileUrl: null,
      status: { in: ["PENDING", "PROCESSING"] },
    },
    data: {
      status: "FAILED",
      executionState: EXPORT_EXECUTION_STATES.FAILED,
      failureStage: "queue_enqueue",
      completedAt: new Date(),
      error: appendSerializedExportError(
        exportJob?.error,
        buildExportExecutionError({
          code: "bulk_export_queue_failure",
          stage: "queue_enqueue",
          message: error.message,
          retryable: true,
        }),
      ),
    },
  });

  if (exportHistoryId) {
    await prisma.exportHistory.updateMany({
      where: {
        id: exportHistoryId,
        shop,
        status: "pending",
      },
      data: {
        status: "failed",
        errorMessage: error.message,
        duration: "Failed before queue registration",
      },
    });
  }
}

export async function createManualExportJob({
  shop,
  filename,
  fields,
  filterParams,
  target,
  source,
  createHistory = false,
}) {
  const filterQuery = JSON.stringify(target.where);
  const normalizedFields = Array.isArray(fields) ? fields : [];
  const fingerprint = createIdempotencyFingerprint("manual_export", {
    shop,
    filename,
    fields: normalizedFields,
    filterQuery,
    type: "Manual export",
  });

  const { result } = await withAdvisoryLock(
    `manual-export:${shop}:${fingerprint}`,
    async () => {
      const reservation = await reserveOperationFingerprint({
        shop,
        operationType: "manual_export",
        fingerprint,
        resourceType: "EXPORT_JOB",
      });

      if (reservation?.resourceId) {
        const existingJob = await prisma.exportJob.findFirst({
          where: {
            id: reservation.resourceId,
            shop,
            type: "Manual export",
            status: {
              in: ["PENDING", "PROCESSING"],
            },
            filename,
            filterQuery,
          },
        });

        if (
          existingJob &&
          stableStringify(existingJob.fields || []) === stableStringify(normalizedFields)
        ) {
          return {
            exportJob: existingJob,
            exportHistory: null,
            reused: true,
          };
        }
      }

      const { exportJob, exportHistory } = await prisma.$transaction(async (tx) => {
        const createdExportHistory = createHistory
          ? await tx.exportHistory.create({
              data: {
                shop,
                filename,
                filters: filterParams,
                status: "pending",
                duration: "Not completed yet.",
              },
            })
          : null;

        const createdExportJob = await tx.exportJob.create({
          data: {
            shop,
            filename,
            fields: normalizedFields,
            filterQuery,
            status: "PENDING",
            executionState: EXPORT_EXECUTION_STATES.PLANNED,
            targetMirrorBatchId: target.mirrorBatchId,
          },
        });

        return {
          exportHistory: createdExportHistory,
          exportJob: createdExportJob,
        };
      });

      await bindOperationFingerprintToResource({
        shop,
        operationType: "manual_export",
        fingerprint,
        resourceId: exportJob.id,
      });

      await persistExportJobTargetingMetadata({
        exportJobId: exportJob.id,
        filterParams,
      });

      const frozenCount = await freezeTargetSnapshot({
        ownerType: "EXPORT_JOB",
        ownerId: exportJob.id,
        shop,
        where: target.where,
        mirrorBatchId: target.mirrorBatchId,
      });

      await prisma.exportJob.update({
        where: { id: exportJob.id },
        data: {
          targetSnapshotCount: frozenCount,
        },
      });

      try {
        await addbulkExportJob(
          buildQueueExecutionPayload(
            {
              exportJobId: exportJob.id,
              shop,
              fields: normalizedFields,
              source,
            },
            exportJob,
          ),
        );
      } catch (error) {
        await markExportKickoffFailed({
          exportJobId: exportJob.id,
          exportHistoryId: exportHistory?.id || null,
          shop,
          error,
        });
        await markOperationFingerprintFailed({
          shop,
          operationType: "manual_export",
          fingerprint,
          error,
        });
        throw error;
      }

      await prisma.exportJob.updateMany({
        where: {
          id: exportJob.id,
          shop,
          executionState: EXPORT_EXECUTION_STATES.PLANNED,
        },
        data: {
          executionState: EXPORT_EXECUTION_STATES.QUEUED,
        },
      });

      await Promise.all([
        clearKeyCaches(`${shop}:sync_details`),
        clearExportHistoryCaches(shop),
      ]).catch((error) => {
        logger.warn("Failed to clear export kickoff caches", {
          shop,
          exportJobId: exportJob.id,
          message: error.message,
        });
      });

      return {
        exportJob,
        exportHistory,
        reused: false,
      };
    },
  );

  return result;
}
