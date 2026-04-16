import logger from "./loggerUtils.js";

const emptyToNull = (value) => value || null;

export function logBatchEvent(event, fields = {}) {
  const meta = {
    event,
    shop: emptyToNull(fields.shop),
    syncRunId: emptyToNull(fields.syncRunId),
    bulkOperationId: emptyToNull(fields.bulkOperationId),
    oldMirrorBatchId: emptyToNull(fields.oldMirrorBatchId),
    newCatalogBatchId: emptyToNull(fields.newCatalogBatchId),
    resolvedCatalogBatchId: emptyToNull(fields.resolvedCatalogBatchId),
    path: emptyToNull(fields.path),
    ...(fields.extra && typeof fields.extra === "object" ? fields.extra : {}),
  };

  logger.info(event, meta);
}
