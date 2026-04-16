import { prisma } from "../Config/database.js";
import { recordMirrorAnomaly } from "./mirrorAnomalyService.js";

const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RENEW_INTERVAL_MS = 60 * 1000;

const buildToken = () => {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export function buildShopWorkLockKey(shop) {
  if (!shop) {
    throw new Error("shop is required for exclusive shop work locking");
  }

  return `shop-exclusive-work:${shop}`;
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
  ttlMs = DEFAULT_LEASE_TTL_MS,
}) {
  const lockKey = buildShopWorkLockKey(shop);
  const token = buildToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  const rows = await prisma.$queryRaw`
    INSERT INTO "ShopWorkLease" (
      "shop",
      "activity",
      "token",
      "worker",
      "queue",
      "jobId",
      "entityType",
      "entityId",
      "executionId",
      "expiresAt",
      "updatedAt"
    )
    VALUES (
      ${shop},
      ${activity},
      ${token},
      ${worker || null},
      ${queue || null},
      ${jobId || null},
      ${entityType || null},
      ${entityId || null},
      ${executionId || null},
      ${expiresAt},
      now()
    )
    ON CONFLICT ("shop") DO UPDATE
    SET
      "activity" = EXCLUDED."activity",
      "token" = EXCLUDED."token",
      "worker" = EXCLUDED."worker",
      "queue" = EXCLUDED."queue",
      "jobId" = EXCLUDED."jobId",
      "entityType" = EXCLUDED."entityType",
      "entityId" = EXCLUDED."entityId",
      "executionId" = EXCLUDED."executionId",
      "expiresAt" = EXCLUDED."expiresAt",
      "updatedAt" = now()
    WHERE "ShopWorkLease"."expiresAt" < now()
      OR (
        "ShopWorkLease"."executionId" IS NOT NULL
        AND "ShopWorkLease"."executionId" = EXCLUDED."executionId"
      )
    RETURNING "shop", "token"
  `;
  const acquired = rows?.[0]?.token === token;

  if (!acquired) {
    await recordMirrorAnomaly({
      shop,
      severity: "medium",
      type: "shop_work_conflict",
      entityType,
      entityId,
      message: `Blocked overlapping ${activity} while another heavy job was active for this shop`,
      details: {
        activity,
        worker,
        queue,
        jobId,
        executionId,
      },
    }).catch(() => {});
  }

  return {
    acquired,
    lockKey,
    shop,
    token,
    expiresAt,
  };
}

export async function renewExclusiveShopWork(lease, ttlMs = DEFAULT_LEASE_TTL_MS) {
  if (!lease?.shop || !lease?.token) {
    return false;
  }

  const result = await prisma.shopWorkLease.updateMany({
    where: {
      shop: lease.shop,
      token: lease.token,
    },
    data: {
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });

  return result.count === 1;
}

export function startExclusiveShopWorkRenewal(
  lease,
  {
    ttlMs = DEFAULT_LEASE_TTL_MS,
    intervalMs = DEFAULT_RENEW_INTERVAL_MS,
    onRenewalError = null,
    onLeaseLost = null,
  } = {},
) {
  if (!lease?.acquired) {
    return null;
  }

  const interval = setInterval(() => {
    renewExclusiveShopWork(lease, ttlMs)
      .then((renewed) => {
        if (!renewed) {
          lease.lost = true;
          if (typeof onLeaseLost === "function") {
            onLeaseLost();
          }
          clearInterval(interval);
        }
      })
      .catch((error) => {
        lease.lost = true;
        if (typeof onRenewalError === "function") {
          onRenewalError(error);
        }
        if (typeof onLeaseLost === "function") {
          onLeaseLost(error);
        }
        clearInterval(interval);
      });
  }, intervalMs);

  if (typeof interval.unref === "function") {
    interval.unref();
  }

  return interval;
}

export function assertExclusiveShopWorkLeaseActive(lease) {
  if (lease?.lost) {
    const error = new Error("Exclusive shop work lease was lost");
    error.code = "SHOP_WORK_LEASE_LOST";
    error.retryable = true;
    throw error;
  }
}

export async function releaseExclusiveShopWork(lease) {
  if (!lease?.shop || !lease?.token) {
    return;
  }

  await prisma.shopWorkLease
    .deleteMany({
      where: {
        shop: lease.shop,
        token: lease.token,
      },
    })
    .catch(() => {});
}
