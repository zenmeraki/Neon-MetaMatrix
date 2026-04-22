import React, { memo, useMemo, useRef, useState, useCallback } from "react";
import {
  Filters,
  ChoiceList,
  TextField,
  Box,
  Select,
  Button,
  BlockStack,
  Autocomplete,
  Text,
} from "@shopify/polaris";

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
  const [filtersKey, setFiltersKey] = useState(0); // ✅ re-add this

  const handleApplied = useCallback(() => {
    setFiltersKey((k) => k + 1); // ✅ increments → Filters remounts → popover closes
  }, []);

  // ✅ No more draftFilters / autocompleteOptions / autocompleteLoading here
  const filters = useMemo(
    () =>
      ALL_FILTERS.map((filter) => ({
        key: filter.key,
        label: t(`fieldLabels.${filter.key}`, filter.label),
        filter: (
          <FilterPanel
            filter={filter}
            onFilterChange={onFilterChange}
            onApplied={handleApplied}
            t={t}
          />
        ),
      })),
    [t, onFilterChange, handleApplied] 
  );

  return (
    <BlockStack gap="300">
      <InlineHeader />
      <Filters
        key={filtersKey}
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
      <Text as="h3" variant="headingSm">
        {t("filters")}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {t("filtersDescription")}
      </Text>
    </BlockStack>
  );
}

export default ProductsFilters;