import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionList,
  BlockStack,
  Box,
  Button,
  InlineStack,
  Popover,
  Tag,
  Text,
  TextField,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { ALL_FILTERS } from "../constants";
import FilterPanel from "./FilterPanel";

const MIN_SEARCH_WIDTH = "280px";
const MAX_SEARCH_WIDTH = "420px";
const SEARCH_DEBOUNCE_MS = 300;

const ProductsFilters = memo(function ProductsFilters({
  queryValue = "",
  appliedFilters = [],
  onFilterChange,
  onQueryChange,
  onQueryClear,
  onClearAll,
}) {
  const { t, i18n } = useTranslation();

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeFilterKey, setActiveFilterKey] = useState(null);
  const [draftQueryValue, setDraftQueryValue] = useState(queryValue);

  useEffect(() => {
    setDraftQueryValue(queryValue);
  }, [queryValue]);

  const translatedText = useMemo(
    () => ({
      filtersHeading: t("filters", { defaultValue: "Filters" }),
      filtersDescription: t("filtersDescription", {
        defaultValue: "Search products or narrow results with filters.",
      }),
      searchPlaceholder: t("searchPlaceholder", {
        defaultValue: "Search products",
      }),
      addFilter: t("addFilter", { defaultValue: "Add filter" }),
      clearAll: t("clearFilters", { defaultValue: "Clear filters" }),
      searchLabel: t("searchProducts", { defaultValue: "Search products" }),
    }),
    [i18n.language, t]
  );

  const translatedFilters = useMemo(
    () =>
      ALL_FILTERS.map((filter) => ({
        ...filter,
        translatedLabel: t(`fieldLabels.${filter.key}`, {
          defaultValue: filter.label,
        }),
      })),
    [i18n.language, t]
  );

  const appliedFilterMap = useMemo(() => {
    const map = Object.create(null);
    for (const item of appliedFilters) {
      if (item?.key) map[item.key] = item;
    }
    return map;
  }, [appliedFilters]);

  const activeFilter = useMemo(
    () =>
      translatedFilters.find((filter) => filter.key === activeFilterKey) ||
      null,
    [activeFilterKey, translatedFilters]
  );

  const closePopover = useCallback(() => {
    setIsPopoverOpen(false);
    setActiveFilterKey(null);
  }, []);

  const openPicker = useCallback(() => {
    setActiveFilterKey(null);
    setIsPopoverOpen(true);
  }, []);

  const openFilterEditor = useCallback((key) => {
    setActiveFilterKey(key);
    setIsPopoverOpen(true);
  }, []);

  const backToList = useCallback(() => {
    setActiveFilterKey(null);
  }, []);

  const applyFilter = useCallback(
    (nextFilter) => {
      onFilterChange(nextFilter.field, {
        operator: nextFilter.operator,
        value: nextFilter.value,
      });
      closePopover();
    },
    [closePopover, onFilterChange]
  );

  const actionItems = useMemo(
    () =>
      translatedFilters.map((filter) => ({
        content: filter.translatedLabel,
        onAction: () => setActiveFilterKey(filter.key),
      })),
    [translatedFilters]
  );

  const handleQueryChange = useCallback((value) => {
    setDraftQueryValue(value);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (draftQueryValue !== queryValue) {
        onQueryChange(draftQueryValue);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draftQueryValue, onQueryChange, queryValue]);

  const handleQueryClear = useCallback(() => {
    setDraftQueryValue("");
    onQueryClear();
  }, [onQueryClear]);

  const handleClearAll = useCallback(() => {
    onClearAll();
  }, [onClearAll]);

  return (
    <BlockStack gap="300">
      <InlineHeader
        heading={translatedText.filtersHeading}
        description={translatedText.filtersDescription}
      />

      <InlineStack gap="200" wrap blockAlign="center">
        <Box
          minWidth={MIN_SEARCH_WIDTH}
          maxWidth={MAX_SEARCH_WIDTH}
          width="100%"
        >
          <TextField
            label={translatedText.searchLabel}
            labelHidden
            value={draftQueryValue}
            placeholder={translatedText.searchPlaceholder}
            onChange={handleQueryChange}
            clearButton
            onClearButtonClick={handleQueryClear}
            autoComplete="off"
          />
        </Box>

        <Popover
          active={isPopoverOpen}
          activator={
            <Button
              type="button"
              onClick={openPicker}
              accessibilityLabel={t("addProductFilterAccessibilityLabel", {
                defaultValue: "Add product filter",
              })}
            >
              {translatedText.addFilter}
            </Button>
          }
          autofocusTarget="first-node"
          onClose={closePopover}
        >
          {activeFilter ? (
            <FilterPanel
              filter={activeFilter}
              initialFilter={appliedFilterMap[activeFilter.key]}
              onApply={applyFilter}
              onCancel={backToList}
              t={t}
            />
          ) : (
            <ActionList items={actionItems} />
          )}
        </Popover>

        {appliedFilters.length > 0 ? (
          <Button
            type="button"
            variant="plain"
            onClick={handleClearAll}
            accessibilityLabel={t("clearProductFiltersAccessibilityLabel", {
              defaultValue: "Clear all product filters",
            })}
          >
            {translatedText.clearAll}
          </Button>
        ) : null}
      </InlineStack>

      {appliedFilters.length > 0 ? (
        <InlineStack gap="200" wrap>
          {appliedFilters.map((item) => (
            <Tag
              key={item.key}
              onClick={() => openFilterEditor(item.key)}
              onRemove={item.onRemove}
            >
              {item.label}
            </Tag>
          ))}
        </InlineStack>
      ) : null}
    </BlockStack>
  );
});

const InlineHeader = memo(function InlineHeader({ heading, description }) {
  return (
    <BlockStack gap="100">
      <Text as="h3" variant="headingSm">
        {heading}
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        {description}
      </Text>
    </BlockStack>
  );
});

export default ProductsFilters;
