import {
  Box,
  Button,
  Card,
  InlineStack,
  Layout,
  Text,
  TextField,
} from "@shopify/polaris";
import ProductsFiltersBar from "../../../domain/products/list/components/ProductsFiltersBar";
import ProductsIndexTable from "../../../domain/products/list/components/ProductsIndexTable";
import ProductsPaginationFooter from "../../../domain/products/list/components/ProductsPaginationFooter";
import ProductsSavedViews from "../../../domain/products/list/components/ProductsSavedViews";
import ProductsSearchBar from "../../../domain/products/list/components/ProductsSearchBar";

export default function ProductMainCard(props) {
  const {
    t,
    search,
    handleSearchChange,
    handleSearchClear,
    inventoryLocationId,
    setInventoryLocationId,
    appliedFilters,
    facetStats,
    onFilterChange,
    onClearAll,
    hasActiveSegmentCriteria,
    segmentName,
    setSegmentName,
    handleSaveCurrentSegment,
    selectedView,
    presetViews,
    savedSegments,
    handleSavedViewSelect,
    products,
    shouldShowLoadingState,
    error,
    handleRetryProducts,
    selection,
    handleViewProduct,
    handleEditProduct,
    handleDuplicateProduct,
    handleArchiveProduct,
    handleDeleteProduct,
    handleInlineSave,
    savingInlineCell,
    pagination,
    lastFetchedAt,
    handleNextPage,
    handlePreviousPage,
  } = props;

  return (
    <Layout.Section>
      <Card padding="0" roundedAbove="sm">
        <ProductsSavedViews
          selected={selectedView}
          presetViews={presetViews}
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
          <TextField
            label={t("inventoryLocationIdLabel", { defaultValue: "Inventory location ID (required for inline inventory edits)" })}
            value={inventoryLocationId}
            onChange={setInventoryLocationId}
            autoComplete="off"
            placeholder={t("inventoryLocationIdPlaceholder", { defaultValue: "Enter location ID explicitly" })}
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
  );
}
