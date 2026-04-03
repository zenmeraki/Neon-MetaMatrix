import crypto from "crypto";
import { prisma } from "../config/database.js";
import { addbulkImportEditJob } from "../Jobs/Queues/bulkImportEditJob.js";
import {
  BULK_EDIT_EXECUTION_STATES,
  appendExecutionError,
  buildExecutionError,
  buildPlannedUndoState,
} from "./bulkEditExecutionStateService.js";
import { createMultiLanguageForFileEdit } from "../utils/googleTranslator.js";
import {
  createIdempotencyFingerprint,
  withAdvisoryLock,
} from "../utils/idempotencyUtils.js";
import {
  bindOperationFingerprintToResource,
  markOperationFingerprintFailed,
  reserveOperationFingerprint,
} from "./operationFingerprintService.js";
import { buildQueueExecutionPayload } from "../utils/executionIdentity.js";

async function markImportKickoffFailed(editHistoryId, error, filePath) {
  await prisma.editHistory.updateMany({
    where: { id: editHistoryId },
    data: {
      status: "failed",
      executionState: BULK_EDIT_EXECUTION_STATES.FAILED,
      error: appendExecutionError(
        null,
        buildExecutionError({
          code: "bulk_import_queue_failure",
          stage: "queue_enqueue",
          message: error.message,
          retryable: true,
          details: {
            filePath,
          },
        }),
      ),
    },
  });
}

export async function reserveImportExecution({
  shop,
  originalname,
  size,
  columnMappings,
  filePath,
  includeImportDocPath = false,
}) {
  const title = createMultiLanguageForFileEdit(originalname);
  const fingerprint = createIdempotencyFingerprint("csv_import", {
    shop,
    originalname,
    size,
    columnMappings,
  });

  const { result } = await withAdvisoryLock(
    `csv-import:${shop}:${fingerprint}`,
    async () => {
      const reservation = await reserveOperationFingerprint({
        shop,
        operationType: "csv_import",
        fingerprint,
        resourceType: "EDIT_HISTORY",
      });

      if (reservation?.resourceId) {
        const existing = await prisma.editHistory.findFirst({
          where: {
            id: reservation.resourceId,
            shop,
            isSpreadsheetEdit: true,
            status: {
              in: ["pending", "processing"],
            },
          },
        });

        if (existing) {
          return {
            editHistory: existing,
            importDoc: null,
            reused: true,
          };
        }
      }

      const { editHistory, importDoc } = await prisma.$transaction(
        async (tx) => {
          const createdHistory = await tx.editHistory.create({
            data: {
              shop,
              title,
              editedType: "mixed",
              startedAt: new Date(),
              executionState: BULK_EDIT_EXECUTION_STATES.PLANNED,
              executionIdentity: crypto.randomUUID(),
              isSpreadsheetEdit: true,
              undo: buildPlannedUndoState({ allowed: true }),
              rules: [{ field: "mixed" }],
              batch: {
                lastProductId: null,
                hasMore: false,
                size: 0,
              },
            },
          });

          const createdImportDoc = await tx.spreadsheetFile.create({
            data: {
              shop,
              editHistoryId: createdHistory.id,
              columnMappings,
              fileUrl: includeImportDocPath ? filePath : null,
              totalRows: 0,
            },
          });

          return {
            editHistory: createdHistory,
            importDoc: createdImportDoc,
          };
        },
      );

      await bindOperationFingerprintToResource({
        shop,
        operationType: "csv_import",
        fingerprint,
        resourceId: editHistory.id,
      });

      try {
        await addbulkImportEditJob(
          buildQueueExecutionPayload(
            {
              shop,
              filePath,
              historyId: editHistory.id,
              columnMappings,
              source: "csv_import",
            },
            editHistory,
          ),
        );

        await prisma.editHistory.update({
          where: { id: editHistory.id },
          data: {
            executionState: BULK_EDIT_EXECUTION_STATES.QUEUED,
          },
        });
      } catch (error) {
        await markImportKickoffFailed(editHistory.id, error, filePath);
        await markOperationFingerprintFailed({
          shop,
          operationType: "csv_import",
          fingerprint,
          error,
        });
        throw error;
      }

      return {
        editHistory,
        importDoc,
        reused: false,
      };
    },
  );

  return result;
}
