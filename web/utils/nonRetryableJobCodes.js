import { UnrecoverableError } from "bullmq";

export const NON_RETRYABLE_CODES = new Set([
  "UNKNOWN_BULK_EDIT_FIELD",
  "UNKNOWN_BULK_EDIT_OPERATION",
  "EMPTY_BULK_MUTATION_JSONL_PAYLOAD",
  "INVALID_NUMERIC_MUTATION_VALUE",
  "MIRROR_BATCH_ID_REQUIRED_FOR_BULK_EDIT",
  "FROZEN_TARGET_PRODUCTS_MISSING_FROM_MIRROR",
  "UNDO_EMPTY_PRODUCT_PAYLOAD",
]);

export function toUnrecoverableIfNonRetryable(error) {
  if (!error) return error;

  if (!NON_RETRYABLE_CODES.has(error.code)) {
    return error;
  }

  const wrapped = new UnrecoverableError(error.message || error.code);
  wrapped.code = error.code;
  return wrapped;
}
