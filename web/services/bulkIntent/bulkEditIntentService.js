import { createBulkEditIntent as createSchemaIntent } from "../../shared/bulkEdit/bulkEditIntent.schema.js";
import { stableHash } from "../../utils/idempotencyKey.js";

export async function createBulkEditIntent(rawIntent) {
  const operation = rawIntent?.operation || {};
  const scope = rawIntent?.scope || {};
  const intent = createSchemaIntent({
    shop: rawIntent?.shop,
    actorId: rawIntent?.actor?.userId || null,
    source: rawIntent?.actor?.source || rawIntent?.source || "MANUAL",
    targetSnapshotId: rawIntent?.target?.targetSnapshotId || null,
    runtimeRule: rawIntent?.targeting?.ast ? { ast: rawIntent.targeting.ast } : null,
    ids: rawIntent?.target?.ids || [],
    mirrorBatchId: scope.mirrorBatchId || null,
    plannerVersion: rawIntent?.target?.plannerVersion || null,
    plannerFingerprint: rawIntent?.target?.plannerFingerprint || null,
    field: operation.field,
    editType: operation.action || operation.editType,
    value: operation.value,
    locationId: operation.locationId || null,
    rounding: operation.rounding || "NONE",
    confirmationToken: rawIntent?.safety?.confirmationToken || null,
    idempotencyKey: rawIntent?.safety?.idempotencyKey || stableHash(rawIntent || {}),
    metadata: rawIntent?.metadata || {},
  });

  intent.scope = scope;
  intent.targeting = rawIntent?.targeting || null;
  intent.operation = {
    ...intent.operation,
    action: operation.action || null,
    options: operation.options || {},
  };
  intent.safety = {
    ...intent.safety,
    requireFreshMirror: rawIntent?.safety?.requireFreshMirror === true,
    dryRunRequired: rawIntent?.safety?.dryRunRequired === true,
    allowPartialExecution: rawIntent?.safety?.allowPartialExecution === true,
    maxTargets: rawIntent?.safety?.maxTargets ?? null,
  };

  const intentHash = stableHash(intent);
  return { intent, intentHash };
}
