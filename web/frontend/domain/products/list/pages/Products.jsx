import {
  Page,
  Text,
  Banner,
  Button,
  InlineStack,
  Layout,
  BlockStack,
} from "@shopify/polaris";
import { MenuHorizontalIcon } from "@shopify/polaris-icons";
import { memo, useMemo, useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";
import { getTranslatedOperatorLabel } from "../utils/filterUtils";
import ProductsSummaryStrip from "../components/ProductsSummaryStrip";
import ProductsUndoBar from "../components/ProductsUndoBar";
import StickyBulkActionBar from "../components/StickyBulkActionBar";
import useProducts from "../hooks/useProducts";
import { useBulkTargetSelection } from "../hooks/useBulkTargetSelection";
import { getFilterByKey } from "../constants";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";
import { useProductsSyncState } from "../../../../features/products/hooks/useProductsSyncState";
import { useProductTargetFreeze } from "../../../../features/products/hooks/useProductTargetFreeze";
import { useProductSavedSegments } from "../../../../features/products/hooks/useProductSavedSegments";
import ProductTrustStateBanner from "../../../../features/products/components/ProductTrustStateBanner";
import ProductNotificationsSection from "../../../../features/products/components/ProductNotificationsSection";
import ProductSelectionActionsSection from "../../../../features/products/components/ProductSelectionActionsSection";
import ProductMainCard from "../../../../features/products/components/ProductMainCard";
import ProductBulkEditConfirmModal from "../../../../features/products/components/ProductBulkEditConfirmModal";

import {
  selectProducts,
  selectFilters,
  selectSearch,
  selectProductCount,
  selectPagination,
  selectPage,
  setFilters,
  setSearch,
  clearFilters,
  setFrozenTarget,
} from "../../../../store/slices/productSlice";

const PRODUCT_SORT_KEY = "ID";
const PRODUCT_SORT_ORDER = "asc";
const PRODUCT_LIST_SORT = {
  sortKey: PRODUCT_SORT_KEY,
  sortOrder: PRODUCT_SORT_ORDER,
};

const INLINE_EDIT_TYPES = {
  status: "Set status",
  vendor: "Set text to value",
  inventory: "Set to fixed value",
};
const QUERY_COST_THRESHOLDS = {
  mediumRows: 250000,
  highRows: 1000000,
};
const STATUS_FACET_VALUES = ["ACTIVE", "DRAFT", "ARCHIVED"];

// Only show banner for these states — suppress "ready" and "checking" to reduce noise
const BANNER_VISIBLE_STATES = new Set(["syncing", "stale", "failed", "unknown"]);
const SEARCH_DEBOUNCE_MS = 350;

function buildQuerySignature({ search = "", filters = [], sort = null }) {
  const normalizedFilters = (Array.isArray(filters) ? filters : [])
    .map((filter) => ({
      field: String(filter?.field || ""),
      operator: String(filter?.operator || ""),
      value: filter?.value ?? null,
    }))
    .sort((a, b) =>
      `${a.field}:${a.operator}:${String(a.value)}`.localeCompare(
        `${b.field}:${b.operator}:${String(b.value)}`
      )
    );

  const normalizedSort = sort
    ? {
        sortKey: String(sort?.sortKey || ""),
        sortOrder: String(sort?.sortOrder || ""),
      }
    : null;

  return JSON.stringify({
    search: String(search || "").trim(),
    filters: normalizedFilters,
    sort: normalizedSort,
  });
}

function buildSegmentName({ filters = [], search = "", t }) {
  const hasOutOfStock = filters.some(
    (filter) =>
      filter.field === "inventory_q" &&
      ["=", "equalTo", "equals"].includes(String(filter.operator)) &&
      String(filter.value) === "0"
  );
  const hasActive = filters.some(
    (filter) =>
      filter.field === "status" &&
      String(filter.value).toUpperCase() === "ACTIVE"
  );

  if (hasOutOfStock && hasActive) {
    return t("defaultOutOfStockActiveSegmentName", {
      defaultValue: "Out-of-stock active products",
    });
  }

  if (search?.trim()) {
    return t("defaultSearchSegmentName", {
      search: search.trim(),
      defaultValue: `${search.trim()} products`,
    });
  }

  return t("defaultFilteredSegmentName", {
    defaultValue: "Filtered products",
  });
}

function formatCompactNumber(value, language) {
  const number = Number(value || 0);

  if (number >= 1000000) {
    return `${(number / 1000000).toLocaleString(language, {
      maximumFractionDigits: 1,
    })}M`;
  }

  if (number >= 1000) {
    return `${(number / 1000).toLocaleString(language, {
      maximumFractionDigits: 1,
    })}K`;
  }

  return number.toLocaleString(language);
}

function hasOutOfStockFilter(filters = []) {
  return filters.some(
    (filter) =>
      filter.field === "inventory_q" &&
      ["=", "equalTo", "equals"].includes(String(filter.operator)) &&
      String(filter.value) === "0"
  );
}

function estimateStatusFacets({ products = [], total = 0, language }) {
  const counts = STATUS_FACET_VALUES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    {}
  );

  products.forEach((product) => {
    const status = String(product?.status || "").toUpperCase();
    if (counts[status] !== undefined) {
      counts[status] += 1;
    }
  });

  const pageTotal = products.length || 0;
  const scale = pageTotal > 0 ? Number(total || 0) / pageTotal : 0;

  return STATUS_FACET_VALUES.map((status) => ({
    status,
    count: Math.round((counts[status] || 0) * scale),
    label: Math.round((counts[status] || 0) * scale).toLocaleString(language),
  }));
}

function getCatalogDriftCount(syncStatus) {
  const possibleCounts = [
    syncStatus?.changedSinceLastSyncCount,
    syncStatus?.changedProductsSinceLastSync,
    syncStatus?.driftCount,
    syncStatus?.pendingProductChanges,
    syncStatus?.unreconciledProductCount,
  ];

  return possibleCounts
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value > 0);
}

function getSyncBannerView({ state, syncStatus, t }) {
  const driftCount = getCatalogDriftCount(syncStatus);

  switch (state) {
    case "syncing":
      return {
        tone: "info",
        message: t("syncRunningMessage", {
          defaultValue:
            "Catalog sync is running. Bulk targets will update when syncing completes.",
        }),
      };
    case "stale":
      return {
        tone: "warning",
        message: driftCount
          ? t("syncStaleWithCountMessage", {
              count: driftCount.toLocaleString(),
              defaultValue: `${driftCount.toLocaleString()} products changed since last sync.`,
            })
          : t("syncStaleMessage", {
              defaultValue:
                "Products changed since last sync. Refresh catalog before large edits or exports.",
            }),
      };
    case "failed":
      return {
        tone: "critical",
        message: t("syncFailedMessage", {
          defaultValue:
            "The last catalog sync failed. Retry before running bulk actions.",
        }),
      };
    default:
      return {
        tone: "warning",
        message: t("syncUnknownMessage", {
          defaultValue:
            "Catalog consistency is unknown. Sync before destructive changes.",
        }),
      };
  }
}

function getUndoState(action) {
  return String(action?.undo?.status ?? action?.undoStatusSummary?.key ?? "idle")
    .trim()
    .toLowerCase();
}

function canUndoLastAction(action) {
  if (typeof action?.canUndo === "boolean") {
    return action.canUndo;
  }

  const status = String(action?.status || "").trim().toLowerCase();
  const executionState = String(action?.executionState || "").trim().toLowerCase();
  const undoState = getUndoState(action);
  const undoAllowed = action?.undo == null ? true : action.undo.allowed === true;

  return (
    undoAllowed &&
    (status === "completed" || executionState === "completed") &&
    ["idle", "failed", "undo_failed"].includes(undoState)
  );
}

function isActionInProgress(action) {
  const status = String(action?.status || "").trim().toLowerCase();
  return !["completed", "failed", "cancelled"].includes(status);
}

const SyncBannerSection = memo(function SyncBannerSection({
  showSyncBanner,
  syncBannerView,
  syncState,
  runSync,
  syncActionLoading,
  t,
}) {
  if (!showSyncBanner || !syncBannerView) return null;

  return (
    <Layout.Section>
      <Banner tone={syncBannerView.tone}>
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text as="p">{syncBannerView.message}</Text>
          <InlineStack gap="200">
            {syncState === "stale" ? (
              <Button onClick={runSync} loading={syncActionLoading} disabled={syncActionLoading}>
                {t("refreshCatalog", { defaultValue: "Refresh catalog" })}
              </Button>
            ) : null}
            {syncState === "failed" ? (
              <Button onClick={runSync} loading={syncActionLoading} disabled={syncActionLoading}>
                {t("retry", { defaultValue: "Retry" })}
              </Button>
            ) : null}
          </InlineStack>
        </InlineStack>
      </Banner>
    </Layout.Section>
  );
});

const SummarySection = memo(function SummarySection({
  selectedCount,
  totalCount,
  loading,
  queryCost,
  streamingState,
}) {
  return (
    <Layout.Section>
      <ProductsSummaryStrip
        selectedCount={selectedCount}
        totalCount={totalCount}
        loading={loading}
        queryCost={queryCost}
        streamingState={streamingState}
      />
    </Layout.Section>
  );
});

export default function ProductsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const fetchWithAuth = useAuthenticatedFetch();

  const products = useSelector(selectProducts);
  const filterState = useSelector(selectFilters);
  const totalCount = useSelector(selectProductCount);
  const pagination = useSelector(selectPagination);
  const page = useSelector(selectPage);
  const search = useSelector(selectSearch);
  const { i18n, t } = useTranslation();

  const { loading, error, hasFetched, lastFetchedAt, streamingState, fetchProducts } =
    useProducts();

  const [showBulkEditConfirm, setShowBulkEditConfirm] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [undoingLastAction, setUndoingLastAction] = useState(false);
  const [selectionCommandNotice, setSelectionCommandNotice] = useState("");
  const [savingInlineCell, setSavingInlineCell] = useState("");
  const [previewProduct, setPreviewProduct] = useState(null);
  const [statusFacetBaseline, setStatusFacetBaseline] = useState(null);
  const [inventoryLocationId, setInventoryLocationId] = useState("");

  const previousQuerySignatureRef = useRef("");
  const searchDebounceTimeoutRef = useRef(null);
  const clearSelectionRef = useRef(() => {});
  const requestAbortControllersRef = useRef(new Map());
  const dismissSelectionCommandNotice = useCallback(
    () => setSelectionCommandNotice(""),
    []
  );

  const runAbortableRequest = useCallback(async (requestKey, run) => {
    const existing = requestAbortControllersRef.current.get(requestKey);
    if (existing) existing.abort();

    const controller = new AbortController();
    requestAbortControllersRef.current.set(requestKey, controller);

    try {
      return await run(controller.signal);
    } finally {
      if (requestAbortControllersRef.current.get(requestKey) === controller) {
        requestAbortControllersRef.current.delete(requestKey);
      }
    }
  }, []);

  const fetchLastAction = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: "1",
        lang: i18n.language || "en",
      });
      const response = await runAbortableRequest("last_action", (signal) =>
        fetchWithAuth(`/api/history/get-shop-edithistory?${params.toString()}`, {
          signal,
          method: "GET",
          headers: { Accept: "application/json" },
        })
      );
      const result = await response.json();

      if (response.ok && Array.isArray(result?.data)) {
        const latest = result.data[0] || null;
        setLastAction(latest);
        if (latest?.canUndo === true || latest?.canUndo === false) {
          return;
        }
      }
    } catch {
      setLastAction(null);
    }
  }, [fetchWithAuth, i18n.language, runAbortableRequest]);

  const effectiveFilters = useMemo(() => {
    const baseFilters = filterState.filter((f) => f.field !== "search");

    if (!search?.trim()) return baseFilters;

    return [
      ...baseFilters,
      { field: "search", operator: "contains", value: search.trim() },
    ];
  }, [filterState, search]);

  const hasActiveSegmentCriteria = effectiveFilters.length > 0;
  const hasOutOfStockActiveFilter = hasOutOfStockFilter(effectiveFilters);

  useEffect(() => {
    if (hasActiveSegmentCriteria || !products.length || totalCount <= 0) return;

    setStatusFacetBaseline(
      estimateStatusFacets({ products, total: totalCount, language: i18n.language })
    );
  }, [hasActiveSegmentCriteria, i18n.language, products, totalCount]);

  const querySignature = useMemo(
    () =>
      buildQuerySignature({
        search: search?.trim() || "",
        filters: effectiveFilters,
        sort: PRODUCT_LIST_SORT,
      }),
    [effectiveFilters, search]
  );

  useEffect(() => {
    let active = true;
    const nextSignature = querySignature;
    const previousSignature = previousQuerySignatureRef.current;
    const shouldResetSelection =
      Boolean(previousSignature) && previousSignature !== nextSignature;

    const run = async () => {
      await fetchProducts(1, effectiveFilters, PRODUCT_LIST_SORT);
      if (!active) return;

      if (shouldResetSelection) {
        clearSelectionRef.current();
      }

      previousQuerySignatureRef.current = nextSignature;
    };

    run();

    return () => {
      active = false;
    };
  }, [effectiveFilters, fetchProducts, querySignature]);

  useEffect(() => {
    fetchLastAction();
  }, [fetchLastAction]);

  useEffect(() => {
    if (!lastAction?.id || !isActionInProgress(lastAction)) {
      return undefined;
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetchWithAuth(`/api/history/live-progress/${lastAction.id}`, {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) return;
        const payload = await response.json();
        const progress = payload?.data || null;
        if (!progress) return;

        setLastAction((current) =>
          current?.id === lastAction.id
            ? {
                ...current,
                status: progress.status || current.status,
                processedCount: progress.processedCount ?? current.processedCount,
                totalItems: progress.totalItems ?? current.totalItems,
                progressSummary: {
                  ...(current.progressSummary || {}),
                  percent: progress.percent,
                  label: progress.label,
                  isActive: progress.isActive,
                  status: progress.status,
                },
                telemetry: {
                  ...(current.telemetry || {}),
                  ...(progress.telemetry || {}),
                },
              }
            : current,
        );
      } catch {
        // silent polling failure
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchWithAuth, lastAction]);

  const {
    presetViews,
    savedSegments,
    selectedView,
    segmentName,
    segmentNotice,
    setSegmentName,
    handleSaveCurrentSegment,
    handleSavedViewSelect,
    dismissSegmentNotice,
    setSelectedView,
  } = useProductSavedSegments({
    fetchWithAuth,
    dispatch,
    t,
    targetSort: PRODUCT_LIST_SORT,
    filterState,
    search,
    hasActiveSegmentCriteria,
  });

  useEffect(() => {
    if (!hasActiveSegmentCriteria) {
      setSegmentName("");
      return;
    }

    setSegmentName(
      buildSegmentName({ filters: effectiveFilters, search, t })
    );
  }, [effectiveFilters, hasActiveSegmentCriteria, search, setSegmentName, t]);

  const onFilterChange = useCallback(
    (field, nextFilter) => {
      const updated = (() => {
        const index = filterState.findIndex((f) => f.field === field);
        if (index !== -1) {
          const copy = [...filterState];
          copy[index] = { field, ...nextFilter };
          return copy;
        }
        return [...filterState, { field, ...nextFilter }];
      })();

      dispatch(setFilters(updated));
      setSelectedView(0);
    },
    [filterState, dispatch, setSelectedView]
  );

  const onClearAll = useCallback(() => {
    dispatch(clearFilters());
    fetchProducts(1, [], PRODUCT_LIST_SORT);
    setSelectedView(0);
  }, [dispatch, fetchProducts, setSelectedView]);

  const handleSearchChange = useCallback(
    (value) => {
      if (searchDebounceTimeoutRef.current) {
        clearTimeout(searchDebounceTimeoutRef.current);
      }

      searchDebounceTimeoutRef.current = window.setTimeout(() => {
        dispatch(setSearch(value));
        setSelectedView(0);
      }, SEARCH_DEBOUNCE_MS);
    },
    [dispatch]
  );

  const handleSearchClear = useCallback(() => {
    if (searchDebounceTimeoutRef.current) {
      clearTimeout(searchDebounceTimeoutRef.current);
      searchDebounceTimeoutRef.current = null;
    }
    dispatch(setSearch(""));
    setSelectedView(0);
  }, [dispatch]);

  useEffect(
    () => () => {
      if (searchDebounceTimeoutRef.current) {
        clearTimeout(searchDebounceTimeoutRef.current);
      }
      requestAbortControllersRef.current.forEach((controller) => {
        controller.abort();
      });
      requestAbortControllersRef.current.clear();
    },
    []
  );

  const appliedFilters = useMemo(
    () =>
      filterState
        .filter((f) => f.field !== "search")
        .map(({ field, operator, value }) => {
          const filter = getFilterByKey(field);
          const translatedFieldLabel = t(`fieldLabels.${field}`, filter?.label || field);
          const translatedOperator = getTranslatedOperatorLabel(t, operator);
          const translatedValue =
            filter?.type === "enum"
              ? t(`filterValueLabels.${value}`, value)
              : value;

          return {
            key: field,
            label: `${translatedFieldLabel} ${translatedOperator} ${translatedValue}`,
            operator,
            value,
            onRemove: () =>
              dispatch(setFilters(filterState.filter((f) => f.field !== field))),
          };
        }),
    [filterState, dispatch, t]
  );

  const selection = useBulkTargetSelection({
    products,
    totalMatching: totalCount,
    querySignature,
    filters: effectiveFilters,
    search: search?.trim() || "",
    sort: null,
  });
  clearSelectionRef.current = selection.clearSelection;

  const handleRetryProducts = useCallback(() => {
    fetchProducts(page, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts, page]);

  const handleNextPage = useCallback(() => {
    fetchProducts(page + 1, effectiveFilters, PRODUCT_LIST_SORT, {
      direction: "next",
      cursor: pagination?.nextCursor || null,
      stream: false,
    });
  }, [effectiveFilters, fetchProducts, page, pagination?.nextCursor]);

  const handlePreviousPage = useCallback(() => {
    if (page <= 1) return;
    fetchProducts(page - 1, effectiveFilters, PRODUCT_LIST_SORT, {
      direction: "prev",
      stream: false,
    });
  }, [effectiveFilters, fetchProducts, page]);

  const {
    syncStatus,
    syncState,
    syncCompleted,
    syncActionLoading,
    trustMetadata,
    runSync,
    dismissSyncCompleted,
    syncStatusLoading,
  } = useProductsSyncState({
    fetchWithAuth,
    runAbortableRequest,
    fetchProducts,
    effectiveFilters,
    productSort: PRODUCT_LIST_SORT,
  });

  const isSyncInProgress =
    Boolean(syncStatus?.isProductSyncing) ||
    Boolean(syncStatus?.isProductInitialySyning);

  const showSyncBanner = BANNER_VISIBLE_STATES.has(syncState);
  const syncBannerView = showSyncBanner
    ? getSyncBannerView({ state: syncState, syncStatus, t })
    : null;

  const estimatedScanRows = Number(
    syncStatus?.storeTotalProducts ||
      targetPreview?.estimatedScanRows ||
      targetPreview?.total ||
      totalCount ||
      0
  );

  const queryCost = useMemo(() => {
    const hasBroadTextFilter = effectiveFilters.some((filter) =>
      ["contains", "does not contain"].includes(String(filter.operator))
    );
    const level =
      estimatedScanRows >= QUERY_COST_THRESHOLDS.highRows || hasBroadTextFilter
        ? "HIGH"
        : estimatedScanRows >= QUERY_COST_THRESHOLDS.mediumRows ||
          effectiveFilters.length >= 3
        ? "MEDIUM"
        : "LOW";

    return {
      level,
      tone:
        level === "HIGH" ? "critical" : level === "MEDIUM" ? "warning" : "success",
      estimatedScanLabel: formatCompactNumber(estimatedScanRows, i18n.language),
    };
  }, [effectiveFilters, estimatedScanRows, i18n.language]);

  const facetStats = useMemo(() => {
    const currentFacets = estimateStatusFacets({
      products,
      total: targetPreview?.total ?? totalCount,
      language: i18n.language,
    });
    const baseline =
      statusFacetBaseline ||
      estimateStatusFacets({ products, total: totalCount, language: i18n.language });

    return currentFacets.map((facet) => {
      const before =
        baseline.find((item) => item.status === facet.status)?.label || "0";
      return {
        key: facet.status,
        label: t(`statusChoices.${facet.status.toLowerCase()}`, {
          defaultValue:
            facet.status.charAt(0) + facet.status.slice(1).toLowerCase(),
        }),
        beforeLabel: before,
        afterLabel: facet.label,
      };
    });
  }, [i18n.language, products, statusFacetBaseline, t, targetPreview?.total, totalCount]);

  const shouldShowLoadingState =
    loading ||
    !hasFetched ||
    (!products.length && (syncStatusLoading || isSyncInProgress));

  const {
    targetAction,
    targetActionError,
    targetPreview,
    targetPreviewLoading,
    freezeTarget,
    navigateWithFrozenTarget,
    dismissTargetActionError,
    setTargetAction,
    setTargetActionError,
  } = useProductTargetFreeze({
    fetchWithAuth,
    runAbortableRequest,
    selection,
    querySignature,
    effectiveFilters,
    search,
    dispatch,
    navigate,
  });

  const handleSuggestedDraftOutOfStock = useCallback(async () => {
    if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

    setTargetAction("edit");
    setTargetActionError("");

    try {
      const frozenTarget = await freezeTarget(undefined, "suggested_draft_out_of_stock");
      navigateWithFrozenTarget("/edit", frozenTarget, "edit", {
        recipeKey: "draftOutOfStock",
      });
    } catch (error) {
      setTargetActionError(
        error.message || "Could not prepare the selected product target."
      );
    } finally {
      setTargetAction("");
    }
  }, [freezeTarget, navigateWithFrozenTarget, shouldShowLoadingState, targetAction, totalCount]);

  const handleBulkEdit = useCallback(async () => {
    if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

    setTargetAction("edit");
    setTargetActionError("");

    try {
      const frozenTarget = await freezeTarget(undefined, "bulk_edit");
      navigateWithFrozenTarget("/edit", frozenTarget, "edit");
    } catch (error) {
      setTargetActionError(
        error.message || "Could not prepare the selected product target."
      );
    } finally {
      setTargetAction("");
    }
  }, [freezeTarget, navigateWithFrozenTarget, shouldShowLoadingState, targetAction, totalCount]);

  const handleUndoLastAction = useCallback(async () => {
    if (!lastAction?.id || !canUndoLastAction(lastAction)) return;

    setUndoingLastAction(true);

    try {
      const response = await runAbortableRequest("undo_last_action", (signal) =>
        fetchWithAuth(`/api/products/undo-edit/${lastAction.id}`, {
          signal,
          method: "PUT",
          headers: { "Content-Type": "application/json" },
        })
      );

      if (response.ok) {
        setLastAction((current) =>
          current?.id === lastAction.id
            ? {
                ...current,
                undo: {
                  ...current.undo,
                  status: "processing",
                  state: "queued",
                  startedAt: new Date().toISOString(),
                },
                undoStatusSummary: {
                  key: "undo_queued",
                  tone: "attention",
                  isTerminal: false,
                },
              }
            : current
        );
      }
    } finally {
      setUndoingLastAction(false);
    }
  }, [fetchWithAuth, lastAction, runAbortableRequest]);

  const handleViewLastActionChanges = useCallback(() => {
    if (!lastAction?.id) return;
    navigate(`/editDetails/${lastAction.id}`);
  }, [lastAction?.id, navigate]);

  const openBulkEditConfirm = useCallback(() => {
    if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

    setTargetActionError("");
    setShowBulkEditConfirm(true);
  }, [shouldShowLoadingState, targetAction, totalCount]);

  const closeBulkEditConfirm = useCallback(() => {
    if (targetAction) return;
    setShowBulkEditConfirm(false);
  }, [targetAction]);

  const confirmBulkEdit = useCallback(async () => {
    await handleBulkEdit();
    setShowBulkEditConfirm(false);
  }, [handleBulkEdit]);

  const handleBulkExport = useCallback(async () => {
    if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

    setTargetAction("export");
    setTargetActionError("");

    try {
      const frozenTarget = await freezeTarget(undefined, "bulk_export");
      navigateWithFrozenTarget("/exportdata", frozenTarget, "export");
    } catch (error) {
      setTargetActionError(
        error.message || "Could not prepare the selected product target."
      );
    } finally {
      setTargetAction("");
    }
  }, [freezeTarget, navigateWithFrozenTarget, shouldShowLoadingState, targetAction, totalCount]);

  const freezeSelectionCommand = useCallback(
    async (actionKey) => {
      if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

      setTargetAction(actionKey);
      setTargetActionError("");
      setSelectionCommandNotice("");

      try {
        const frozenTarget = await freezeTarget(undefined, `selection_${actionKey}`);
        dispatch(
          setFrozenTarget({
            targetSnapshotId: frozenTarget.targetSnapshotId,
            count: frozenTarget.count,
            payload: frozenTarget.payload,
            action: actionKey,
          })
        );

        setSelectionCommandNotice(
          t("selectionTargetFrozen", {
            count: frozenTarget.count,
            defaultValue: `Selection target prepared for ${Number(
              frozenTarget.count || 0
            ).toLocaleString(i18n.language)} products.`,
          })
        );
      } catch (error) {
        setTargetActionError(
          error.message || "Could not prepare the selected product target."
        );
      } finally {
        setTargetAction("");
      }
    },
    [dispatch, freezeTarget, i18n.language, shouldShowLoadingState, t, targetAction, totalCount]
  );

  const handleViewSelection = useCallback(() => {
    freezeSelectionCommand("view_selection");
  }, [freezeSelectionCommand]);

  const handleSaveSelectionSegment = useCallback(() => {
    freezeSelectionCommand("save_segment");
  }, [freezeSelectionCommand]);

  const handleNarrowSelection = useCallback(() => {
    selection.setScope("filtered_subset");
    freezeSelectionCommand("narrow_selection");
  }, [freezeSelectionCommand, selection]);

  const handleAddTags = useCallback(() => {
    freezeSelectionCommand("add_tags");
  }, [freezeSelectionCommand]);

  const handleRemoveTags = useCallback(() => {
    freezeSelectionCommand("remove_tags");
  }, [freezeSelectionCommand]);

  const handleSetStatus = useCallback(() => {
    freezeSelectionCommand("set_status");
  }, [freezeSelectionCommand]);

  const handleBulkDuplicate = useCallback(() => {
    freezeSelectionCommand("bulk_duplicate");
  }, [freezeSelectionCommand]);

  const handleDeleteSelected = useCallback(() => {
    freezeSelectionCommand("delete");
  }, [freezeSelectionCommand]);

  const handleEditProduct = useCallback(
    async (product) => {
      if (targetAction || shouldShowLoadingState || !product?.id) return;

      setTargetAction("edit");
      setTargetActionError("");

      try {
        const frozenTarget = await freezeTarget({
          mode: "ids",
          ids: [String(product.id)],
        }, "edit_single_product");
        navigateWithFrozenTarget("/edit", frozenTarget, "edit");
      } catch (error) {
        setTargetActionError(
          error.message || "Could not prepare the selected product target."
        );
      } finally {
        setTargetAction("");
      }
    },
    [freezeTarget, navigateWithFrozenTarget, shouldShowLoadingState, targetAction]
  );

  const handleInlineSave = useCallback(
    async (product, field, value) => {
      if (!product?.id || savingInlineCell) return false;

      const locationId = field === "inventory" ? inventoryLocationId.trim() : null;

      if (field === "inventory" && !locationId) {
        setTargetActionError(
          t("inventoryInlineEditRequiresLocation", {
            defaultValue:
              "Inventory edits require an explicit location ID. Enter it in Products page before inline inventory edits.",
          })
        );
        return false;
      }

      const editedType = INLINE_EDIT_TYPES[field];

      if (!editedType) {
        setTargetActionError(
          t("inlineEditUnsupportedField", {
            defaultValue: "This field cannot be edited inline yet.",
          })
        );
        return false;
      }

      const productId = String(product.id);
      setSavingInlineCell(`${productId}:${field}`);
      setTargetActionError("");
      setSelectionCommandNotice("");

      try {
        const frozenTarget = await freezeTarget({ mode: "ids", ids: [productId] }, "inline_edit_single_product");

        const response = await runAbortableRequest(
          `inline_update_${productId}`,
          (signal) =>
            fetchWithAuth(
              `/api/products/update?lang=${encodeURIComponent(i18n.language || "en")}`,
              {
                signal,
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                  source: "INLINE",
                  editedField: field,
                  editedType,
                  value,
                  filterParams: [],
                  targetSnapshotId: frozenTarget.targetSnapshotId,
                  ...(locationId ? { locationId } : {}),
                }),
              }
            )
        );
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result?.message || result?.error || "INLINE_EDIT_FAILED");
        }

        setSelectionCommandNotice(
          t("inlineEditQueued", {
            defaultValue: "Inline edit queued. The product row will update after processing.",
          })
        );

        fetchProducts(page, effectiveFilters, PRODUCT_LIST_SORT);
        fetchLastAction();
        return true;
      } catch (error) {
        setTargetActionError(
          error.message ||
            t("inlineEditFailed", { defaultValue: "Could not save inline edit." })
        );
        return false;
      } finally {
        setSavingInlineCell("");
      }
    },
    [effectiveFilters, fetchLastAction, fetchProducts, fetchWithAuth, freezeTarget, i18n.language, page, runAbortableRequest, savingInlineCell, t]
  );

  const freezeProductCommand = useCallback(
    async (product, actionKey) => {
      if (targetAction || shouldShowLoadingState || !product?.id) return;

      setTargetAction(actionKey);
      setTargetActionError("");
      setSelectionCommandNotice("");

      try {
        const frozenTarget = await freezeTarget({
          mode: "ids",
          ids: [String(product.id)],
        }, `product_action_${actionKey}`);

        dispatch(
          setFrozenTarget({
            targetSnapshotId: frozenTarget.targetSnapshotId,
            count: frozenTarget.count,
            payload: frozenTarget.payload,
            action: actionKey,
          })
        );

        setSelectionCommandNotice(
          t("productActionTargetPrepared", {
            defaultValue: "Product action target prepared.",
          })
        );
      } catch (error) {
        setTargetActionError(
          error.message || "Could not prepare the selected product target."
        );
      } finally {
        setTargetAction("");
      }
    },
    [dispatch, freezeTarget, shouldShowLoadingState, t, targetAction]
  );

  const handleViewProduct = useCallback((product) => {
    setPreviewProduct(product || null);
  }, []);

  const closeProductPreview = useCallback(() => {
    setPreviewProduct(null);
  }, []);

  const getInlineSavingField = useCallback(
    (product) => {
      if (!product?.id || !savingInlineCell.startsWith(`${product.id}:`)) return "";
      return savingInlineCell.split(":")[1] || "";
    },
    [savingInlineCell]
  );

  const handleDuplicateProduct = useCallback(
    (product) => freezeProductCommand(product, "duplicate_product"),
    [freezeProductCommand]
  );

  const handleArchiveProduct = useCallback(
    (product) => handleInlineSave(product, "status", "ARCHIVED"),
    [handleInlineSave]
  );

  const handleDeleteProduct = useCallback(
    (product) => freezeProductCommand(product, "delete_product"),
    [freezeProductCommand]
  );

  const formatMetric = useCallback(
    (value) => Number(value || 0).toLocaleString(i18n.language),
    [i18n.language]
  );

  const bulkEditTargetCount =
    selection.selectedCount > 0
      ? selection.selectedCount
      : targetPreview?.total ?? totalCount;
  const bulkEditTargetLabel = formatMetric(bulkEditTargetCount);
  const hasSelection = selection.selectedCount > 0;
  const targetActionDisabled =
    Boolean(targetAction) || shouldShowLoadingState || totalCount <= 0;

  const pagePrimaryAction = hasSelection
    ? undefined
    : {
        content: t("editProducts", { defaultValue: "Edit products" }),
        accessibilityLabel: t("editMatchingProductsAccessibilityLabel", {
          defaultValue: "Edit matching products",
        }),
        onAction: openBulkEditConfirm,
        loading: targetAction === "edit",
        disabled: targetActionDisabled,
      };

  const pageSecondaryActions = hasSelection
    ? []
    : [
        {
          content: t("export", { defaultValue: "Export" }),
          accessibilityLabel: t("exportMatchingProductsAccessibilityLabel", {
            defaultValue: "Export matching products",
          }),
          onAction: handleBulkExport,
          loading: targetAction === "export",
          disabled: targetActionDisabled,
        },
        {
          content: t("moreActions", { defaultValue: "More actions" }),
          icon: MenuHorizontalIcon,
          accessibilityLabel: t("moreProductActionsAccessibilityLabel", {
            defaultValue: "More product actions",
          }),
          disabled: true,
        },
      ];

  return (
    <Page
      title={t("pageTitle")}
      subtitle={t("pageSubtitle")}
      fullWidth
      primaryAction={pagePrimaryAction}
      secondaryActions={pageSecondaryActions}
    >
      <Layout>
        <SyncBannerSection
          showSyncBanner={showSyncBanner}
          syncBannerView={syncBannerView}
          syncState={syncState}
          runSync={runSync}
          syncActionLoading={syncActionLoading}
          t={t}
        />

        {/* Sync just completed — dismissible success */}
        <ProductNotificationsSection
          syncCompleted={syncCompleted}
          targetActionError={targetActionError}
          selectionCommandNotice={selectionCommandNotice}
          segmentNotice={segmentNotice}
          dismissSyncCompleted={dismissSyncCompleted}
          dismissTargetActionError={dismissTargetActionError}
          dismissSelectionCommandNotice={dismissSelectionCommandNotice}
          dismissSegmentNotice={dismissSegmentNotice}
          t={t}
        />

        <ProductTrustStateBanner t={t} trustMetadata={trustMetadata} />

        {/* Undo bar for last action */}
        {lastAction ? (
          <Layout.Section>
            <ProductsUndoBar
              count={
                lastAction.targetSnapshotCount ||
                lastAction.totalItems ||
                lastAction.processedCount ||
                0
              }
              progressPercent={
                typeof lastAction?.progressSummary?.percent === "number"
                  ? lastAction.progressSummary.percent
                  : null
              }
              progressStatus={lastAction?.status || null}
              telemetry={lastAction?.telemetry || null}
              canUndo={canUndoLastAction(lastAction)}
              undoing={undoingLastAction}
              onUndo={handleUndoLastAction}
              onViewChanges={handleViewLastActionChanges}
            />
          </Layout.Section>
        ) : null}

        <SummarySection
          selectedCount={selection.selectedCount}
          totalCount={targetPreview?.total ?? totalCount}
          loading={targetPreviewLoading || shouldShowLoadingState}
          queryCost={queryCost}
          streamingState={streamingState}
        />

        {/* Out-of-stock smart suggestion */}
        {hasOutOfStockActiveFilter ? (
          <Layout.Section>
            <Banner
              tone="info"
              title={t("smartDefaultsInventoryTitle", {
                defaultValue: "Smart defaults for out-of-stock products",
              })}
            >
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <BlockStack gap="100">
                  <Text as="p">
                    {t("smartDefaultsInventoryText", {
                      defaultValue:
                        "inventory = 0 often means these products should stop selling.",
                    })}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("smartDefaultsInventorySuggestions", {
                      defaultValue:
                        "Suggested: set status to Draft, then review online store visibility.",
                    })}
                  </Text>
                </BlockStack>
                <InlineStack gap="200">
                  <Button
                    onClick={handleSuggestedDraftOutOfStock}
                    loading={targetAction === "edit"}
                    disabled={targetActionDisabled}
                  >
                    {t("smartDefaultSetDraft", { defaultValue: "Set status to Draft" })}
                  </Button>
                  <Button disabled>
                    {t("smartDefaultHideOnlineStore", {
                      defaultValue: "Hide from online store",
                    })}
                  </Button>
                </InlineStack>
              </InlineStack>
            </Banner>
          </Layout.Section>
        ) : null}

        <ProductSelectionActionsSection
          hasSelection={hasSelection}
          selection={selection}
          totalCount={totalCount}
          targetAction={targetAction}
          onEdit={openBulkEditConfirm}
          onExport={handleBulkExport}
          onViewSelection={handleViewSelection}
          onNarrowSelection={handleNarrowSelection}
          onSaveSegment={handleSaveSelectionSegment}
        />

        <ProductMainCard
          t={t}
          search={search}
          handleSearchChange={handleSearchChange}
          handleSearchClear={handleSearchClear}
          inventoryLocationId={inventoryLocationId}
          setInventoryLocationId={setInventoryLocationId}
          appliedFilters={appliedFilters}
          facetStats={facetStats}
          onFilterChange={onFilterChange}
          onClearAll={onClearAll}
          hasActiveSegmentCriteria={hasActiveSegmentCriteria}
          segmentName={segmentName}
          setSegmentName={setSegmentName}
          handleSaveCurrentSegment={handleSaveCurrentSegment}
          selectedView={selectedView}
          presetViews={presetViews}
          savedSegments={savedSegments}
          handleSavedViewSelect={handleSavedViewSelect}
          products={products}
          shouldShowLoadingState={shouldShowLoadingState}
          error={error}
          handleRetryProducts={handleRetryProducts}
          selection={selection}
          handleViewProduct={handleViewProduct}
          handleEditProduct={handleEditProduct}
          handleDuplicateProduct={handleDuplicateProduct}
          handleArchiveProduct={handleArchiveProduct}
          handleDeleteProduct={handleDeleteProduct}
          handleInlineSave={handleInlineSave}
          savingInlineCell={savingInlineCell}
          pagination={pagination}
          lastFetchedAt={lastFetchedAt}
          handleNextPage={handleNextPage}
          handlePreviousPage={handlePreviousPage}
        />

        {/* Sticky bulk action bar */}
        {hasSelection ? (
          <Layout.Section>
            <StickyBulkActionBar
              selectedCount={selection.selectedCount}
              targetAction={targetAction}
              canUndo={canUndoLastAction(lastAction)}
              undoing={undoingLastAction}
              onEditFields={openBulkEditConfirm}
              onAddTags={handleAddTags}
              onExport={handleBulkExport}
              onClearSelection={selection.clearSelection}
              onUndo={handleUndoLastAction}
            />
          </Layout.Section>
        ) : null}
      </Layout>

      <ProductBulkEditConfirmModal
        open={showBulkEditConfirm}
        onClose={closeBulkEditConfirm}
        onConfirm={confirmBulkEdit}
        targetAction={targetAction}
        t={t}
        selection={selection}
        bulkEditTargetCount={bulkEditTargetCount}
        bulkEditTargetLabel={bulkEditTargetLabel}
      />

     
    </Page>
  );
}
