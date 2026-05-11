export function compileAutomationActionToBulkEditIntent({
  shop,
  rule,
  action,
  mirrorBatchId,
  actorSource = "automation",
}) {
  if (action.status === "DISABLED") return null;

  if (action.type !== "BULK_EDIT") {
    throw new Error(`UNSUPPORTED_AUTOMATION_ACTION_TYPE:${action.type}`);
  }

  return {
    shop,
    actor: {
      userId: null,
      source: actorSource,
    },
    scope: {
      resource: inferResourceFromField(action.operation.field),
      mirrorBatchId,
    },
    targeting: {
      ast: rule.ruleAstJson,
    },
    operation: {
      field: action.operation.field,
      action: action.operation.action,
      value: action.operation.value,
      options: action.operation.options ?? {},
    },
    safety: {
      requireFreshMirror: true,
      dryRunRequired: rule.dryRunFirst,
      allowPartialExecution: false,
      maxTargets: action.maxTargets ?? null,
    },
  };
}

function inferResourceFromField(field) {
  if (String(field || "").startsWith("variant.")) return "VARIANT";
  return "PRODUCT";
}
