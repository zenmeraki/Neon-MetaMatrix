import React, { memo, useCallback, useMemo } from "react";
import {
  Box,
  Text,
  EmptyState,
  InlineStack,
  Pagination,
  SkeletonBodyText,
  SkeletonDisplayText,
  BlockStack,
  Banner,
  Button,
  IndexTable,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import ProductCell from "./ProductCell";
import StatusBadge from "./StatusBadge";

const SKELETON_ROWS = 6;

const ProductsTable = memo(function ProductsTable({
  products = [],
  loading,
  pagination,
  onNext,
  onPrev,
  onClearAll,
  error,
  onRetry,
  selectedSet = new Set(),
  selectedCount = 0,
  allMatchingSelected = false,
  onToggleRow,
  onTogglePage,
}) {
  const { t, i18n } = useTranslation();

  const resourceName = useMemo(
    () => ({
      singular: t("product", { defaultValue: "Product" }),
      plural: t("products", { defaultValue: "Products" }),
    }),
    [t]
  );

  const headings = useMemo(
    () => [
      { title: t("product", { defaultValue: "Product" }) },
      { title: t("status", { defaultValue: "Status" }) },
      { title: t("inventory", { defaultValue: "Inventory" }) },
      { title: t("productType", { defaultValue: "Product type" }) },
      { title: t("vendor", { defaultValue: "Vendor" }) },
    ],
    [t, i18n.language]
  );

  const totalMatching = Number(pagination?.total ?? products.length);
  const page = pagination?.page ?? 1;
  const totalPages = pagination?.totalPages ?? 1;
  const totalLabel = totalMatching.toLocaleString(i18n.language);
  const emptyValue = t("emptyValueDash", { defaultValue: "-" });

  const handleSelectionChange = useCallback(
    (selectionType, isSelecting, selection) => {
      if (selectionType === "page" || selectionType === "all") {
        onTogglePage?.();
        return;
      }

      const selectedId = Array.isArray(selection) ? selection[0] : selection;
      if (selectedId) {
        onToggleRow?.(selectedId);
      }
    },
    [onTogglePage, onToggleRow]
  );

  const selectedItemsCount = allMatchingSelected ? "All" : selectedCount;

  if (error) {
    return (
      <Box padding="600">
        <Banner
          tone="critical"
          title={t("productsLoadFailed", {
            defaultValue: "Failed to load products",
          })}
        >
          {onRetry ? (
            <Button
              onClick={onRetry}
              accessibilityLabel={t("retryProductsLoadAccessibilityLabel", {
                defaultValue: "Retry loading products",
              })}
            >
              {t("retry", { defaultValue: "Retry" })}
            </Button>
          ) : null}
        </Banner>
      </Box>
    );
  }

  if (loading) {
    return (
      <>
        <Box padding="400" borderBlockEndWidth="1" borderColor="border">
          <BlockStack gap="200">
            <SkeletonDisplayText size="small" />
            <SkeletonBodyText lines={1} />
          </BlockStack>
        </Box>

        <Box padding="400">
          <BlockStack gap="300">
            {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
              <SkeletonBodyText key={index} lines={1} />
            ))}
          </BlockStack>
        </Box>

        <Box padding="400" borderBlockStartWidth="1" borderColor="border">
          <SkeletonBodyText lines={1} />
        </Box>
      </>
    );
  }

  if (!products.length) {
    return (
      <Box padding="600">
        <EmptyState
          heading={t("filteredProductsEmptyHeading", {
            defaultValue: "No products found",
          })}
          action={
            onClearAll
              ? {
                  content: t("clearFilters", { defaultValue: "Clear filters" }),
                  onAction: onClearAll,
                }
              : undefined
          }
        >
          <p>
            {t("filteredProductsEmptyText", {
              defaultValue: "Try changing your search or filters.",
            })}
          </p>
        </EmptyState>
      </Box>
    );
  }

  return (
    <>
      <Box padding="400" borderBlockEndWidth="1" borderColor="border">
        <BlockStack gap="100">
          <Text as="h3" variant="headingSm">
            {t("filteredProductsTitle", {
              defaultValue: "Filtered products",
            })}
          </Text>

          <Text tone="subdued" variant="bodySm">
            {t("paginationSummary", {
              page,
              totalPages,
              total: totalLabel,
              defaultValue: `${page} of ${totalPages} - ${totalLabel} products`,
            })}
          </Text>
        </BlockStack>
      </Box>

      <IndexTable
        condensed
        selectable
        resourceName={resourceName}
        itemCount={products.length}
        selectedItemsCount={selectedItemsCount}
        onSelectionChange={handleSelectionChange}
        headings={headings}
      >
        {products.map((product, index) => {
          const productId = String(product.id);
          const imageUrl =
            product.featuredImageUrl ||
            product.featuredMedia?.preview?.image?.url ||
            "";

          const inventory =
            product.totalInventory === null ||
            product.totalInventory === undefined
              ? emptyValue
              : Number(product.totalInventory).toLocaleString(i18n.language);

          return (
            <IndexTable.Row
              id={productId}
              key={productId}
              position={index}
              selected={selectedSet.has(productId)}
              onClick={() => onToggleRow?.(productId)}
            >
              <IndexTable.Cell>
                <ProductCell
                  title={product.title ?? ""}
                  handle={product.handle ?? ""}
                  imageUrl={imageUrl}
                />
              </IndexTable.Cell>

              <IndexTable.Cell>
                <StatusBadge status={product.status} />
              </IndexTable.Cell>

              <IndexTable.Cell>{inventory}</IndexTable.Cell>

              <IndexTable.Cell>
                <Box maxWidth="220px">
                  <Text as="span" truncate>
                    {product.productType || emptyValue}
                  </Text>
                </Box>
              </IndexTable.Cell>

              <IndexTable.Cell>
                <Box maxWidth="220px">
                  <Text as="span" truncate>
                    {product.vendor || emptyValue}
                  </Text>
                </Box>
              </IndexTable.Cell>
            </IndexTable.Row>
          );
        })}
      </IndexTable>

      <Box padding="400" borderBlockStartWidth="1" borderColor="border">
        <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
          <Text tone="subdued" variant="bodySm">
            {t("productsPaginationHint", {
              defaultValue: "Showing products from the current filter result.",
            })}
          </Text>

          <Pagination
            hasPrevious={Boolean(pagination?.hasPrevPage)}
            onPrevious={onPrev}
            hasNext={Boolean(pagination?.hasNextPage)}
            onNext={onNext}
          />
        </InlineStack>
      </Box>
    </>
  );
});

export default ProductsTable;
