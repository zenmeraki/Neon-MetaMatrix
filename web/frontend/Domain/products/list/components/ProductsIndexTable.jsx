import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  EmptyState,
  IndexTable,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  Tooltip,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import ProductCell from "./ProductCell";
import ProductRowActions from "./ProductRowActions";
import StatusBadge from "./StatusBadge";
import InlineEditableCell from "./InlineEditableCell";
import InventoryStatus from "./InventoryStatus";

const SKELETON_ROWS = 6;
const INITIAL_RENDER_ROWS = 12;
const ROW_RENDER_CHUNK = 16;

const ProductsIndexTable = memo(function ProductsIndexTable({
  products = [],
  loading,
  onClearAll,
  error,
  onRetry,
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
  const [visibleRowCount, setVisibleRowCount] = useState(INITIAL_RENDER_ROWS);

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
  const visibleProducts = useMemo(
    () => products.slice(0, visibleRowCount),
    [products, visibleRowCount]
  );

  useEffect(() => {
    setVisibleRowCount(Math.min(INITIAL_RENDER_ROWS, products.length));
  }, [products]);

  useEffect(() => {
    if (visibleRowCount >= products.length) return undefined;

    const schedule =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback
        : (callback) => window.setTimeout(callback, 16);
    const cancel =
      typeof window.cancelIdleCallback === "function"
        ? window.cancelIdleCallback
        : window.clearTimeout;

    const handle = schedule(() => {
      setVisibleRowCount((current) =>
        Math.min(products.length, current + ROW_RENDER_CHUNK)
      );
    });

    return () => cancel(handle);
  }, [products.length, visibleRowCount]);

  const focusProductRow = useCallback((productId) => {
    window.requestAnimationFrame(() => {
      document
        .querySelector(`[data-product-row-id="${CSS.escape(productId)}"]`)
        ?.focus();
    });
  }, []);

  const handleRowKeyDown = useCallback(
    (event, product, index) => {
      if (event.key === "Enter") {
        event.preventDefault();
        onPreviewProduct?.(product);
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextProduct =
          visibleProducts[Math.min(index + 1, visibleProducts.length - 1)];
        if (nextProduct?.id) {
          const nextId = String(nextProduct.id);
          setFocusedRowId(nextId);
          setHoveredRowId(nextId);
          focusProductRow(nextId);
        }
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const previousProduct = visibleProducts[Math.max(index - 1, 0)];
        if (previousProduct?.id) {
          const previousId = String(previousProduct.id);
          setFocusedRowId(previousId);
          setHoveredRowId(previousId);
          focusProductRow(previousId);
        }
      }
    },
    [focusProductRow, onPreviewProduct, visibleProducts]
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
                  content: t("clearFilters", { defaultValue: "Clear filters" }),
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
      condensed
      selectable
      resourceName={resourceName}
      itemCount={products.length}
      selectedItemsCount={selectedItemsCount}
      onSelectionChange={handleSelectionChange}
      headings={headings}
    >
      {visibleProducts.map((product, index) => {
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
        const inventoryDisplay = <InventoryStatus product={product} />;

        const buildInlineSaveHandler = (field) => (_field, value) =>
          onInlineSave?.(product, field, value);

        return (
          <IndexTable.Row
            id={productId}
            key={productId}
            position={index}
            selected={selectedSet.has(productId)}
            data-product-row-id={productId}
            data-product-row-active={
              hoveredRowId === productId || focusedRowId === productId
                ? "true"
                : "false"
            }
            tabIndex={0}
            onClick={() => onPreviewProduct?.(product)}
            onFocus={() => {
              setFocusedRowId(productId);
              setHoveredRowId(productId);
            }}
            onBlur={() => setFocusedRowId("")}
            onKeyDown={(event) => handleRowKeyDown(event, product, index)}
            onMouseEnter={() => setHoveredRowId(productId)}
            onMouseLeave={() => {
              if (focusedRowId !== productId) {
                setHoveredRowId("");
              }
            }}
          >
            <IndexTable.Cell>
              <ProductCell
                title={product.title ?? ""}
                handle={product.handle ?? ""}
                imageUrl={imageUrl}
              />
            </IndexTable.Cell>

            <IndexTable.Cell>
              {onInlineSave ? (
                <InlineEditableCell
                  field="status"
                  type="status"
                  value={product.status || "DRAFT"}
                  displayValue={<StatusBadge status={product.status} />}
                  emptyValue={emptyValue}
                  saving={savingInlineCell === `${productId}:status`}
                  onSave={buildInlineSaveHandler("status")}
                />
              ) : (
                <StatusBadge status={product.status} />
              )}
            </IndexTable.Cell>

            <IndexTable.Cell>
              {onInlineSave ? (
                <InlineEditableCell
                  field="inventory"
                  type="number"
                  value={product.totalInventory ?? ""}
                  displayValue={inventoryDisplay}
                  emptyValue={emptyValue}
                  saving={savingInlineCell === `${productId}:inventory`}
                  onSave={buildInlineSaveHandler("inventory")}
                />
              ) : (
                inventoryDisplay
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
              {onInlineSave ? (
                <InlineEditableCell
                  field="vendor"
                  value={product.vendor || ""}
                  emptyValue={emptyValue}
                  saving={savingInlineCell === `${productId}:vendor`}
                  onSave={buildInlineSaveHandler("vendor")}
                />
              ) : (
                <Box maxWidth="220px">
                  <Tooltip content={product.vendor || emptyValue}>
                    <Text as="span" truncate>
                      {product.vendor || emptyValue}
                    </Text>
                  </Tooltip>
                </Box>
              )}
            </IndexTable.Cell>

            <IndexTable.Cell>
              <ProductRowActions
                product={product}
                visible={
                  hoveredRowId === productId ||
                  focusedRowId === productId ||
                  selectedSet.has(productId)
                }
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
