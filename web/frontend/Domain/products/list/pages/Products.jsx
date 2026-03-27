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
} from "@shopify/polaris";
import { useState, useMemo, useEffect } from "react";
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
        fetchProducts,
    } = useProducts();

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
                        {loading ? (
                            <Text variant="bodySm" tone="subdued">
                                {t("loadingProductsMatch")}
                            </Text>
                        ) : totalCount > 0 ? (
                            <Text variant="bodySm" tone="subdued">
                                <strong>{totalCount}</strong> {t("productsMatch")}
                            </Text>
                        ) : (
                            <Text variant="bodySm" tone="subdued">
                                {t("noProductsMatch")}
                            </Text>
                        )}
                    </Box>
                    <Card>
                        <ProductsTable
                            products={products}
                            loading={loading}
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
