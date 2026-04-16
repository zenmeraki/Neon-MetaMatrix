import { useCallback, useEffect, useState } from "react";

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

export default function useProductSyncStatus() {
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/sync-status");
      const result = await response.json();

      if (response.ok && result?.syncStatus) {
        setSyncStatus(result.syncStatus);
      }
    } catch {
      // Keep consuming pages usable if sync status cannot be loaded.
    } finally {
      setSyncStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  useEffect(() => {
    const isSyncRunning = isActiveSyncStatus(syncStatus);

    if (!isSyncRunning) {
      return undefined;
    }

    const interval = setInterval(fetchSyncStatus, 4000);
    return () => clearInterval(interval);
  }, [
    syncStatus?.isProductSyncing,
    syncStatus?.isProductInitialySyning,
    fetchSyncStatus,
  ]);

  return {
    syncStatus,
    syncStatusLoading,
    isSyncInProgress: isActiveSyncStatus(syncStatus),
  };
}
