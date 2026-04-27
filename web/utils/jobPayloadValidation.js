function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function requireJobData(job, requiredFields, jobName) {
  const data = job?.data;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${jobName} job payload must be an object`);
  }

  for (const field of requiredFields) {
    if (!isNonEmptyString(data[field])) {
      throw new Error(`${jobName} job payload field ${field} must be a non-empty string`);
    }
  }

  return data;
}
