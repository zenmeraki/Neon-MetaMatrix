import { UnrecoverableError } from "bullmq";

function normalizeShop(shop) {
  return typeof shop === "string" ? shop.trim().toLowerCase() : "";
}

export function assertShopMatch({
  jobShop,
  dbShop,
  context = "worker",
  jobId = null,
  entityType = null,
  entityId = null,
}) {
  const normalizedJobShop = normalizeShop(jobShop);
  const normalizedDbShop = normalizeShop(dbShop);

  if (!normalizedJobShop) {
    const error = new UnrecoverableError(`${context}: missing job shop`);
    error.code = "JOB_SHOP_REQUIRED";
    error.details = { context, jobId, entityType, entityId };
    throw error;
  }

  if (!normalizedDbShop) {
    const error = new UnrecoverableError(`${context}: missing database shop`);
    error.code = "DATABASE_SHOP_REQUIRED";
    error.details = { context, jobId, entityType, entityId };
    throw error;
  }

  if (normalizedJobShop !== normalizedDbShop) {
    const error = new UnrecoverableError(
      `${context}: job shop does not match database shop`,
    );
    error.code = "JOB_SHOP_MISMATCH";
    error.details = {
      context,
      jobId,
      entityType,
      entityId,
      jobShop: normalizedJobShop,
      dbShop: normalizedDbShop,
    };
    throw error;
  }
}
