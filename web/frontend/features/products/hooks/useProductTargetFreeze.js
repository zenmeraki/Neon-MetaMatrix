import { useCallback, useEffect, useRef, useState } from "react";
import { setFrozenTarget } from "../../../store/slices/productSlice";

export function useProductTargetFreeze({
  fetchWithAuth,
  runAbortableRequest,
  selection,
  querySignature,
  effectiveFilters,
  search,
  dispatch,
  navigate,
}) {
  const freezeInFlightRef = useRef(new Map());
  const targetPreviewRequestSeqRef = useRef(0);
  const [targetAction, setTargetAction] = useState("");
  const [targetActionError, setTargetActionError] = useState("");
  const [targetPreview, setTargetPreview] = useState(null);
  const [targetPreviewLoading, setTargetPreviewLoading] = useState(false);

  const dismissTargetActionError = useCallback(() => setTargetActionError(""), []);

  const freezeTarget = useCallback(
    async (overridePayload, actionKey = "default") => {
      const existing = freezeInFlightRef.current.get(actionKey);
      if (existing) return existing;

      const freezePromise = (async () => {
        const selectionPayload = overridePayload ?? selection.buildTargetPayload();
        const payload =
          selectionPayload.mode === "ids" && selectionPayload.ids.length === 0
            ? {
                mode: "query",
                querySignature,
                filters: effectiveFilters,
                search: search?.trim() || "",
                sort: null,
                excludedIds: [],
              }
            : selectionPayload;

        const response = await runAbortableRequest(
          `freeze_${actionKey}`,
          (signal) =>
            fetchWithAuth("/api/products/targets/freeze", {
              signal,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-Idempotency-Key": `${querySignature}:${actionKey}`,
              },
              body: JSON.stringify(payload),
            })
        );
        const result = await response.json();

        if (!response.ok || !result?.targetSnapshotId) {
          throw new Error(result?.message || result?.error || "TARGET_FREEZE_FAILED");
        }

        return { ...result, payload };
      })();

      freezeInFlightRef.current.set(actionKey, freezePromise);
      try {
        return await freezePromise;
      } finally {
        freezeInFlightRef.current.delete(actionKey);
      }
    },
    [effectiveFilters, fetchWithAuth, querySignature, runAbortableRequest, search, selection]
  );

  const navigateWithFrozenTarget = useCallback(
    (destination, frozenTarget, actionKey, extraState = {}) => {
      dispatch(
        setFrozenTarget({
          targetSnapshotId: frozenTarget.targetSnapshotId,
          count: frozenTarget.count,
          payload: frozenTarget.payload,
          action: actionKey,
        })
      );

      navigate(
        `${destination}?targetSnapshotId=${encodeURIComponent(
          frozenTarget.targetSnapshotId
        )}`,
        {
          state: {
            targetSnapshotId: frozenTarget.targetSnapshotId,
            targetCount: frozenTarget.count,
            targetPayload: frozenTarget.payload,
            ...extraState,
          },
        }
      );
    },
    [dispatch, navigate]
  );

  useEffect(() => {
    targetPreviewRequestSeqRef.current += 1;
    const requestSeq = targetPreviewRequestSeqRef.current;
    const controller = new AbortController();

    const fetchTargetPreview = async () => {
      setTargetPreviewLoading(true);

      try {
        const response = await fetchWithAuth("/api/products/targets/count", {
          signal: controller.signal,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            filters: effectiveFilters,
            search: search?.trim() || "",
            sort: null,
          }),
        });
        const result = await response.json();

        if (requestSeq === targetPreviewRequestSeqRef.current && response.ok) {
          setTargetPreview(result);
        }
      } catch {
        if (requestSeq === targetPreviewRequestSeqRef.current) {
          setTargetPreview(null);
        }
      } finally {
        if (requestSeq === targetPreviewRequestSeqRef.current) {
          setTargetPreviewLoading(false);
        }
      }
    };

    fetchTargetPreview();
    return () => controller.abort();
  }, [effectiveFilters, fetchWithAuth, querySignature, search]);

  return {
    targetAction,
    targetActionError,
    targetPreview,
    targetPreviewLoading,
    freezeTarget,
    navigateWithFrozenTarget,
    dismissTargetActionError,
    setTargetAction,
    setTargetActionError,
  };
}
