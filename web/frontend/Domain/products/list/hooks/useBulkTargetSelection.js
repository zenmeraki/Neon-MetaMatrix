import { useCallback, useMemo, useState } from "react";

export function useBulkTargetSelection({
  products = [],
  totalMatching = 0,
  querySignature,
  filters,
  search,
  sort,
}) {
  const [mode, setMode] = useState("none");
  const [scope, setScopeState] = useState("page");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [excludedIds, setExcludedIds] = useState(() => new Set());

  const pageIds = useMemo(
    () => products.map((product) => String(product.id)).filter(Boolean),
    [products]
  );

  const selectedSet = useMemo(() => {
    if (mode === "query") {
      return new Set(pageIds.filter((id) => !excludedIds.has(id)));
    }

    return selectedIds;
  }, [excludedIds, mode, pageIds, selectedIds]);

  const selectedCount = useMemo(() => {
    if (mode === "query") {
      return Math.max(0, Number(totalMatching || 0) - excludedIds.size);
    }

    return selectedIds.size;
  }, [excludedIds.size, mode, selectedIds.size, totalMatching]);

  const isPageSelected =
    pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));

  const clearSelection = useCallback(() => {
    setMode("none");
    setScopeState("page");
    setSelectedIds(new Set());
    setExcludedIds(new Set());
  }, []);

  const selectPage = useCallback(() => {
    setMode("page");
    setScopeState("page");
    setSelectedIds(new Set(pageIds));
    setExcludedIds(new Set());
  }, [pageIds]);

  const selectAllMatching = useCallback(() => {
    setMode("query");
    setScopeState("filtered_subset");
    setSelectedIds(new Set());
    setExcludedIds(new Set());
  }, []);

  const setScope = useCallback(
    (nextScope) => {
      if (nextScope === "page") {
        selectPage();
        return;
      }

      setMode("query");
      setScopeState(nextScope);
      setSelectedIds(new Set());
      setExcludedIds(new Set());
    },
    [selectPage]
  );

  const toggleRow = useCallback(
    (id) => {
      if (!id) return;

      const rowId = String(id);

      if (mode === "query") {
        setExcludedIds((current) => {
          const next = new Set(current);

          if (next.has(rowId)) next.delete(rowId);
          else next.add(rowId);

          return next;
        });

        return;
      }

      setMode("page");
      setScopeState("page");

      setSelectedIds((current) => {
        const next = new Set(current);

        if (next.has(rowId)) next.delete(rowId);
        else next.add(rowId);

        if (next.size === 0) {
          setMode("none");
        }

        return next;
      });
    },
    [mode]
  );

  const togglePage = useCallback(() => {
    if (isPageSelected) {
      clearSelection();
      return;
    }

    selectPage();
  }, [clearSelection, isPageSelected, selectPage]);

  const buildTargetPayload = useCallback(() => {
    if (mode === "query") {
      const allResultsScope = scope === "all_results";

      return {
        mode: "query",
        scope,
        querySignature: allResultsScope
          ? JSON.stringify({ search: "", filters: [], sort })
          : querySignature,
        filters: allResultsScope ? [] : filters,
        search: allResultsScope ? "" : search,
        sort,
        excludedIds: Array.from(excludedIds),
      };
    }

    return {
      mode: "ids",
      scope,
      ids: Array.from(selectedIds),
    };
  }, [
    excludedIds,
    filters,
    mode,
    querySignature,
    scope,
    search,
    selectedIds,
    sort,
  ]);

  return {
    mode,
    scope,
    selectedSet,
    selectedCount,
    excludedCount: excludedIds.size,
    isPageSelected,
    pageCount: pageIds.length,
    clearSelection,
    selectPage,
    selectAllMatching,
    setScope,
    toggleRow,
    togglePage,
    buildTargetPayload,
  };
}
