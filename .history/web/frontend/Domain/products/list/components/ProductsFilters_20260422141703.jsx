import React, { memo, useMemo, useCallback } from "react"; // ✅ remove useState, useRef
import { Filters, BlockStack, Text } from "@shopify/polaris"; // ✅ clean unused imports
import { ALL_FILTERS } from "../constants";
import { useTranslation } from "react-i18next";
import FilterPanel from "./FilterPanel";

const ProductsFilters = memo(function ProductsFilters({
  queryValue,
  appliedFilters,
  onFilterChange,
  onQueryChange,
  onQueryClear,
  onClearAll,
}) {
  const { t } = useTranslation();

  // ✅ no filtersKey, no handleApplied — Filters stays mounted
  const filters = useMemo(
    () =>
      ALL_FILTERS.map((filter) => ({
        key: filter.key,
        label: t(`fieldLabels.${filter.key}`, filter.label),
        filter: (
          <FilterPanel
            filter={filter}
            onFilterChange={onFilterChange}
            t={t}
            // ✅ onApplied prop removed entirely
          />
        ),
      })),
    [t, onFilterChange]
  );

  return (
    <BlockStack gap="300">
      <InlineHeader />
      <Filters
        // ✅ no key prop — component stays mounted across filter operations
        queryValue={queryValue}
        queryPlaceholder={t("searchPlaceholder")}
        filters={filters}
        appliedFilters={appliedFilters}
        onQueryChange={onQueryChange}
        onQueryClear={onQueryClear}
        onClearAll={onClearAll}
      />
    </BlockStack>
  );
});

function InlineHeader() {
  const { t } = useTranslation();
  return (
    <BlockStack gap="100">
      <Text as="h3" variant="headingSm">{t("filters")}</Text>
      <Text as="p" variant="bodySm" tone="subdued">{t("filtersDescription")}</Text>
    </BlockStack>
  );
}

export default ProductsFilters;