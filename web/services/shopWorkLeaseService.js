import { prisma } from "../config/database.js";
import { recordMirrorAnomaly } from "./mirrorAnomalyService.js";

// AFTER — wrap in a transaction so lock auto-releases when transaction ends
async function tryAdvisoryLock(client, lockKey, transactional = true) {
  if (transactional) {
    const rows = await client.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
    `;
    return Boolean(rows?.[0]?.locked);
  }

  // Use xact_lock here too — auto-releases on transaction end
  const rows = await client.$queryRaw`
    SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
  `;
  return Boolean(rows?.[0]?.locked);
}

// No longer needed for xact locks — but keep for safety
async function unlockAdvisoryLock(client, lockKey) {
  // pg_advisory_xact_lock releases automatically — this is a no-op now
  // but we keep it to avoid breaking callers
}

export function buildShopWorkLockKey(shop) {
  if (!shop) {
    throw new Error("shop is required for exclusive shop work locking");
  }

  return `shop-exclusive-work:${shop}`;
}

export async function acquireExclusiveShopWork({
  shop, activity, worker, queue,
  jobId = null, entityType = null, entityId = null, executionId = null,
}) {
  const lockKey = buildShopWorkLockKey(shop);

  // Wrap in transaction so pg_try_advisory_xact_lock auto-releases on end
  const acquired = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked
    `;
    return Boolean(rows?.[0]?.locked);
  });

  if (!acquired) {
    await recordMirrorAnomaly({
      shop,
      severity: "medium",
      type: "shop_work_conflict",
      entityType,
      entityId,
      message: `Blocked overlapping ${activity} while another heavy job was active`,
      details: { activity, worker, queue, jobId, executionId },
    }).catch(() => {});
  }

  return { acquired, lockKey };
}

// releaseExclusiveShopWork becomes a true no-op — xact locks self-release
export async function releaseExclusiveShopWork(lockKey) {
  // Transaction-level advisory locks release automatically.
  // Nothing to do here.
}
