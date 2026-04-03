import crypto from "crypto";
import { prisma } from "../config/database.js";

export const OPERATION_FINGERPRINT_STATUS = {
  RESERVED: "RESERVED",
  ACTIVE: "ACTIVE",
  FAILED: "FAILED",
};

export async function getOperationFingerprint({
  shop,
  operationType,
  fingerprint,
}) {
  const rows = await prisma.$queryRaw`
    SELECT *
    FROM "OperationFingerprint"
    WHERE "shop" = ${shop}
      AND "operationType" = ${operationType}
      AND "fingerprint" = ${fingerprint}
    LIMIT 1
  `;

  return rows?.[0] || null;
}

export async function reserveOperationFingerprint({
  shop,
  operationType,
  fingerprint,
  resourceType,
}) {
  await prisma.$executeRaw`
    INSERT INTO "OperationFingerprint" (
      "id",
      "shop",
      "operationType",
      "fingerprint",
      "resourceType",
      "status"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${shop},
      ${operationType},
      ${fingerprint},
      ${resourceType},
      ${OPERATION_FINGERPRINT_STATUS.RESERVED}
    )
    ON CONFLICT ("shop", "operationType", "fingerprint") DO NOTHING
  `;

  return getOperationFingerprint({
    shop,
    operationType,
    fingerprint,
  });
}

export async function bindOperationFingerprintToResource({
  shop,
  operationType,
  fingerprint,
  resourceId,
  status = OPERATION_FINGERPRINT_STATUS.ACTIVE,
}) {
  await prisma.$executeRaw`
    UPDATE "OperationFingerprint"
    SET
      "resourceId" = ${resourceId},
      "status" = ${status},
      "lastError" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "shop" = ${shop}
      AND "operationType" = ${operationType}
      AND "fingerprint" = ${fingerprint}
  `;
}

export async function markOperationFingerprintFailed({
  shop,
  operationType,
  fingerprint,
  error,
}) {
  await prisma.$executeRaw`
    UPDATE "OperationFingerprint"
    SET
      "status" = ${OPERATION_FINGERPRINT_STATUS.FAILED},
      "lastError" = ${error?.message || "Unknown fingerprint failure"},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "shop" = ${shop}
      AND "operationType" = ${operationType}
      AND "fingerprint" = ${fingerprint}
  `;
}
