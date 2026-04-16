import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
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
import { useTranslation } from "react-i18next";

import { getAllFilters, OPERATORS_REQUIRING_VALUE } from "../constants";
import { useFilterAutocomplete } from "../hooks/useFilterAutocomplete";

// ---------------------------------------------------------------------------
// FilterValueInput — pure UI, receives options/loading from the parent hook.
// inputValue is synced back to "" whenever the committed value is cleared
// externally (e.g. "Clear all" or removing an applied filter) — issue #5.
// ---------------------------------------------------------------------------

function FilterValueInput({ filter, value, onChange, onSearch, options, loading }) {
  const [inputValue, setInputValue] = useState("");

  // Sync display text when the committed value is cleared externally.
  useEffect(() => {
    if (!value) setInputValue("");
  }, [value]);

  if (filter.isSearchable) {
    return (
      <Autocomplete
        options={options}
        selected={value ? [value] : []}
        loading={loading}
        onSelect={([selected]) => {
          onChange(selected);
          const selectedOption = options.find((o) => o.value === selected);
          if (selectedOption) setInputValue(selectedOption.label);
        }}
        textField={
          <Autocomplete.TextField
            labelHidden
            placeholder={`Search ${filter.label}`}
            autoComplete="off"
            value={inputValue}
            onFocus={() => onSearch(inputValue)}
            onChange={(text) => {
              setInputValue(text);
              onSearch(text);
            }}
          />
        }
      />
    );
  }

  if (filter.type === "enum") {
    return (
      <ChoiceList
        titleHidden
        choices={filter.values.map((entry) => ({ label: entry, value: entry }))}
        selected={value ? [value] : []}
        onChange={([next]) => onChange(next)}
      />
    );
  }

  if (filter.type === "number") {
    return <TextField type="number" labelHidden value={value} onChange={onChange} />;
  }

  if (filter.type === "date") {
    return <TextField type="date" labelHidden value={value} onChange={onChange} />;
  }

  return <TextField labelHidden value={value} onChange={onChange} />;
}

// ---------------------------------------------------------------------------
// FilterControl — owns its own autocomplete state via useFilterAutocomplete.
// Updating options for one filter does NOT re-render siblings (issue #6 orig).
// ---------------------------------------------------------------------------

const FilterControl = memo(function FilterControl({ filter, onFilterChange }) {
  const { t } = useTranslation();

  // Each FilterControl manages its own autocomplete state independently.
  const { options, loading, search } = useFilterAutocomplete(filter);

  const [draft, setDraft] = useState({
    operator: filter.operators[0] || "",
    value: "",
  });

  const handleOperatorChange = useCallback((nextOperator) => {
    setDraft((prev) => {
      if (prev.operator === nextOperator) return prev;
      return { ...prev, operator: nextOperator };
    });
  }, []);

  const handleValueChange = useCallback((nextValue) => {
    setDraft((prev) => {
      if (prev.value === nextValue) return prev;
      return { ...prev, value: nextValue };
    });
  }, []);

  const handleApply = useCallback(() => {
    onFilterChange(filter.key, draft);
  }, [draft, filter.key, onFilterChange]);

  // Guard both an empty operator (no operator selected yet) and operators
  // that require a non-empty value — issue #7.
  const applyDisabled =
    !draft.operator ||
    (OPERATORS_REQUIRING_VALUE.has(draft.operator) && !String(draft.value || "").trim());

  return (
    <Box width="280px">
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          Configure {filter.label.toLowerCase()}
        </Text>

        {filter.operators.length > 0 && (
          <Select
            labelHidden
            options={filter.operators.map((op) => ({ label: op, value: op }))}
            value={draft.operator}
            onChange={handleOperatorChange}
          />
        )}

        <FilterValueInput
          filter={filter}
          value={draft.value}
          options={options}
          loading={loading}
          onChange={handleValueChange}
          onSearch={search}
        />

        <Button variant="primary" disabled={applyDisabled} onClick={handleApply}>
          {t("addFilter")}
        </Button>
      </BlockStack>
    </Box>
  );
});

// ---------------------------------------------------------------------------
// InlineHeader — uses useTranslation hook so it re-renders on language change.
// Direct i18next.t() calls do not subscribe to language changes — issue #4.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ProductsFilters — orchestrates filter list, delegates autocomplete to children.
// allFilters is memoized so useMemo for filters doesn't recompute on every
// render caused by unrelated state changes — issue #6 (new list).
// ---------------------------------------------------------------------------

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
  const allFilters = useMemo(() => getAllFilters(), []);

  const filters = useMemo(
    () =>
      allFilters.map((filter) => ({
        key: filter.key,
        label: filter.label,
        filter: (
          <FilterControl
            key={filter.key}
            filter={filter}
            onFilterChange={onFilterChange}
          />
        ),
      })),
    [allFilters, onFilterChange]
  );

  return (
    <BlockStack gap="300">
      <InlineHeader />
      <Filters
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

export default ProductsFilters;
