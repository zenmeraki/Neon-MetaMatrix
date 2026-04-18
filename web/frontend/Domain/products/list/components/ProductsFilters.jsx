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

import { getAllFilters } from "../constants";

import { useTranslation } from "react-i18next";

const VALUE_OPTION_OPERATORS = new Set([
  "contains",
  "does not contain",
  "equals",
  "does not equal",
  "starts with",
  "ends with",
  "is",
  "is not",
]);

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

function operatorRequiresValue(operator) {
  return VALUE_OPTION_OPERATORS.has(operator);
}

function FilterValueInput({
  filter,
  value,
  onChange,
  onSearch,
  options,
  loading,
}) {
  const [inputValue, setInputValue] = useState("");

  if (filter.isSearchable) {
    return (
      <Autocomplete
        options={options}
        selected={value ? [value] : []}
        loading={loading}
        onSelect={([selected]) => {
          onChange(selected);

          const selectedOption = options.find((option) => option.value === selected);
          if (selectedOption) {
            setInputValue(selectedOption.label);
          }
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
        choices={filter.values.map((entry) => ({
          label: entry,
          value: entry,
        }))}
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
  const allFilters = getAllFilters();
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
          label: filter.label,
          filter: (
            <Box width="280px">
              <BlockStack gap="300">
                <Text as="p" variant="bodySm" tone="subdued">
                  Configure {filter.label.toLowerCase()}
                </Text>

                {filter.operators.length > 0 && (
                  <Select
                    labelHidden
                    options={filter.operators.map((operator) => ({
                      label: operator,
                      value: operator,
                    }))}
                    value={draft.operator}
                    onChange={(nextOperator) =>
                      setDraftFilters((prev) => ({
                        ...prev,
                        [filter.key]: {
                          ...draft,
                          operator: nextOperator,
                        },
                      }))
                    }
                  />
                )}

                <FilterValueInput
                  filter={filter}
                  value={draft.value}
                  options={autocompleteOptions[filter.key] || []}
                  loading={autocompleteLoading[filter.key]}
                  onChange={(nextValue) =>
                    setDraftFilters((prev) => ({
                      ...prev,
                      [filter.key]: {
                        ...draft,
                        value: nextValue,
                      },
                    }))
                  }
                  onSearch={(query) => {
                    clearTimeout(debounceTimers.current[filter.key]);

                    debounceTimers.current[filter.key] = setTimeout(() => {
                      fetchAutocompleteOptions(filter, query);
                    }, 300);
                  }}
                />

                <Button
                  variant="primary"
                  disabled={
                    operatorRequiresValue(draft.operator)
                      ? !String(draft.value || "").trim()
                      : false
                  }
                  onClick={() => {
                    onFilterChange(filter.key, draft);
                    setFiltersKey((key) => key + 1);
                  }}
                >
                  {t("addFilter")}
                </Button>
              </BlockStack>
            </Box>
          ),
        };
      }),
    [allFilters, autocompleteLoading, autocompleteOptions, draftFilters,t],
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