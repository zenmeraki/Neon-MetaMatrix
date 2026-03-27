// src/pages/ProductsPage.jsx

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
} from "@shopify/polaris";
import { useMemo, useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
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
    setFilters,
    setSearch,
    clearFilters,
} from "../../../../store/slices/productSlice";

export default function ProductsPage() {
    const dispatch = useDispatch();
    const navigate = useNavigate();

    /* ===============================
       Redux state
    ================================ */
    const products = useSelector(selectProducts);
    const filterState = useSelector(selectFilters);
    const totalCount = useSelector(selectProductCount);
    const pagination = useSelector(selectPagination);
    const page = useSelector(selectPage);
    const search = useSelector(selectSearch);


    /* ===============================
       API hook
    ================================ */
    const {
        loading,
        error,
        hasFetched,
        fetchProducts,
    } = useProducts();

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
            // Keep product list usable even if sync-status check fails.
        } finally {
            setSyncStatusLoading(false);
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (!search) {
                dispatch(
                    setFilters(
                        filterState.filter((f) => f.field !== "search")
                    )
                );
                return;
            }

            dispatch(
                setFilters([
                    ...filterState.filter((f) => f.field !== "search"),
                    {
                        field: "search",
                        operator: "contains",
                        value: search,
                    },
                ])
            );
        }, 500);

        return () => clearTimeout(timer);
        // ❌ DO NOT add filterState here
    }, [search, dispatch]);



    /* ===============================
       Fetch when filters change
    ================================ */
    useEffect(() => {
        fetchProducts(1, filterState);
    }, [filterState, fetchProducts]);

    useEffect(() => {
        fetchSyncStatus();
    }, [fetchSyncStatus]);

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

    /* ===============================
       Filter handlers
    ================================ */
    const onFilterChange = (field, nextFilter) => {
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
    };

    const onClearAll = () => {
        dispatch(clearFilters());
        fetchProducts(1, []);
    };

    /* ===============================
       Applied filters (Polaris)
    ================================ */
    const appliedFilters = useMemo(() => {
        return filterState
            .filter((f) => f.field !== "search")
            .map(({ field, operator, value }) => {
                const filter = getFilterByKey(field);

                return {
                    key: field,
                    label: `${filter?.label || field} ${operator} ${value}`,
                    onRemove: () =>
                        dispatch(
                            setFilters(filterState.filter((f) => f.field !== field))
                        ),
                };
            });
    }, [filterState, dispatch]);

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

    /* ===============================
       Render
    ================================ */
    return (
        <Page
            title={t("pageTitle")}
            subtitle={t("pageSubtitle")}
            fullWidth
            primaryAction={{
                content: t("edit"),
                onAction: () =>
                    navigate("/edit"),
            }}
            secondaryActions={[
                {
                    content:t("export"),
                    onAction: () => navigate("/exportdata"),
                },
            ]}
        >
            <Layout>
                <Layout.Section>
                    {error && (
                        <Banner status="critical" title="Error loading products">
                            <Text>{error}</Text>
                        </Banner>
                    )}

                    <BlockStack align="start">
                        <Button
                            variant="plain"
                            textAlign="left"
                            onClick={() => navigate("/refresh")}
                        >
                            {t("Syncyourproducts")}
                        </Button>

                    </BlockStack>
                </Layout.Section>
                <Layout.Section>
                    <ProductsFilters
                        queryValue={search}              // ✅ FROM REDUX
                        appliedFilters={appliedFilters}
                        filterState={filterState}
                        onFilterChange={onFilterChange}
                        onQueryChange={(value) => dispatch(setSearch(value))} // ✅
                        onQueryClear={onClearAll}
                        onClearAll={onClearAll}
                    />
                    <Box paddingBlockEnd="200">
                        {shouldShowLoadingState ? (
                            <Text variant="bodySm" tone="subdued">
                                {t("loadingProductsMatch")}
                            </Text>
                        ) : totalCount > 0 ? (
                            <Text variant="bodySm" tone="subdued">
                                <strong>{totalCount}</strong> {t("productsMatch")}
                            </Text>
                        ) : shouldShowEmptyState ? (
                            <Text variant="bodySm" tone="subdued">
                                {t("noProductsMatch")}
                            </Text>
                        ) : isSyncInProgress ? (
                            <SkeletonBodyText lines={1} />
                        ) : null}
                        {isSyncInProgress && !products.length && (
                            <Box paddingBlockStart="100">
                                <Text variant="bodySm" tone="subdued">
                                    Products are syncing in the background.
                                </Text>
                            </Box>
                        )}
                    </Box>
                    <Card>
                        <ProductsTable
                            products={products}
                            loading={shouldShowLoadingState}
                            pagination={pagination}
                            onNext={() => fetchProducts(page + 1, filterState)}
                            onPrev={() => fetchProducts(page - 1, filterState)}
                        />
                    </Card>
                </Layout.Section>
            </Layout>
        </Page>
    );
}
