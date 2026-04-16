import { useCallback, useEffect, useMemo, useState } from "react";

function isActiveSyncStatus(syncStatus) {
  if (!syncStatus) {
    return false;
  }

  const hasCompletedInitialSync =
    syncStatus.shopifyBulkJobCompleted === true &&
    syncStatus.syncProgressStage === "IDLE";

  if (hasCompletedInitialSync) {
    return false;
  }

  return (
    syncStatus.isProductSyncing === true ||
    syncStatus.isProductInitialySyning === true ||
    syncStatus.syncProgressStage === "SHOPIFY_BULK_RUNNING" ||
    syncStatus.syncProgressStage === "MIRROR_STAGING"
  );
}

function normalizeMirrorNotReadyResponse(result) {
  const details = result?.details || {};

  return {
    shopifyBulkJobCompleted: false,
    isProductSyncing: false,
    isProductInitialySyning: false,
    syncProgressStage: "IDLE",
    mirrorReady: false,
    mirrorNotReady: true,
    mirrorNotReadyReason: details.reason || "active_catalog_snapshot_missing",
    catalogBatchId: details.catalogBatchId || null,
    snapshotId: details.snapshotId || null,
    isConsistent: details.isConsistent === true,
    shop: details.shop || null,
  };
}

export default function useProductSyncStatus() {
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);
  const [syncStatusError, setSyncStatusError] = useState(null);
  const [mirrorNotReady, setMirrorNotReady] = useState(false);

  const fetchSyncStatus = useCallback(async () => {
    try {
      setSyncStatusError(null);

      const response = await fetch("/api/sync/sync-status");

      let result = null;
      try {
        result = await response.json();
      } catch {
        result = null;
      }

      if (response.ok && result?.syncStatus) {
        const mirrorReady = result.syncStatus.mirrorReady !== false;
        setSyncStatus({
          ...result.syncStatus,
          mirrorReady,
          mirrorNotReady: !mirrorReady,
          mirrorNotReadyReason: mirrorReady
            ? null
            : result.syncStatus.mirrorNotReadyReason ||
              "active_catalog_snapshot_missing",
        });
        setMirrorNotReady(!mirrorReady);
        return result.syncStatus;
      }

      if (
        response.status === 409 &&
        result?.error === "MIRROR_NOT_READY"
      ) {
        const normalized = normalizeMirrorNotReadyResponse(result);
        setSyncStatus(normalized);
        setMirrorNotReady(true);
        return normalized;
      }

      throw new Error(result?.message || "Failed to load sync status");
    } catch (error) {
      setSyncStatusError(error?.message || "Failed to load sync status");
      return null;
    } finally {
      setSyncStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  const isSyncInProgress = useMemo(
    () => isActiveSyncStatus(syncStatus),
    [syncStatus]
  );

  useEffect(() => {
    if (!isSyncInProgress) {
      return undefined;
    }

    const interval = setInterval(fetchSyncStatus, 4000);
    return () => clearInterval(interval);
  }, [isSyncInProgress, fetchSyncStatus]);

  return {
    syncStatus,
    syncStatusLoading,
    syncStatusError,
    mirrorNotReady,
    isSyncInProgress,
    fetchSyncStatus,
  };
}
