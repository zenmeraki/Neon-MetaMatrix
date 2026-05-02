import {
  Page,
  Text,
  TextField,
  Banner,
  Card,
  Button,
  List,
  InlineStack,
  Layout,
  Modal,
  Box,
  BlockStack,
} from "@shopify/polaris";
import { MenuHorizontalIcon } from "@shopify/polaris-icons";
import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { useTranslation } from "react-i18next";
import { getTranslatedOperatorLabel } from "../utils/filterUtils";
import ProductsFiltersBar from "../components/ProductsFiltersBar";
import ProductsIndexTable from "../components/ProductsIndexTable";
import ProductsPaginationFooter from "../components/ProductsPaginationFooter";
import ProductsSavedViews from "../components/ProductsSavedViews";
import ProductsSearchBar from "../components/ProductsSearchBar";
import ProductsSummaryStrip from "../components/ProductsSummaryStrip";
import ProductsUndoBar from "../components/ProductsUndoBar";
import SelectionCommandBar from "../components/SelectionCommandBar";
import StickyBulkActionBar from "../components/StickyBulkActionBar";
import useProducts from "../hooks/useProducts";
import { useBulkTargetSelection } from "../hooks/useBulkTargetSelection";
import { getFilterByKey } from "../constants";
import { useAuthenticatedFetch } from "../../../../hooks/useAuthenticatedFetch";

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

const PRODUCT_SORT_KEY = "TITLE";
const PRODUCT_SORT_ORDER = "asc";
const PRODUCT_LIST_SORT = {
  sortKey: PRODUCT_SORT_KEY,
  sortOrder: PRODUCT_SORT_ORDER,
};
const SAVED_SEGMENTS_STORAGE_KEY = "metamatrix:saved-product-segments";

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

function getInlineInventoryLocationId(product) {
  return (
    product?.locationId ||
    product?.inventoryLocationId ||
    product?.defaultLocationId ||
    product?.primaryLocationId ||
    product?.variants?.[0]?.locationId ||
    product?.variants?.[0]?.inventoryLocationId ||
    null
  );
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

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);
  const [syncActionLoading, setSyncActionLoading] = useState(false);
  const [targetAction, setTargetAction] = useState("");
  const [targetActionError, setTargetActionError] = useState("");
  const [showBulkEditConfirm, setShowBulkEditConfirm] = useState(false);
  const [targetPreview, setTargetPreview] = useState(null);
  const [targetPreviewLoading, setTargetPreviewLoading] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [undoingLastAction, setUndoingLastAction] = useState(false);
  const [selectedView, setSelectedView] = useState(0);
  const [selectionCommandNotice, setSelectionCommandNotice] = useState("");
  const [savingInlineCell, setSavingInlineCell] = useState("");
  const [previewProduct, setPreviewProduct] = useState(null);
  const [savedSegments, setSavedSegments] = useState([]);
  const [segmentName, setSegmentName] = useState("");
  const [segmentNotice, setSegmentNotice] = useState("");
  const [statusFacetBaseline, setStatusFacetBaseline] = useState(null);
  const [syncCompleted, setSyncCompleted] = useState(false);

  const wasSyncingRef = useRef(false);
  const previousQuerySignatureRef = useRef("");

  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetchWithAuth("/api/sync/sync-status");
      const result = await response.json();

      if (response.ok && result?.syncStatus) {
        setSyncStatus(result.syncStatus);
        return result.syncStatus;
      }
    } catch {
      // Keep the page usable if the sync-status call fails.
    } finally {
      setSyncStatusLoading(false);
    }
  }, [fetchWithAuth]);

  const fetchLastAction = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: "1",
        lang: i18n.language || "en",
      });
      const response = await fetchWithAuth(
        `/api/history/get-shop-edithistory?${params.toString()}`,
        { method: "GET", headers: { Accept: "application/json" } }
      );
      const result = await response.json();

      if (response.ok && Array.isArray(result?.data)) {
        setLastAction(result.data[0] || null);
      }
    } catch {
      setLastAction(null);
    }
  }, [fetchWithAuth, i18n.language]);

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
    try {
      const raw = window.localStorage.getItem(SAVED_SEGMENTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setSavedSegments(Array.isArray(parsed) ? parsed : []);
    } catch {
      setSavedSegments([]);
    }
  }, []);

  useEffect(() => {
    if (!hasActiveSegmentCriteria) {
      setSegmentName("");
      return;
    }

    setSegmentName(
      buildSegmentName({ filters: effectiveFilters, search, t })
    );
  }, [effectiveFilters, hasActiveSegmentCriteria, search, t]);

  useEffect(() => {
    if (hasActiveSegmentCriteria || !products.length || totalCount <= 0) return;

    setStatusFacetBaseline(
      estimateStatusFacets({ products, total: totalCount, language: i18n.language })
    );
  }, [hasActiveSegmentCriteria, i18n.language, products, totalCount]);

  const querySignature = useMemo(
    () =>
      JSON.stringify({
        search: search?.trim() || "",
        filters: effectiveFilters,
        sort: null,
      }),
    [effectiveFilters, search]
  );

  useEffect(() => {
    fetchProducts(1, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts]);

  useEffect(() => {
    fetchLastAction();
  }, [fetchLastAction]);

  useEffect(() => {
    let cancelled = false;

    const fetchTargetPreview = async () => {
      setTargetPreviewLoading(true);

      try {
        const response = await fetchWithAuth("/api/products/targets/count", {
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

        if (!cancelled && response.ok) setTargetPreview(result);
      } catch {
        if (!cancelled) setTargetPreview(null);
      } finally {
        if (!cancelled) setTargetPreviewLoading(false);
      }
    };

    fetchTargetPreview();
    return () => { cancelled = true; };
  }, [effectiveFilters, fetchWithAuth, querySignature, search]);

  useEffect(() => {
    const run = async () => {
      try {
        const status = await fetchSyncStatus();
        const neverSynced =
          !status?.shopifyBulkJobCompleted &&
          !status?.isProductSyncing &&
          !status?.isProductInitialySyning;

        if (neverSynced) await fetchWithAuth("/api/sync/products");
      } catch (e) {
        console.error("AUTO SYNC FAILED", e);
      }
    };

    run();
  }, [fetchSyncStatus, fetchWithAuth]);

  useEffect(() => {
    const isSyncRunning =
      syncStatus?.isProductSyncing || syncStatus?.isProductInitialySyning;

    if (!isSyncRunning) return undefined;

    const interval = setInterval(fetchSyncStatus, 4000);
    return () => clearInterval(interval);
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
      fetchProducts(1, effectiveFilters, PRODUCT_LIST_SORT);
    }

    wasSyncingRef.current = isSyncing;
  }, [
    syncStatus?.isProductSyncing,
    syncStatus?.isProductInitialySyning,
    syncStatus?.shopifyBulkJobCompleted,
    syncStatus?.activeMirrorBatchId,
    fetchProducts,
    effectiveFilters,
  ]);

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
    [filterState, dispatch]
  );

  const onClearAll = useCallback(() => {
    dispatch(clearFilters());
    fetchProducts(1, [], PRODUCT_LIST_SORT);
    setSelectedView(0);
  }, [dispatch, fetchProducts]);

  const persistSavedSegments = useCallback((segments) => {
    setSavedSegments(segments);
    window.localStorage.setItem(
      SAVED_SEGMENTS_STORAGE_KEY,
      JSON.stringify(segments)
    );
  }, []);

  const handleSaveCurrentSegment = useCallback(() => {
    const name = segmentName.trim();
    if (!name || !hasActiveSegmentCriteria) return;

    const nextSegment = {
      id: `segment-${Date.now()}`,
      name,
      filters: filterState.filter((filter) => filter.field !== "search"),
      search: search?.trim() || "",
      createdAt: new Date().toISOString(),
      destinations: ["bulk_edit", "export", "scheduled_rule", "automatic_rule"],
    };
    const nextSegments = [
      nextSegment,
      ...savedSegments.filter(
        (segment) => segment.name.toLowerCase() !== name.toLowerCase()
      ),
    ].slice(0, 10);

    persistSavedSegments(nextSegments);
    setSelectedView(1);
    setSegmentNotice(
      t("segmentSavedNotice", {
        name,
        defaultValue: `"${name}" saved for bulk edit, export, scheduled rules, and automatic rules.`,
      })
    );
  }, [filterState, hasActiveSegmentCriteria, persistSavedSegments, savedSegments, search, segmentName, t]);

  const handleSavedViewSelect = useCallback(
    (index) => {
      setSelectedView(index);

      if (index === 0) {
        dispatch(clearFilters());
        dispatch(setSearch(""));
        return;
      }

      const segment = savedSegments[index - 1];
      if (!segment) return;

      dispatch(setFilters(segment.filters || []));
      dispatch(setSearch(segment.search || ""));
      setSegmentName(segment.name || "");
      setSegmentNotice(
        t("segmentAppliedNotice", {
          name: segment.name,
          defaultValue: `"${segment.name}" applied.`,
        })
      );
    },
    [dispatch, savedSegments, t]
  );

  const handleSearchChange = useCallback(
    (value) => {
      dispatch(setSearch(value));
      setSelectedView(0);
    },
    [dispatch]
  );

  const handleSearchClear = useCallback(() => {
    dispatch(setSearch(""));
    setSelectedView(0);
  }, [dispatch]);

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

  useEffect(() => {
    if (previousQuerySignatureRef.current === querySignature) return;

    previousQuerySignatureRef.current = querySignature;
    selection.clearSelection();
  }, [querySignature, selection.clearSelection]);

  const handleRetryProducts = useCallback(() => {
    fetchProducts(page, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts, page]);

  const handleNextPage = useCallback(() => {
    fetchProducts(page + 1, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts, page]);

  const handlePreviousPage = useCallback(() => {
    fetchProducts(page - 1, effectiveFilters, PRODUCT_LIST_SORT);
  }, [effectiveFilters, fetchProducts, page]);

  const isSyncInProgress =
    Boolean(syncStatus?.isProductSyncing) ||
    Boolean(syncStatus?.isProductInitialySyning);

  const syncState = getSyncState({ syncStatus, loading: syncStatusLoading });
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

  const runSync = useCallback(async () => {
    if (syncActionLoading) return;

    setSyncActionLoading(true);

    try {
      await fetchWithAuth("/api/sync/products");
      await fetchSyncStatus();
    } finally {
      setSyncActionLoading(false);
    }
  }, [fetchSyncStatus, fetchWithAuth, syncActionLoading]);

  const shouldShowLoadingState =
    loading ||
    !hasFetched ||
    (!products.length && (syncStatusLoading || isSyncInProgress));

  const freezeTarget = useCallback(
    async (overridePayload) => {
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

      const response = await fetchWithAuth("/api/products/targets/freeze", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (!response.ok || !result?.targetSnapshotId) {
        throw new Error(result?.message || result?.error || "TARGET_FREEZE_FAILED");
      }

      return { ...result, payload };
    },
    [effectiveFilters, fetchWithAuth, querySignature, search, selection]
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

  const handleSuggestedDraftOutOfStock = useCallback(async () => {
    if (targetAction || shouldShowLoadingState || totalCount <= 0) return;

    setTargetAction("edit");
    setTargetActionError("");

    try {
      const frozenTarget = await freezeTarget();
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
      const frozenTarget = await freezeTarget();
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
      const response = await fetchWithAuth(
        `/api/products/undo-edit/${lastAction.id}`,
        { method: "PUT", headers: { "Content-Type": "application/json" } }
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
  }, [fetchWithAuth, lastAction]);

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
      const frozenTarget = await freezeTarget();
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
        const frozenTarget = await freezeTarget();
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
        });
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

      const locationId =
        field === "inventory" ? getInlineInventoryLocationId(product) : null;

      if (field === "inventory" && !locationId) {
        setTargetActionError(
          t("inventoryInlineEditRequiresLocation", {
            defaultValue:
              "Inventory edits require a location. Use Edit fields to choose the inventory location before applying changes.",
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
        const frozenTarget = await freezeTarget({ mode: "ids", ids: [productId] });

        const response = await fetchWithAuth(
          `/api/products/update?lang=${encodeURIComponent(i18n.language || "en")}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              editedField: field,
              editedType,
              value,
              filterParams: [],
              targetSnapshotId: frozenTarget.targetSnapshotId,
              ...(locationId ? { locationId } : {}),
            }),
          }
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
    [effectiveFilters, fetchLastAction, fetchProducts, fetchWithAuth, freezeTarget, i18n.language, page, savingInlineCell, t]
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
        });

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
        {/* Sync status — only shown for actionable states, not "ready" */}
        {showSyncBanner && syncBannerView ? (
          <Layout.Section>
            <Banner tone={syncBannerView.tone}>
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                <Text as="p">{syncBannerView.message}</Text>
                <InlineStack gap="200">
                  {syncState === "stale" ? (
                    <Button
                      onClick={runSync}
                      loading={syncActionLoading}
                      disabled={syncActionLoading}
                      accessibilityLabel={t("syncNowAccessibilityLabel", {
                        defaultValue: "Sync catalog now",
                      })}
                    >
                      {t("refreshCatalog", { defaultValue: "Refresh catalog" })}
                    </Button>
                  ) : null}

                  {syncState === "failed" ? (
                    <Button
                      onClick={runSync}
                      loading={syncActionLoading}
                      disabled={syncActionLoading}
                      accessibilityLabel={t("retrySyncAccessibilityLabel", {
                        defaultValue: "Retry catalog sync",
                      })}
                    >
                      {t("retry", { defaultValue: "Retry" })}
                    </Button>
                  ) : null}
                </InlineStack>
              </InlineStack>
            </Banner>
          </Layout.Section>
        ) : null}

        {/* Sync just completed — dismissible success */}
        {syncCompleted ? (
          <Layout.Section>
            <Banner
              tone="success"
              title={t("syncComplete", { defaultValue: "Sync complete" })}
              onDismiss={() => setSyncCompleted(false)}
            >
              <Text as="p">
                {t("productsSyncCompletedMessage", {
                  defaultValue: "Products have been synced successfully.",
                })}
              </Text>
            </Banner>
          </Layout.Section>
        ) : null}

        {/* Target action error */}
        {targetActionError ? (
          <Layout.Section>
            <Banner
              tone="critical"
              title={t("targetFreezeFailed", {
                defaultValue: "Could not prepare product target",
              })}
              onDismiss={() => setTargetActionError("")}
            >
              <Text as="p">{targetActionError}</Text>
            </Banner>
          </Layout.Section>
        ) : null}

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
              canUndo={canUndoLastAction(lastAction)}
              undoing={undoingLastAction}
              onUndo={handleUndoLastAction}
              onViewChanges={handleViewLastActionChanges}
            />
          </Layout.Section>
        ) : null}

        {/* Summary strip */}
        <Layout.Section>
          <ProductsSummaryStrip
            selectedCount={selection.selectedCount}
            totalCount={targetPreview?.total ?? totalCount}
            loading={targetPreviewLoading || shouldShowLoadingState}
            queryCost={queryCost}
            streamingState={streamingState}
          />
        </Layout.Section>

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

        {/* Selection command bar (sticky) */}
        {hasSelection ? (
          <Layout.Section>
            <Box position="sticky" insetBlockStart="0" zIndex="1">
              <SelectionCommandBar
                selection={selection}
                totalCount={totalCount}
                targetAction={targetAction}
                onEdit={openBulkEditConfirm}
                onExport={handleBulkExport}
                onViewSelection={handleViewSelection}
                onNarrowSelection={handleNarrowSelection}
                onSaveSegment={handleSaveSelectionSegment}
              />
            </Box>
          </Layout.Section>
        ) : null}

        {/* Selection command notice */}
        {selectionCommandNotice ? (
          <Layout.Section>
            <Banner tone="success" onDismiss={() => setSelectionCommandNotice("")}>
              <Text as="p">{selectionCommandNotice}</Text>
            </Banner>
          </Layout.Section>
        ) : null}

        {/* Main product card */}
        <Layout.Section>
          <Card padding="0" roundedAbove="sm">
            <ProductsSavedViews
              selected={selectedView}
              savedSegments={savedSegments}
              onSelect={handleSavedViewSelect}
            />

            <Box
              paddingBlock="300"
              paddingInline="400"
              borderBlockStartWidth="025"
              borderColor="border"
            >
              <ProductsSearchBar
                value={search}
                onSubmit={handleSearchChange}
                onClear={handleSearchClear}
              />
            </Box>

            <Box
              paddingBlock="300"
              paddingInline="400"
              borderBlockEndWidth="025"
              borderColor="border"
            >
              <ProductsFiltersBar
                appliedFilters={appliedFilters}
                facetStats={facetStats}
                onFilterChange={onFilterChange}
                onClearAll={onClearAll}
              />
            </Box>

            {hasActiveSegmentCriteria ? (
              <Box
                paddingBlock="300"
                paddingInline="400"
                borderBlockEndWidth="025"
                borderColor="border"
              >
                <InlineStack align="space-between" blockAlign="end" gap="300">
                  <Box minWidth="320px">
                    <TextField
                      label={t("saveSegmentAsLabel", { defaultValue: "Save this as" })}
                      value={segmentName}
                      onChange={setSegmentName}
                      autoComplete="off"
                    />
                  </Box>
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      {t("savedSegmentReuseHint", {
                        defaultValue:
                          "Reuse in bulk edit, export, scheduled rule, and automatic rule.",
                      })}
                    </Text>
                    <Button
                      onClick={handleSaveCurrentSegment}
                      disabled={!segmentName.trim()}
                    >
                      {t("saveSegmentButton", { defaultValue: "Save segment" })}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Box>
            ) : null}

            {segmentNotice ? (
              <Box paddingBlock="300" paddingInline="400">
                <Banner tone="success" onDismiss={() => setSegmentNotice("")}>
                  <Text as="p">{segmentNotice}</Text>
                </Banner>
              </Box>
            ) : null}

            <Box borderBlockStartWidth="025" borderColor="border">
              <ProductsIndexTable
                products={products}
                loading={shouldShowLoadingState}
                error={error}
                onRetry={handleRetryProducts}
                onClearAll={onClearAll}
                selectedSet={selection.selectedSet}
                selectedCount={selection.selectedCount}
                allMatchingSelected={selection.mode === "query"}
                onToggleRow={selection.toggleRow}
                onTogglePage={selection.togglePage}
                onViewProduct={handleViewProduct}
                onEditProduct={handleEditProduct}
                onDuplicateProduct={handleDuplicateProduct}
                onArchiveProduct={handleArchiveProduct}
                onDeleteProduct={handleDeleteProduct}
                onPreviewProduct={handleViewProduct}
                onInlineSave={handleInlineSave}
                savingInlineCell={savingInlineCell}
              />
            </Box>

            <ProductsPaginationFooter
              products={products}
              pagination={pagination}
              lastUpdatedAt={lastFetchedAt}
              onNext={handleNextPage}
              onPrev={handlePreviousPage}
            />
          </Card>
        </Layout.Section>

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

      <Modal
        open={showBulkEditConfirm}
        onClose={closeBulkEditConfirm}
        title={t("confirmBulkEdit", { defaultValue: "Confirm bulk edit" })}
        primaryAction={{
          content: t("continue", { defaultValue: "Continue" }),
          onAction: confirmBulkEdit,
          loading: targetAction === "edit",
          disabled: Boolean(targetAction),
        }}
        secondaryActions={[
          {
            content: t("cancel", { defaultValue: "Cancel" }),
            onAction: closeBulkEditConfirm,
            disabled: Boolean(targetAction),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              {t("bulkEditConfirmIntro", {
                defaultValue: "You are about to edit:",
              })}
            </Text>

            <List>
              <List.Item>
                {t("bulkEditConfirmProducts", {
                  count: bulkEditTargetCount,
                  defaultValue: `${bulkEditTargetLabel} products`,
                })}
              </List.Item>
              <List.Item>
                {t("bulkEditConfirmFields", {
                  defaultValue: "Fields: choose in the next step",
                })}
              </List.Item>
            </List>

            <Banner tone="warning">
              <Text as="p">
                {selection.mode === "query"
                  ? t("bulkEditConfirmAllMatchingWarning", {
                      defaultValue: "Changes will apply to all matching products.",
                    })
                  : t("bulkEditConfirmSelectedWarning", {
                      defaultValue: "Changes will apply to selected products.",
                    })}
              </Text>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

     
    </Page>
  );
}