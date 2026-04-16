import {
  Page,
  Text,
  Banner,
  Card,
  Button,
  InlineStack,
  Layout,
  Box,
  BlockStack,
  SkeletonBodyText,
  Badge,
} from "@shopify/polaris";
import { useMemo, useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "i18next";

import ProductsFilters from "../components/ProductsFilters";
import ProductsTable from "../components/ProductsTable";
import useProducts from "../hooks/useProducts";
import { getFilterByKey } from "../constants";

import {
  selectProducts,
  selectFilters,
  selectSearch,
  selectProductCount,
  selectPagination,
  selectPage,
  selectSetFilters,
  selectSetSearch,
  selectClearFilters,
  useProductStore,
} from "../../../../store/productStore";

function normalizeMirrorNotReadySyncStatus(result) {
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

function isSyncRunning(syncStatus) {
  if (!syncStatus) return false;

  return (
    syncStatus?.isProductSyncing === true ||
    syncStatus?.isProductInitialySyning === true ||
    syncStatus?.syncProgressStage === "SHOPIFY_BULK_RUNNING" ||
    syncStatus?.syncProgressStage === "MIRROR_STAGING"
  );
}

export default function ProductsPage() {
  const navigate = useNavigate();

  const products = useProductStore(selectProducts);
  const filterState = useProductStore(selectFilters);
  const totalCount = useProductStore(selectProductCount);
  const pagination = useProductStore(selectPagination);
  const page = useProductStore(selectPage);
  const search = useProductStore(selectSearch);
  const setFilters = useProductStore(selectSetFilters);
  const setSearch = useProductStore(selectSetSearch);
  const clearFilters = useProductStore(selectClearFilters);

  const {
    loading,
    error,
    errorCode,
    hasFetched,
    mirrorNotReady,
    fetchProducts,
  } = useProducts();

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);
  const [syncCompleted, setSyncCompleted] = useState(false);
  const [syncStatusError, setSyncStatusError] = useState(null);
  const wasSyncingRef = useRef(false);

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
        return result.syncStatus;
      }

      if (response.status === 409 && result?.error === "MIRROR_NOT_READY") {
        const normalized = normalizeMirrorNotReadySyncStatus(result);
        setSyncStatus(normalized);
        return normalized;
      }

      throw new Error(result?.message || "Failed to load sync status");
    } catch (err) {
      setSyncStatusError(err?.message || "Failed to load sync status");
      return null;
    } finally {
      setSyncStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const currentFilters = useProductStore.getState().filters;

      if (!search) {
        setFilters(currentFilters.filter((f) => f.field !== "search"));
        return;
      }

      setFilters([
        ...currentFilters.filter((f) => f.field !== "search"),
        {
          field: "search",
          operator: "contains",
          value: search,
        },
      ]);
    }, 500);

    return () => clearTimeout(timer);
  }, [search, setFilters]);

  useEffect(() => {
    if (syncStatus?.mirrorReady !== true) {
      return;
    }

    fetchProducts(1, filterState);
  }, [filterState, fetchProducts, syncStatus?.mirrorReady]);

  useEffect(() => {
    fetchSyncStatus();
  }, [fetchSyncStatus]);

  useEffect(() => {
    if (!isSyncRunning(syncStatus)) {
      return undefined;
    }

    const interval = setInterval(fetchSyncStatus, 4000);
    return () => clearInterval(interval);
  }, [syncStatus, fetchSyncStatus]);

  useEffect(() => {
    const currentlySyncing = isSyncRunning(syncStatus);

    if (wasSyncingRef.current && !currentlySyncing && syncStatus?.mirrorReady !== false) {
      setSyncCompleted(true);
      fetchProducts(1, useProductStore.getState().filters);
    }

    wasSyncingRef.current = Boolean(currentlySyncing);
  }, [syncStatus, fetchProducts]);

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

      setFilters(updated);
    },
    [filterState, setFilters],
  );

  const onClearAll = useCallback(() => {
    clearFilters();

    if (syncStatus?.mirrorReady === true) {
      fetchProducts(1, []);
    }
  }, [clearFilters, fetchProducts, syncStatus?.mirrorReady]);

  const appliedFilters = useMemo(
    () =>
      filterState
        .filter((f) => f.field !== "search")
        .map(({ field, operator, value }) => {
          const filter = getFilterByKey(field);

          return {
            key: field,
            label: `${filter?.label || field} ${operator} ${value}`,
            onRemove: () =>
              setFilters(filterState.filter((f) => f.field !== field)),
          };
        }),
    [filterState, setFilters],
  );

  const handleNextPage = useCallback(() => {
    if (syncStatus?.mirrorReady !== true) {
      return;
    }

    fetchProducts(page + 1, filterState);
  }, [fetchProducts, filterState, page, syncStatus?.mirrorReady]);

  const handlePreviousPage = useCallback(() => {
    if (syncStatus?.mirrorReady !== true) {
      return;
    }

    fetchProducts(page - 1, filterState);
  }, [fetchProducts, filterState, page, syncStatus?.mirrorReady]);

  const isSyncInProgress = isSyncRunning(syncStatus);
  const hasAnyProducts = products.length > 0;
  const syncMirrorNotReady = syncStatus?.mirrorNotReady === true;

  const neverSynced =
    syncStatus &&
    syncMirrorNotReady &&
    !isSyncInProgress;

  const shouldShowLoadingState =
    loading ||
    (syncStatusLoading && !syncStatus) ||
    (!hasFetched && syncStatus?.mirrorReady === true) ||
    (!hasAnyProducts && (syncStatusLoading || isSyncInProgress));

  const shouldShowEmptyState =
    !shouldShowLoadingState &&
    !error &&
    !mirrorNotReady &&
    !syncMirrorNotReady &&
    hasFetched &&
    !isSyncInProgress &&
    totalCount === 0;

  const shouldSuppressCriticalError =
    mirrorNotReady ||
    syncMirrorNotReady ||
    isSyncInProgress ||
    errorCode === "MIRROR_NOT_READY" ||
    (errorCode === "PRODUCT_LIST_FAILED" && syncMirrorNotReady);

  const resultSummary = useMemo(() => {
    if (shouldShowLoadingState) {
      return <SkeletonBodyText lines={1} />;
    }

    if (totalCount > 0) {
      return (
        <InlineStack gap="200" blockAlign="center">
          <Badge tone="info">{totalCount}</Badge>
          <Text variant="bodySm" tone="subdued">
            {t("productsMatch")}
          </Text>
        </InlineStack>
      );
    }

    if (shouldShowEmptyState) {
      return (
        <Text variant="bodySm" tone="subdued">
          {t("noProductsMatch")}
        </Text>
      );
    }

    if (isSyncInProgress) {
      return (
        <Text variant="bodySm" tone="subdued">
          Products are syncing in the background.
        </Text>
      );
    }

    if (mirrorNotReady || syncMirrorNotReady || neverSynced) {
      return (
        <Text variant="bodySm" tone="subdued">
          Product mirror is not ready yet.
        </Text>
      );
    }

    return null;
  }, [
    shouldShowLoadingState,
    totalCount,
    shouldShowEmptyState,
    isSyncInProgress,
    mirrorNotReady,
    syncMirrorNotReady,
    neverSynced,
  ]);

  return (
    <Page
      title={t("pageTitle")}
      subtitle={t("pageSubtitle")}
      fullWidth
      primaryAction={{
        content: t("edit"),
        onAction: () => navigate("/edit"),
      }}
      secondaryActions={[
        {
          content: t("export"),
          onAction: () => navigate("/exportdata"),
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="500">
              <InlineStack
                align="space-between"
                blockAlign="center"
                gap="300"
                wrap
              >
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    {t("productTargeting")}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {t("productTargetingDescription")}
                  </Text>
                </BlockStack>

                <InlineStack gap="200" blockAlign="center">
                  {resultSummary}
                  <Button variant="plain" onClick={() => navigate("/refresh")}>
                    {t("Syncyourproducts")}
                  </Button>
                </InlineStack>
              </InlineStack>
            </Box>
          </Card>
        </Layout.Section>

        {syncCompleted && (
          <Layout.Section>
            <Banner
              tone="success"
              title="Sync complete"
              onDismiss={() => setSyncCompleted(false)}
            >
              <p>Products have been synced successfully.</p>
            </Banner>
          </Layout.Section>
        )}

        {(mirrorNotReady || syncMirrorNotReady || neverSynced) &&
          !isSyncInProgress &&
          !hasAnyProducts && (
            <Layout.Section>
              <Banner tone="info" title="Product sync required">
                <p>
                  Your product mirror is not ready yet. Start a sync to load
                  products, counts, filters, and targeting results.
                </p>
              </Banner>
            </Layout.Section>
          )}

        {syncStatusError && !isSyncInProgress && (
          <Layout.Section>
            <Banner tone="warning" title="Sync status unavailable">
              <Text>{syncStatusError}</Text>
            </Banner>
          </Layout.Section>
        )}

        {error && !shouldSuppressCriticalError && (
          <Layout.Section>
            <Banner tone="critical" title="Error loading products">
              <Text>{error}</Text>
            </Banner>
          </Layout.Section>
        )}

        {isSyncInProgress && !hasAnyProducts && (
          <Layout.Section>
            <Banner tone="info" title="Sync in progress">
              <p>
                Products are still syncing. Counts and rows will fill in
                automatically as the mirror updates.
              </p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <Box padding="400">
              <ProductsFilters
                queryValue={search}
                appliedFilters={appliedFilters}
                filterState={filterState}
                onFilterChange={onFilterChange}
                onQueryChange={setSearch}
                onQueryClear={onClearAll}
                onClearAll={onClearAll}
              />
            </Box>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            <ProductsTable
              products={products}
              loading={shouldShowLoadingState}
              pagination={pagination}
              onNext={handleNextPage}
              onPrev={handlePreviousPage}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
