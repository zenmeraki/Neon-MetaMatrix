import crypto from "crypto";

export function createMirrorBatchId(prefix = "mirror") {
  return `${prefix}_${Date.now()}_${crypto.randomUUID()}`;
}
