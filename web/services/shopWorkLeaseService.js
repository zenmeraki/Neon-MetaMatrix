import crypto from "crypto";
import { Prisma } from "../generated/prisma/index.js";
import { prisma } from "../config/database.js";
import { recordMirrorAnomaly } from "./mirrorAnomalyService.js";
import { LOCK_NS, buildShopLockKey } from "../constants/lockNamespaces.js";

const DEFAULT_SHOP_WORK_LEASE_TTL_MS = Math.max(
  Number(process.env.SHOP_WORK_LEASE_TTL_MS || 15 * 60 * 1000),
  60_000,
);
const MAX_LEASE_ACQUIRE_RETRIES = Math.max(
  Number(process.env.SHOP_WORK_LEASE_ACQUIRE_RETRIES || 7),
  3,
);
const MAX_LEASE_EXTEND_RETRIES = Math.max(
  Number(process.env.SHOP_WORK_LEASE_EXTEND_RETRIES || 5),
  2,
);
const MAX_HEARTBEAT_STALENESS_MS = Math.max(
  Number(process.env.SHOP_WORK_MAX_HEARTBEAT_STALENESS_MS || 2 * 60 * 1000),
  30_000,
);
const LEASE_ACQUIRE_TIMEOUT_MS = Math.max(
  Number(process.env.SHOP_WORK_LEASE_ACQUIRE_TIMEOUT_MS || 15_000),
  5_000,
);
const LEASE_HANDLE_VERSION = 1;
const HEX_RE = /^[a-f0-9]+$/i;

export function buildShopWorkLockKey(shop) {
  if (!shop) {
    throw new Error("shop is required for exclusive shop work locking");
  }

  return buildShopLockKey(shop, LOCK_NS.WRITE_CATALOG);
}

function signLeasePayload(payload) {
  const secret = process.env.LEASE_SECRET || process.env.SHOP_WORK_LEASE_SECRET;
  if (!secret) {
    throw new Error("LEASE_SECRET_REQUIRED");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}

function signaturesMatch(left, right) {
  const leftHex = String(left || "");
  const rightHex = String(right || "");
  if (!HEX_RE.test(leftHex) || !HEX_RE.test(rightHex)) {
    return false;
  }

  const leftBuffer = Buffer.from(leftHex, "hex");
  const rightBuffer = Buffer.from(rightHex, "hex");

  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function buildLeaseHandle({
  shop,
  pipeline,
  operationId,
  leaseOwner,
  fencingToken,
  acquiredAt = new Date(),
}) {
  const payload = JSON.stringify({
    leaseVersion: LEASE_HANDLE_VERSION,
    shop,
    pipeline,
    operationId,
    leaseOwner,
    fencingToken: fencingToken?.toString(),
    acquiredAt: new Date(acquiredAt).toISOString(),
  });

  return JSON.stringify({
    payload,
    signature: signLeasePayload(payload),
  });
}

function parseLeaseHandle(lockKey) {
  if (!lockKey || typeof lockKey !== "string") return null;

  try {
    const envelope = JSON.parse(lockKey);
    if (!envelope?.payload || !envelope?.signature) {
      return null;
    }

    const expectedSignature = signLeasePayload(envelope.payload);
    if (!signaturesMatch(envelope.signature, expectedSignature)) {
      return null;
    }

    const parsed = JSON.parse(envelope.payload);
    if (
      parsed?.leaseVersion !== LEASE_HANDLE_VERSION ||
      !parsed?.shop ||
      !parsed?.pipeline ||
      !parsed?.operationId ||
      !parsed?.leaseOwner ||
      !parsed?.fencingToken
    ) {
      return null;
    }

    return {
      ...parsed,
      fencingToken: BigInt(parsed.fencingToken),
    };
  } catch {
    return null;
  }
}

function isRetryableLeaseAcquireError(error) {
  return error?.code === "P2002" || error?.code === "P2034";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function backoffWithJitter(attempt) {
  const base = Math.min(250 * 2 ** Math.max(0, attempt - 1), 2_000);
  const jitter = Math.floor(Math.random() * 250);
  await sleep(base + jitter);
}

async function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label}_TIMEOUT`);
      error.code = `${label}_TIMEOUT`;
      reject(error);
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function acquireOperationLease({
  shop,
  pipeline,
  operationId,
  leaseOwner,
  ttlMs,
}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_LEASE_ACQUIRE_RETRIES; attempt += 1) {
    try {
      return await withTimeout(
        prisma.$transaction(
          async (tx) => {
          const now = new Date();
          const leaseExpiresAt = new Date(now.getTime() + ttlMs);

          const existingRows = await tx.$queryRaw`
            SELECT
              id,
              "createdAt",
              "shop",
              "pipeline",
              "operationId",
              status,
              "leaseOwner",
              "leaseExpiresAt",
              "heartbeatAt",
              "fencingToken"
            FROM "OperationLease"
            WHERE
              "shop" = ${shop}
              AND "pipeline" = ${pipeline}
              AND "operationId" = ${operationId}
            FOR UPDATE
          `;

          const existing =
            Array.isArray(existingRows) && existingRows.length > 0 ? existingRows[0] : null;

          const fencingToken = (existing?.fencingToken || BigInt(0)) + BigInt(1);

          if (!existing) {
            const created = await tx.operationLease.create({
              data: {
                shop,
                pipeline,
                operationId,
                status: "RUNNING",
                leaseOwner,
                leaseExpiresAt,
                heartbeatAt: now,
                fencingToken,
              },
            });

            return { acquired: true, lease: created };
          }

          const activeLease =
            existing.status === "RUNNING" &&
            existing.leaseOwner &&
            existing.leaseOwner !== leaseOwner &&
            existing.leaseExpiresAt &&
            existing.leaseExpiresAt > now;

          if (activeLease) {
            return { acquired: false, lease: existing };
          }

          const updated = await tx.operationLease.updateMany({
            where: {
              id: existing.id,
              OR: [
                { leaseOwner: null },
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lt: now } },
              ],
            },
            data: {
              status: "RUNNING",
              leaseOwner,
              leaseExpiresAt,
              heartbeatAt: now,
              fencingToken,
            },
          });

          if (updated.count !== 1) {
            return { acquired: false, lease: existing };
          }

          const lease = await tx.operationLease.findUnique({
            where: { id: existing.id },
          });

          return { acquired: true, lease };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        ),
        LEASE_ACQUIRE_TIMEOUT_MS,
        "LEASE_ACQUIRE",
      );
    } catch (error) {
      lastError = error;
      if (!isRetryableLeaseAcquireError(error) || attempt === MAX_LEASE_ACQUIRE_RETRIES) {
        throw error;
      }
      await backoffWithJitter(attempt);
    }
  }

  throw lastError || new Error("LEASE_ACQUIRE_FAILED");
}

export async function acquireExclusiveShopWork({
  shop,
  activity,
  worker,
  queue,
  jobId = null,
  entityType = null,
  entityId = null,
  executionId = null,
  ttlMs = DEFAULT_SHOP_WORK_LEASE_TTL_MS,
}) {
  const pipeline = LOCK_NS.WRITE_CATALOG;
  const operationId = shop;
  const leaseOwner =
    executionId ||
    [
      worker || "worker",
      process.pid,
      process.env.HOSTNAME || "host",
      crypto.randomUUID(),
    ].join(":");
  const result = await acquireOperationLease({
    shop,
    pipeline,
    operationId,
    leaseOwner,
    ttlMs,
  });

  if (!result.acquired) {
    await recordMirrorAnomaly({
      shop,
      severity: "medium",
      type: "shop_work_conflict",
      entityType,
      entityId,
      message: `Blocked overlapping ${activity} while another heavy job was active`,
      details: {
        activity,
        worker,
        queue,
        jobId,
        executionId,
        leaseOwner,
        heldLeaseOwner: result.lease?.leaseOwner || null,
        heldLeaseExpiresAt: result.lease?.leaseExpiresAt || null,
        heldFencingToken: result.lease?.fencingToken?.toString() || null,
      },
    }).catch(() => {});
  }

  return {
    acquired: result.acquired,
    lockKey: result.acquired
      ? buildLeaseHandle({
          shop,
          pipeline,
          operationId,
          leaseOwner,
          fencingToken: result.lease?.fencingToken,
          acquiredAt: result.lease?.createdAt || result.lease?.heartbeatAt || new Date(),
        })
      : null,
    leaseOwner,
    leaseExpiresAt: result.lease?.leaseExpiresAt || null,
    fencingToken: result.lease?.fencingToken || null,
  };
}

export async function extendExclusiveShopWork(
  lockKey,
  ttlMs = DEFAULT_SHOP_WORK_LEASE_TTL_MS,
) {
  const lease = parseLeaseHandle(lockKey);
  if (!lease) return { extended: false };

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_LEASE_EXTEND_RETRIES; attempt += 1) {
    try {
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + ttlMs);
      const updated = await prisma.operationLease.updateMany({
        where: {
          shop: lease.shop,
          pipeline: lease.pipeline,
          operationId: lease.operationId,
          leaseOwner: lease.leaseOwner,
          fencingToken: lease.fencingToken,
          status: "RUNNING",
          leaseExpiresAt: { gt: now },
        },
        data: {
          heartbeatAt: now,
          leaseExpiresAt,
          status: "RUNNING",
        },
      });

      return {
        extended: updated.count === 1,
        leaseExpiresAt,
        fencingToken: lease.fencingToken,
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableLeaseAcquireError(error) || attempt === MAX_LEASE_EXTEND_RETRIES) {
        throw error;
      }
      await backoffWithJitter(attempt);
    }
  }

  throw lastError || new Error("LEASE_EXTEND_FAILED");
}

export async function releaseExclusiveShopWork(lockKey) {
  const lease = parseLeaseHandle(lockKey);
  if (!lease) return { released: false };

  const updated = await prisma.operationLease.updateMany({
    where: {
      shop: lease.shop,
      pipeline: lease.pipeline,
      operationId: lease.operationId,
      leaseOwner: lease.leaseOwner,
      fencingToken: lease.fencingToken,
      status: "RUNNING",
    },
    data: {
      status: "RELEASED",
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(),
    },
  });

  return { released: updated.count === 1 };
}

export async function assertLeaseOwner(lockKey) {
  const lease = parseLeaseHandle(lockKey);
  if (!lease) {
    const error = new Error("INVALID_LEASE_HANDLE");
    error.code = "INVALID_LEASE_HANDLE";
    throw error;
  }

  const current = await prisma.operationLease.findUnique({
    where: {
      shop_pipeline_operationId: {
        shop: lease.shop,
        pipeline: lease.pipeline,
        operationId: lease.operationId,
      },
    },
    select: {
      leaseOwner: true,
      fencingToken: true,
      status: true,
      leaseExpiresAt: true,
      heartbeatAt: true,
    },
  });

  const now = new Date();
  if (
    !current ||
    current.leaseOwner !== lease.leaseOwner ||
    current.fencingToken !== lease.fencingToken ||
    current.status !== "RUNNING"
  ) {
    const error = new Error("LEASE_OWNERSHIP_LOST");
    error.code = "LEASE_OWNERSHIP_LOST";
    throw error;
  }

  if (current.leaseExpiresAt && current.leaseExpiresAt <= now) {
    const error = new Error("LEASE_EXPIRED");
    error.code = "LEASE_EXPIRED";
    throw error;
  }

  if (
    current.heartbeatAt &&
    now.getTime() - current.heartbeatAt.getTime() > MAX_HEARTBEAT_STALENESS_MS
  ) {
    const error = new Error("LEASE_HEARTBEAT_STALE");
    error.code = "LEASE_HEARTBEAT_STALE";
    throw error;
  }

  return current;
}
