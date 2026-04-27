import React, { memo, useMemo, useState, useCallback } from "react";
import {
  BlockStack,
  Text,
  InlineStack,
  Button,
  Popover,
  ActionList,
  Box,
  TextField,
  Tag,
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
  const { t, i18n } = useTranslation();

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeFilterKey, setActiveFilterKey] = useState(null);

  const translatedText = useMemo(
    () => ({
      filtersHeading: t("filters"),
      filtersDescription: t("filtersDescription"),
      searchPlaceholder: t("searchPlaceholder"),
      addFilter: t("addFilter"),
      clearAll: t("clearFilters", "Clear Filters"),
      cancel: t("cancel", "Cancel"),
    }),
    [t, i18n.language]
  );

  const translatedFilters = useMemo(
    () =>
      ALL_FILTERS.map((filter) => ({
        ...filter,
        translatedLabel: t(`fieldLabels.${filter.key}`, filter.label),
      })),
    [t, i18n.language]
  );

  const activeFilter = useMemo(
    () =>
      translatedFilters.find((filter) => filter.key === activeFilterKey) || null,
    [translatedFilters, activeFilterKey]
  );

  const appliedFilterMap = useMemo(() => {
    return appliedFilters.reduce((acc, item) => {
      acc[item.key] = item;
      return acc;
    }, {});
  }, [appliedFilters]);

  const handleOpenPicker = useCallback(() => {
    setActiveFilterKey(null);
    setIsPopoverOpen(true);
  }, []);

  const handleClosePopover = useCallback(() => {
    setIsPopoverOpen(false);
    setActiveFilterKey(null);
  }, []);

  const handleSelectFilter = useCallback((filterKey) => {
    setActiveFilterKey(filterKey);
  }, []);

  const handleBackToList = useCallback(() => {
    setActiveFilterKey(null);
  }, []);

  const handleApplyFilter = useCallback(
    (nextFilter) => {
      onFilterChange(nextFilter.field, {
        operator: nextFilter.operator,
        value: nextFilter.value,
      });
      handleClosePopover();
    },
    [onFilterChange, handleClosePopover]
  );

  const actionItems = useMemo(
    () =>
      translatedFilters.map((filter) => ({
        content: filter.translatedLabel,
        onAction: () => handleSelectFilter(filter.key),
      })),
    [translatedFilters, handleSelectFilter]
  );

  return (
    <BlockStack gap="300">
      <InlineHeader
        heading={translatedText.filtersHeading}
        description={translatedText.filtersDescription}
      />

      <InlineStack gap="200" wrap blockAlign="center">
        <Box minWidth="320px">
          <TextField
            labelHidden
            value={queryValue}
            placeholder={translatedText.searchPlaceholder}
            onChange={onQueryChange}
            clearButton
            onClearButtonClick={onQueryClear}
            autoComplete="off"
          />
        </Box>

        <Popover
          active={isPopoverOpen}
          activator={
            <Button onClick={handleOpenPicker}>
              {translatedText.addFilter}
            </Button>
          }
          autofocusTarget="first-node"
          onClose={handleClosePopover}
        >
          {!activeFilter ? (
            <ActionList items={actionItems} />
          ) : (
            <FilterPanel
              filter={activeFilter}
              initialFilter={appliedFilterMap[activeFilter.key]}
              onApply={handleApplyFilter}
              onCancel={handleBackToList}
              t={t}
            />
          )}
        </Popover>

        {appliedFilters.length > 0 && (
          <Button variant="plain" onClick={onClearAll}>
            {translatedText.clearAll}
          </Button>
        )}
      </InlineStack>

      {appliedFilters.length > 0 && (
        <InlineStack gap="200" wrap>
          {appliedFilters.map((item) => (
            <Tag key={item.key} onRemove={item.onRemove}>
              {item.label}
            </Tag>
          ))}
        </InlineStack>
      )}
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