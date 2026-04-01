import { emitToUser } from "../socket.js";

export const SYNC_STATE_CHANGED_EVENT = "sync_state_changed";

export function emitSyncStateChanged({
  shop,
  scope = "product",
  eventType,
  syncBatchId = null,
  bulkOperationId = null,
  syncHistoryId = null,
  stage = null,
  status = null,
  needsAttention = false,
}) {
  if (!shop) {
    return;
  }

  emitToUser(shop, SYNC_STATE_CHANGED_EVENT, {
    shop,
    scope,
    eventType,
    syncBatchId,
    bulkOperationId,
    syncHistoryId,
    stage,
    status,
    needsAttention,
    emittedAt: new Date().toISOString(),
  });
}
