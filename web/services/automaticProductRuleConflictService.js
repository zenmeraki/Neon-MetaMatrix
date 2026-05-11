function actionConflictKey(action = {}) {
  return action.field || "unknown";
}

function actionFields(rule = {}) {
  return (Array.isArray(rule.actions) ? rule.actions : [])
    .map(actionConflictKey)
    .filter(Boolean);
}

function canMergeConflict(rule, field) {
  return rule.conflictStrategy === "MERGE" && field === "tag";
}

export function resolveRuleConflicts(rules = []) {
  const accepted = [];
  const occupiedFields = new Map();

  const sorted = [...rules].sort((left, right) => {
    const priorityDelta = Number(right.priority || 0) - Number(left.priority || 0);
    if (priorityDelta !== 0) return priorityDelta;
    return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
  });

  for (const rule of sorted) {
    const fields = actionFields(rule);
    const conflictingField = fields.find((field) => occupiedFields.has(field));

    if (!conflictingField) {
      accepted.push(rule);
      fields.forEach((field) => occupiedFields.set(field, rule));
      continue;
    }

    if (canMergeConflict(rule, conflictingField)) {
      accepted.push(rule);
      continue;
    }

    if (rule.conflictStrategy === "LAST_WRITE_WINS") {
      accepted.push(rule);
      fields.forEach((field) => occupiedFields.set(field, rule));
      continue;
    }

    if (
      rule.conflictStrategy === "SKIP_ON_CONFLICT" ||
      rule.conflictStrategy === "PRIORITY_WINS" ||
      !rule.conflictStrategy
    ) {
      continue;
    }
  }

  return accepted;
}
