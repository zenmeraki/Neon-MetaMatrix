import React, { memo, useMemo, useRef, useState } from "react";
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

function normalizeAutocompleteOption(item) {
  if (item === null || item === undefined) return null;

  if (typeof item === "string" || typeof item === "number") {
    const normalized = String(item).trim();
    if (!normalized) return null;

    return {
      label: normalized,
      value: normalized,
    };
  }

  const label = item.label ?? item.title ?? item.name ?? item.value ?? item.id;
  const value = item.value ?? item.title ?? item.name ?? item.label ?? item.id;

  if (label === undefined || value === undefined) {
    return null;
  }

  const normalizedLabel = String(label).trim();
  const normalizedValue = String(value).trim();

  if (!normalizedLabel || !normalizedValue) {
    return null;
  }

  return {
    label: normalizedLabel,
    value: normalizedValue,
  };
}

const ProductsFilters = memo(function ProductsFilters({
  queryValue,
  appliedFilters,
  filterState,
  onFilterChange,
  onQueryChange,
  onQueryClear,
  onClearAll,
}) {
  const { t } = useTranslation();
const allFilters = ALL_FILTERS;
  const [draftFilters, setDraftFilters] = useState({});
  const [filtersKey, setFiltersKey] = useState(0);
  const [autocompleteOptions, setAutocompleteOptions] = useState({});
  const [autocompleteLoading, setAutocompleteLoading] = useState({});
  const debounceTimers = useRef({});

  const fetchAutocompleteOptions = async (filter, query) => {
    if (!filter.api) return;

    setAutocompleteLoading((prev) => ({
      ...prev,
      [filter.key]: true,
    }));

    try {
      const res = await fetch(
        `${filter.api}?search=${encodeURIComponent(query)}&isNameOnly=true`,
      );

      if (!res.ok) throw new Error("Failed");

      const data = await res.json();
      const items = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

      setAutocompleteOptions((prev) => ({
        ...prev,
        [filter.key]: items.map(normalizeAutocompleteOption).filter(Boolean),
      }));
    } catch {
      setAutocompleteOptions((prev) => ({
        ...prev,
        [filter.key]: [],
      }));
    } finally {
      setAutocompleteLoading((prev) => ({
        ...prev,
        [filter.key]: false,
      }));
    }
  };

  const filters = useMemo(
    () =>
      allFilters.map((filter) => {
        const draft = draftFilters[filter.key] || {
          operator: filter.operators[0] || "",
          value: "",
        };

        return {
          key: filter.key,
          label: t(`fieldLabels.${filter.key}`, filter.label),
          filter: (
  <FilterPanel
    filter={filter}
    draft={draft}
    options={autocompleteOptions[filter.key] || []}
    loading={autocompleteLoading[filter.key]}
    t={t}
    onDraftChange={(nextDraft) =>
      setDraftFilters((prev) => ({
        ...prev,
        [filter.key]: nextDraft,
      }))
    }
    onSearch={(query) => {
      clearTimeout(debounceTimers.current[filter.key]);

      debounceTimers.current[filter.key] = setTimeout(() => {
        fetchAutocompleteOptions(filter, query);
      }, 300);
    }}
    onApply={() => {
      onFilterChange(filter.key, draft);
      setFiltersKey((key) => key + 1);
    }}
  />
),
        };
      }),
    [allFilters, autocompleteLoading, autocompleteOptions, draftFilters, t, onFilterChange],
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