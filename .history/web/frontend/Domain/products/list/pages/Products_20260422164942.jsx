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
import { useMemo, useEffect, useState, useCallback,useRef  } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import { t } from "i18next";
import { useTranslation } from "react-i18next";
import { getTranslatedOperatorLabel } from "../utils/filterUtils";
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
  setFilters,
  setSearch,
  clearFilters,
} from "../../../../store/slices/productSlice";

export default function ProductsPage() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const products = useSelector(selectProducts);
  const filterState = useSelector(selectFilters);
  const totalCount = useSelector(selectProductCount);
  const pagination = useSelector(selectPagination);
  const page = useSelector(selectPage);
  const search = useSelector(selectSearch);
const { t } = useTranslation();

  const { loading, error, hasFetched, fetchProducts } = useProducts();

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(true);

   const [syncCompleted, setSyncCompleted] = useState(false);
   const wasSyncingRef = useRef(false);


  const fetchSyncStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/sync/sync-status");
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
  }, []);

const effectiveFilters = useMemo(() => {
  const baseFilters = filterState.filter((f) => f.field !== "search");

  if (!search?.trim()) {
    return baseFilters;
  }

  return [
    ...baseFilters,
    {
      field: "search",
      operator: "contains",
      value: search.trim(),
    },
  ];
}, [filterState, search]);

useEffect(() => {
  fetchProducts(1, effectiveFilters);
}, [effectiveFilters, fetchProducts]);

 useEffect(() => {
  fetchSyncStatus().then((status) => {
    const neverSynced =
      !status?.shopifyBulkJobCompleted &&
      !status?.isProductSyncing &&
      !status?.isProductInitialySyning;
    if (neverSynced) {
      fetch("/api/sync/products").catch(() => {});
    }
  });
}, []);

  useEffect(() => {
    const isSyncRunning =
      syncStatus?.isProductSyncing || syncStatus?.isProductInitialySyning;

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
    fetchProducts(1, effectiveFilters);
  }

  wasSyncingRef.current = isSyncing;
}, [
  syncStatus?.isProductSyncing,
  syncStatus?.isProductInitialySyning,
  syncStatus?.shopifyBulkJobCompleted,
  syncStatus?.activeMirrorBatchId,
  fetchProducts,
  filterState,
]);

  const onFilterChange = useCallback((field, nextFilter) => {
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
}, [filterState, dispatch]);

  const onClearAll = () => {
    dispatch(clearFilters());
    fetchProducts(1, []);
  };

const appliedFilters = useMemo(
  () =>
    filterState
      .filter((f) => f.field !== "search")
      .map(({ field, operator, value }) => {
        const filter = getFilterByKey(field);

        const translatedFieldLabel = t(
          `fieldLabels.${field}`,
          filter?.label || field
        );

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

  const isSyncInProgress =
    Boolean(syncStatus?.isProductSyncing) ||
    Boolean(syncStatus?.isProductInitialySyning);

  const shouldShowLoadingState =
    loading ||
    !hasFetched ||
    (!products.length && (syncStatusLoading || isSyncInProgress));

  const shouldShowEmptyState =
    !shouldShowLoadingState &&
    !error &&
    hasFetched &&
    !isSyncInProgress &&
    totalCount === 0;

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

    return null;
  }, [isSyncInProgress, shouldShowEmptyState, shouldShowLoadingState, totalCount]);

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
              <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
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
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Error loading products">
              <Text>{error}</Text>
            </Banner>
          </Layout.Section>
        )}

        {isSyncInProgress && !products.length && (
          <Layout.Section>
            <Banner tone="info" title="Sync in progress">
              <p>Products are still syncing. Counts and rows will fill in automatically as the mirror updates.</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Card>
            <Box padding="400">
              <ProductsFilters
                queryValue={search}
                appliedFilters={appliedFilters}
                onFilterChange={onFilterChange}
                onQueryChange={(value) => dispatch(setSearch(value))}
                onQueryClear={() => dispatch(setSearch(""))}
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
              onNext={() => fetchProducts(page + 1, effectiveFilters)}
              onPrev={() => fetchProducts(page - 1, effectiveFilters)}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}