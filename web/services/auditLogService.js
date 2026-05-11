import { operationEventRepository } from "../repositories/operationEventRepository.js";

function buildAuditOperationId({ shop, entityType, entityId = null }) {
  return `audit:${shop}:${entityType}:${entityId || "global"}`;
}

export async function recordAuditEvent({
  shop,
  action,
  entityType,
  entityId = null,
  actor = null,
  metadata = null,
}) {
  if (!shop || !action || !entityType) return;

  await operationEventRepository.emit({
    shop,
    operationId: buildAuditOperationId({ shop, entityType, entityId }),
    type: `AUDIT_${action}`,
    payload: {
      actor: actor || null,
      entityType,
      entityId,
      metadata: metadata || null,
      recordedAt: new Date().toISOString(),
    },
  });
}
