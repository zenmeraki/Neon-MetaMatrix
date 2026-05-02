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
  Select,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
  TextField,
  Thumbnail,
  Tooltip,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

const SKELETON_ROWS = 8;

const STATUS_OPTIONS = [
  { label: "Active", value: "ACTIVE" },
  { label: "Draft", value: "DRAFT" },
  { label: "Archived", value: "ARCHIVED" },
];

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

// Click badge to open a select dropdown inline
function StatusCell({ product, saving, onSave }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const status = String(product.status || "DRAFT").toUpperCase();

  const statusOptions = useMemo(
    () =>
      STATUS_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(`statusChoices.${opt.value.toLowerCase()}`, {
          defaultValue: opt.label,
        }),
      })),
    [t]
  );

  const handleChange = useCallback(
    async (value) => {
      setEditing(false);
      await onSave?.("status", value);
    },
    [onSave]
  );

  if (editing) {
    return (
      <Box minWidth="120px" onClick={(e) => e.stopPropagation()}>
        <Select
          label="Status"
          labelHidden
          options={statusOptions}
          value={status}
          disabled={saving}
          onChange={handleChange}
          onBlur={() => setEditing(false)}
        />
      </Box>
    );
  }

  return (
    <div
      style={{ display: "inline-flex", cursor: "pointer" }}
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      <Badge tone={getStatusTone(status)}>
        {saving ? "…" : status}
      </Badge>
    </div>
  );
}

// Click the number to edit inventory inline
function InventoryCell({ product, saving, onSave }) {
  const { i18n } = useTranslation();
  const [editing, setEditing] = useState(false);
  const total = Number(product.totalInventory ?? 0);
  const [draft, setDraft] = useState(String(total));

  const handleCommit = useCallback(async () => {
    setEditing(false);
    const parsed = Number(draft);
    if (!Number.isNaN(parsed) && parsed !== total) {
      await onSave?.("inventory", draft);
    }
  }, [draft, onSave, total]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") handleCommit();
      if (e.key === "Escape") setEditing(false);
    },
    [handleCommit]
  );

  if (editing) {
    return (
      <Box minWidth="80px" onClick={(e) => e.stopPropagation()}>
        <TextField
          label="Inventory"
          labelHidden
          type="number"
          value={draft}
          autoComplete="off"
          autoFocus
          disabled={saving}
          onChange={setDraft}
          onBlur={handleCommit}
          onKeyDown={handleKeyDown}
        />
      </Box>
    );
  }

  return (
    <div
      style={{ display: "inline-flex", cursor: "pointer" }}
      onClick={(e) => {
        e.stopPropagation();
        setDraft(String(total));
        setEditing(true);
      }}
    >
      <Text as="span" tone={total <= 0 ? "critical" : "subdued"} numeric>
        {saving ? "…" : total.toLocaleString(i18n.language)}
      </Text>
    </div>
  );
}

// Click the vendor name to edit it inline
function VendorCell({ product, saving, onSave }) {
  const [editing, setEditing] = useState(false);
  const vendor = product.vendor || "";
  const [draft, setDraft] = useState(vendor);

  const handleCommit = useCallback(async () => {
    setEditing(false);
    if (draft !== vendor) await onSave?.("vendor", draft);
  }, [draft, onSave, vendor]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") handleCommit();
      if (e.key === "Escape") setEditing(false);
    },
    [handleCommit]
  );

  if (editing) {
    return (
      <Box minWidth="140px" onClick={(e) => e.stopPropagation()}>
        <TextField
          label="Vendor"
          labelHidden
          value={draft}
          autoComplete="off"
          autoFocus
          disabled={saving}
          onChange={setDraft}
          onBlur={handleCommit}
          onKeyDown={handleKeyDown}
        />
      </Box>
    );
  }

  return (
    <Box
      maxWidth="220px"
      onClick={(e) => {
        e.stopPropagation();
        setDraft(vendor);
        setEditing(true);
      }}
    >
      <div style={{ cursor: "pointer" }}>
        <Tooltip content={vendor || "-"}>
          <Text as="span" tone="magic" truncate>
            {saving ? "…" : vendor || "-"}
          </Text>
        </Tooltip>
      </div>
    </Box>
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
  onPreviewProduct,
  onInlineSave,
  savingInlineCell = "",
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
      { title: t("productType", { defaultValue: "Type" }) },
      { title: t("vendor", { defaultValue: "Vendor" }) },
    ],
    [t, i18n.language]
  );

  const selectedItemsCount = allMatchingSelected ? "All" : selectedCount;

  const handleSelectionChange = useCallback(
    (selectionType, isSelecting, selection) => {
      if (selectionType === "page" || selectionType === "all") {
        onTogglePage?.();
        return;
      }
      const selectedId = Array.isArray(selection) ? selection[0] : selection;
      if (selectedId) onToggleRow?.(selectedId);
    },
    [onTogglePage, onToggleRow]
  );

  // Build a save handler scoped to a single product
  const buildSaveHandler = useCallback(
    (product) => (field, value) => onInlineSave?.(product, field, value),
    [onInlineSave]
  );

  if (error) {
    return (
      <Box padding="600">
        <Banner
          tone="critical"
          title={t("productsLoadFailed", { defaultValue: "Failed to load products" })}
        >
          {onRetry ? (
            <Button onClick={onRetry}>
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
      selectable
      resourceName={resourceName}
      itemCount={products.length}
      selectedItemsCount={selectedItemsCount}
      onSelectionChange={handleSelectionChange}
      headings={headings}
    >
      {products.map((product, index) => {
        const productId = String(product.id);
        const saveHandler = buildSaveHandler(product);

        return (
          <IndexTable.Row
            id={productId}
            key={productId}
            position={index}
            selected={selectedSet.has(productId)}
            onClick={() => onPreviewProduct?.(product)}
          >
            <IndexTable.Cell>
              <ProductTitleCell product={product} />
            </IndexTable.Cell>

            <IndexTable.Cell>
              <StatusCell
                product={product}
                saving={savingInlineCell === `${productId}:status`}
                onSave={saveHandler}
              />
            </IndexTable.Cell>

            <IndexTable.Cell>
              <InventoryCell
                product={product}
                saving={savingInlineCell === `${productId}:inventory`}
                onSave={saveHandler}
              />
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Box maxWidth="220px">
                <Tooltip content={product.productType || "-"}>
                  <Text as="span" truncate>
                    {product.productType || "-"}
                  </Text>
                </Tooltip>
              </Box>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <VendorCell
                product={product}
                saving={savingInlineCell === `${productId}:vendor`}
                onSave={saveHandler}
              />
            </IndexTable.Cell>

          </IndexTable.Row>
        );
      })}
    </IndexTable>
  );
});

export default ProductsIndexTable;