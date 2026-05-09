import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const BASE_SYNC_POLL_MS = 4000;
const MAX_SYNC_POLL_MS = 30000;
const SYNC_POLL_BACKOFF_MULTIPLIER = 2;

function getSyncState({ syncStatus, loading }) {
  if (loading) return "checking";
  if (!syncStatus) return "unknown";

  if (
    syncStatus.isCurrentlyRunning ||
    syncStatus.isProductSyncing ||
    syncStatus.isProductInitialySyning
  ) {
    return "syncing";
  }

  const latestStatus = String(syncStatus.latestSync?.status || "").toLowerCase();
  if (
    syncStatus.repairRequired ||
    syncStatus.lastSyncErrorSummary ||
    latestStatus === "failed" ||
    latestStatus === "error"
  ) {
    return "failed";
  }

  const healthState = String(syncStatus.mirrorHealthState || "").toLowerCase();
  if (healthState === "stale" || syncStatus.staleReason) return "stale";

  if (
    healthState === "healthy" ||
    healthState === "ready" ||
    syncStatus.shopifyBulkJobCompleted
  ) {
    return "ready";
  }

  return "unknown";
}

export function useProductsSyncState({
  fetchWithAuth,
  runAbortableRequest,
  fetchProducts,
  effectiveFilters,
  productSort,
}) {
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);
  const [syncActionLoading, setSyncActionLoading] = useState(false);
  const [syncCompleted, setSyncCompleted] = useState(false);
  const wasSyncingRef = useRef(false);
  const pollTimeoutRef = useRef(null);
  const pollDelayRef = useRef(BASE_SYNC_POLL_MS);
  const syncRequestSeqRef = useRef(0);

  const dismissSyncCompleted = useCallback(() => setSyncCompleted(false), []);

  const fetchSyncStatus = useCallback(async () => {
    syncRequestSeqRef.current += 1;
    const requestSeq = syncRequestSeqRef.current;

    try {
      const response = await runAbortableRequest("sync_status", (signal) =>
        fetchWithAuth("/api/sync/sync-status", { signal })
      );
      const result = await response.json();

      if (response.ok && result?.syncStatus) {
        if (requestSeq !== syncRequestSeqRef.current) return null;
        setSyncStatus(result.syncStatus);
        return result.syncStatus;
      }
    } catch {
      // Keep the page usable if the sync-status call fails.
    } finally {
      if (requestSeq === syncRequestSeqRef.current) {
        setSyncStatusLoading(false);
      }
    }

    return null;
  }, [fetchWithAuth, runAbortableRequest]);

  useEffect(() => {
    const run = async () => {
      try {
        const status = await fetchSyncStatus();
        const neverSynced =
          !status?.shopifyBulkJobCompleted &&
          !status?.isProductSyncing &&
          !status?.isProductInitialySyning;

        if (neverSynced) {
          await runAbortableRequest("auto_sync_start", (signal) =>
            fetchWithAuth("/api/sync/products", { signal })
          );
        }
      } catch {
        // Keep silent in UI; backend tracks failures.
      }
    };

    run();
  }, [fetchSyncStatus, fetchWithAuth, runAbortableRequest]);

  useEffect(() => {
    const isSyncRunning =
      syncStatus?.isProductSyncing || syncStatus?.isProductInitialySyning;

    if (!isSyncRunning) {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
      pollDelayRef.current = BASE_SYNC_POLL_MS;
      return undefined;
    }

    let stopped = false;

    const poll = async () => {
      if (stopped) return;

      if (document.hidden) {
        pollTimeoutRef.current = window.setTimeout(
          poll,
          Math.min(MAX_SYNC_POLL_MS, pollDelayRef.current)
        );
        return;
      }

      const status = await fetchSyncStatus();
      if (status) {
        pollDelayRef.current = BASE_SYNC_POLL_MS;
      } else {
        pollDelayRef.current = Math.min(
          MAX_SYNC_POLL_MS,
          pollDelayRef.current * SYNC_POLL_BACKOFF_MULTIPLIER
        );
      }

      pollTimeoutRef.current = window.setTimeout(poll, pollDelayRef.current);
    };

    pollTimeoutRef.current = window.setTimeout(poll, pollDelayRef.current);

    return () => {
      stopped = true;
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, [syncStatus?.isProductSyncing, syncStatus?.isProductInitialySyning, fetchSyncStatus]);

  useEffect(() => {
    const isSyncing =
      Boolean(syncStatus?.isProductSyncing) ||
      Boolean(syncStatus?.isProductInitialySyning);

    const justCompleted =
      wasSyncingRef.current &&
      !isSyncing &&
      Boolean(syncStatus?.shopifyBulkJobCompleted) &&
      Boolean(syncStatus?.activeMirrorBatchId);

    if (justCompleted) {
      setSyncCompleted(true);
      fetchProducts(1, effectiveFilters, productSort);
    }

    wasSyncingRef.current = isSyncing;
  }, [
    syncStatus?.isProductSyncing,
    syncStatus?.isProductInitialySyning,
    syncStatus?.shopifyBulkJobCompleted,
    syncStatus?.activeMirrorBatchId,
    fetchProducts,
    effectiveFilters,
    productSort,
  ]);

  const runSync = useCallback(async () => {
    if (syncActionLoading) return;

    setSyncActionLoading(true);

    try {
      await runAbortableRequest("manual_sync_start", (signal) =>
        fetchWithAuth("/api/sync/products", { signal })
      );
      await fetchSyncStatus();
    } finally {
      setSyncActionLoading(false);
    }
  }, [fetchSyncStatus, fetchWithAuth, runAbortableRequest, syncActionLoading]);

  const syncState = useMemo(
    () => getSyncState({ syncStatus, loading: syncStatusLoading }),
    [syncStatus, syncStatusLoading]
  );

  const trustMetadata = useMemo(
    () => ({
      snapshotId: syncStatus?.activeTargetSnapshotId || "not available",
      mirrorBatchId: syncStatus?.activeMirrorBatchId || "not available",
      variantFreshness:
        syncStatus?.variantSyncStatus || syncStatus?.variantBatchStatus || "unknown",
      collectionFreshness:
        syncStatus?.collectionSyncStatus || syncStatus?.collectionBatchStatus || "unknown",
      metafieldFreshness:
        syncStatus?.metafieldSyncStatus || syncStatus?.metafieldBatchStatus || "unknown",
    }),
    [syncStatus]
  );

  return {
    syncStatus,
    syncState,
    syncCompleted,
    syncActionLoading,
    trustMetadata,
    runSync,
    dismissSyncCompleted,
    syncStatusLoading,
  };
}
