import { prisma } from "../config/database.js";
import logger from "../utils/loggerUtils.js";

const DEFAULT_HEARTBEAT_STALE_MS = Math.max(
  Number(process.env.LEASE_SCAVENGER_HEARTBEAT_STALE_MS || 2 * 60 * 1000),
  30_000,
);
const DEFAULT_RELEASED_RETENTION_MS = Math.max(
  Number(process.env.LEASE_SCAVENGER_RELEASED_RETENTION_MS || 7 * 24 * 60 * 60 * 1000),
  60 * 60 * 1000,
);

export async function runOperationLeaseScavengerPass() {
  const now = new Date();
  const staleHeartbeatCutoff = new Date(now.getTime() - DEFAULT_HEARTBEAT_STALE_MS);
  const releasedRetentionCutoff = new Date(now.getTime() - DEFAULT_RELEASED_RETENTION_MS);

  const staleRunning = await prisma.operationLease.updateMany({
    where: {
      status: "RUNNING",
      OR: [
        { leaseExpiresAt: { lt: now } },
        {
          AND: [
            { heartbeatAt: { not: null } },
            { heartbeatAt: { lt: staleHeartbeatCutoff } },
          ],
        },
      ],
    },
    data: {
      status: "RELEASED",
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: now,
    },
  });

  const prunedReleased = await prisma.operationLease.deleteMany({
    where: {
      status: "RELEASED",
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: { lt: releasedRetentionCutoff },
    },
  });

  const result = {
    releasedStaleRunningCount: staleRunning.count,
    prunedReleasedCount: prunedReleased.count,
    staleHeartbeatCutoff: staleHeartbeatCutoff.toISOString(),
    releasedRetentionCutoff: releasedRetentionCutoff.toISOString(),
  };

  logger.info("Operation lease scavenger pass completed", result);
  return result;
}

export const operationLeaseScavengerService = {
  runPass: runOperationLeaseScavengerPass,
};

