// web/frontend/Domain/products/components/ProductsIndexTable.jsx

import React, { memo, useCallback, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  EmptyState,
  IndexTable,
  InlineStack,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  Thumbnail,
  Tooltip,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import ProductRowActions from "./ProductRowActions";
import InlineEditableCell from "./InlineEditableCell";

const SKELETON_ROWS = 8;

function getStatusTone(status) {
  const normalized = String(status || "").toUpperCase();

  if (normalized === "ACTIVE") return "success";
  if (normalized === "ARCHIVED") return "critical";
  if (normalized === "DRAFT") return "attention";

  return undefined;
}

function ProductTitleCell({ product }) {
  const imageUrl =
    product.featuredImageUrl ||
    product.featuredMedia?.preview?.image?.url ||
    product.image ||
    "";

  return (
    <InlineStack gap="300" blockAlign="center" wrap={false}>
      <Thumbnail source={imageUrl || ImageIcon} alt="" size="small" />

      <Box maxWidth="520px">
        <Text as="p" variant="bodyMd" fontWeight="semibold" truncate>
          {product.title || "-"}
        </Text>

        <Text as="p" variant="bodySm" tone="subdued" truncate>
          /{product.handle || "-"}
        </Text>
      </Box>
    </InlineStack>
  );
}

function InventoryCell({ product }) {
  const totalInventory = Number(product.totalInventory ?? 0);
  const variantsCount =
    product.variantsCount ||
    product.variantCount ||
    product.variants?.length ||
    1;

  if (totalInventory <= 0) {
    return (
      <InlineStack gap="150" blockAlign="center" wrap={false}>
        <Badge tone="critical">!</Badge>
        <Text as="span" tone="critical">
          Out of stock ({variantsCount} variants)
        </Text>
      </InlineStack>
    );
  }

  return (
    <Text as="span" tone="subdued">
      {totalInventory.toLocaleString()} in stock
    </Text>
  );
}

const ProductsIndexTable = memo(function ProductsIndexTable({
  products = [],
  loading,
  error,
  onRetry,
  onClearAll,
  selectedSet = new Set(),
  selectedCount = 0,
  allMatchingSelected = false,
  onToggleRow,
  onTogglePage,
  onViewProduct,
  onEditProduct,
  onDuplicateProduct,
  onArchiveProduct,
  onDeleteProduct,
  onPreviewProduct,
  onInlineSave,
  savingInlineCell = "",
}) {
  const { t, i18n } = useTranslation();
  const [hoveredRowId, setHoveredRowId] = useState("");
  const [focusedRowId, setFocusedRowId] = useState("");

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
      { title: t("productType", { defaultValue: "Type" }) },
      { title: t("vendor", { defaultValue: "Vendor" }) },
      { title: t("actions", { defaultValue: "Actions" }) },
    ],
    [t, i18n.language]
  );

  const selectedItemsCount = allMatchingSelected ? "All" : selectedCount;
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

  const buildInlineSaveHandler = useCallback(
    (product, field) => (_field, value) => onInlineSave?.(product, field, value),
    [onInlineSave]
  );

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

  if (loading && !products.length) {
    return (
      <Box padding="400">
        <BlockStack gap="300">
          <SkeletonDisplayText size="small" />

          {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
            <SkeletonBodyText key={index} lines={1} />
          ))}
        </BlockStack>
      </Box>
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
                content: t("clearFilters", {
                  defaultValue: "Clear filters",
                }),
                onAction: onClearAll,
              }
              : undefined
          }
        >
          <Text as="p">
            {t("filteredProductsEmptyText", {
              defaultValue: "Try changing your search or filters.",
            })}
          </Text>
        </EmptyState>
      </Box>
    );
  }

  return (
    <IndexTable
      selectable
      resourceName={resourceName}
      itemCount={products.length}
      selectedItemsCount={selectedItemsCount}
      onSelectionChange={handleSelectionChange}
      headings={headings}
    >
      {products.map((product, index) => {
        const productId = String(product.id);
        const status = String(product.status || "DRAFT").toUpperCase();

        const isRowActive =
          hoveredRowId === productId ||
          focusedRowId === productId ||
          selectedSet.has(productId);

        return (
          <IndexTable.Row
            id={productId}
            key={productId}
            position={index}
            selected={selectedSet.has(productId)}
            onClick={() => onPreviewProduct?.(product)}
            onMouseEnter={() => setHoveredRowId(productId)}
            onMouseLeave={() => setHoveredRowId("")}
            onFocus={() => setFocusedRowId(productId)}
            onBlur={() => setFocusedRowId("")}
          >
            <IndexTable.Cell>
              <ProductTitleCell product={product} />
            </IndexTable.Cell>

            <IndexTable.Cell>
              {onInlineSave ? (
                <InlineEditableCell
                  field="status"
                  type="status"
                  value={status}
                  displayValue={
                    <Badge tone={getStatusTone(status)}>{status}</Badge>
                  }
                  emptyValue={emptyValue}
                  saving={savingInlineCell === `${productId}:status`}
                  onSave={buildInlineSaveHandler(product, "status")}
                />
              ) : (
                <Badge tone={getStatusTone(status)}>{status}</Badge>
              )}
            </IndexTable.Cell>

            <IndexTable.Cell>
              {onInlineSave ? (
                <InlineEditableCell
                  field="inventory"
                  type="number"
                  value={product.totalInventory ?? ""}
                  displayValue={<InventoryCell product={product} />}
                  emptyValue={emptyValue}
                  saving={savingInlineCell === `${productId}:inventory`}
                  onSave={buildInlineSaveHandler(product, "inventory")}
                />
              ) : (
                <InventoryCell product={product} />
              )}
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Box maxWidth="220px">
                <Tooltip content={product.productType || emptyValue}>
                  <Text as="span" truncate>
                    {product.productType || emptyValue}
                  </Text>
                </Tooltip>
              </Box>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Box maxWidth="220px">
                {onInlineSave ? (
                  <InlineEditableCell
                    field="vendor"
                    value={product.vendor || ""}
                    emptyValue={emptyValue}
                    saving={savingInlineCell === `${productId}:vendor`}
                    onSave={buildInlineSaveHandler(product, "vendor")}
                  />
                ) : (
                  <Tooltip content={product.vendor || emptyValue}>
                    <Text as="span" tone="magic" truncate>
                      {product.vendor || emptyValue}
                    </Text>
                  </Tooltip>
                )}
              </Box>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <ProductRowActions
                product={product}
                visible={isRowActive}
                onView={onViewProduct}
                onEdit={onEditProduct}
                onDuplicate={onDuplicateProduct}
                onArchive={onArchiveProduct}
                onDelete={onDeleteProduct}
              />
            </IndexTable.Cell>
          </IndexTable.Row>
        );
      })}
    </IndexTable>
  );
});

export default ProductsIndexTable;