import { prisma } from "../../config/database.js";

export async function createTargetSnapshotSet({
  shop,
  intentHash,
  mirrorBatchId,
  resource,
}) {
  const existing = await prisma.targetSnapshotSet.findFirst({
    where: {
      shop,
      intentHash,
      mirrorBatchId,
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) return existing;

  return prisma.targetSnapshotSet.create({
    data: {
      shop,
      intentHash,
      mirrorBatchId,
      resource,
      status: "CREATED",
      operationId: `snapshot:${intentHash}`,
      entityId: `set:${intentHash}:${mirrorBatchId}`,
    },
  });
}
