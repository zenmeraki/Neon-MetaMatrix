function normalizeStep(step = {}) {
  const editOption =
    step.editOption ?? step.editType ?? step.editedBy ?? step.editedType ?? null;

  return {
    ...step,
    editOption,
    editType: editOption,
    editedBy: editOption,
    editedType: editOption,
  };
}

export function normalizeDefinitionSteps(steps = []) {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.map((step) => normalizeStep(step));
}

export function mapDefinitionStatusForClient(status, { pausedLabel = "Inactive" } = {}) {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "PAUSED":
      return pausedLabel;
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}
