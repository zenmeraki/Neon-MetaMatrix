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
    setSelectedIds(new Set());
    setExcludedIds(new Set());
  }, []);

  const selectPage = useCallback(() => {
    setMode("page");
    setSelectedIds(new Set(pageIds));
    setExcludedIds(new Set());
  }, [pageIds]);

  const selectAllMatching = useCallback(() => {
    setMode("query");
    setSelectedIds(new Set());
    setExcludedIds(new Set());
  }, []);

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
      return {
        mode: "query",
        querySignature,
        filters,
        search,
        sort,
        excludedIds: Array.from(excludedIds),
      };
    }

    return {
      mode: "ids",
      ids: Array.from(selectedIds),
    };
  }, [excludedIds, filters, mode, querySignature, search, selectedIds, sort]);

  return {
    mode,
    selectedSet,
    selectedCount,
    excludedCount: excludedIds.size,
    isPageSelected,
    pageCount: pageIds.length,
    clearSelection,
    selectPage,
    selectAllMatching,
    toggleRow,
    togglePage,
    buildTargetPayload,
  };
}
