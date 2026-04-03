import { prisma } from "../config/database.js";
import { recordMirrorAnomaly } from "./mirrorAnomalyService.js";

async function tryAdvisoryLock(client, lockKey, transactional = true) {
  if (transactional) {
    const rows = await client.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
    `;
    return Boolean(rows?.[0]?.locked);
  }

  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

async function unlockAdvisoryLock(client, lockKey) {
  await client.$queryRaw`
    SELECT pg_advisory_unlock(hashtext(${lockKey}))
  `;
}

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
}) {
  const lockKey = buildShopWorkLockKey(shop);
  const acquired = await tryAdvisoryLock(prisma, lockKey, false);

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
  };
}

export async function releaseExclusiveShopWork(lockKey) {
  if (!lockKey) {
    return;
  }

  await unlockAdvisoryLock(prisma, lockKey).catch(() => {});
}
