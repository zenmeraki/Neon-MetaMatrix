import { prisma } from "../../config/database.js";

function pipelineError(code, message, details = null) {
  const error = new Error(message || code);
  error.code = code;
  error.statusCode = 409;
  error.details = details;
  return error;
}

export const shopPipelineGuardService = {
  async assertCanQueue({ shop, pipeline, operationId = null }) {
    const [state, store] = await Promise.all([
      prisma.storeOperationalState.findUnique({
        where: { shop },
        select: {
          activeWriteOperationId: true,
          activeSyncOperationId: true,
          activeImportOperationId: true,
        },
      }),
      prisma.store.findUnique({
        where: { shopUrl: shop },
        select: {
          isProductSyncing: true,
          isProductInitialySyning: true,
          isCollectionSyncing: true,
        },
      }),
    ]);

    if (["edit", "undo", "export"].includes(pipeline)) {
      if (
        state?.activeWriteOperationId &&
        (!operationId || state.activeWriteOperationId !== operationId)
      ) {
        throw pipelineError(
          "WRITE_PIPELINE_BUSY",
          "Another write pipeline is already active for this shop",
          { activeWriteOperationId: state.activeWriteOperationId },
        );
      }
    }

    if (pipeline === "sync") {
      if (
        state?.activeWriteOperationId ||
        store?.isProductSyncing ||
        store?.isProductInitialySyning
      ) {
        throw pipelineError(
          "SYNC_PIPELINE_BLOCKED",
          "Sync pipeline blocked by active write pipeline",
          { activeWriteOperationId: state?.activeWriteOperationId || null },
        );
      }
    }

    if (pipeline === "collection_sync" && store?.isCollectionSyncing) {
      throw pipelineError(
        "COLLECTION_SYNC_ALREADY_RUNNING",
        "Collection sync pipeline already active",
      );
    }

    return { ok: true };
  },
};
