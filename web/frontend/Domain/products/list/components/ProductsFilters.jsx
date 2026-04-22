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
  const { t } = useTranslation();

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeFilterKey, setActiveFilterKey] = useState(null);

  const activeFilter = useMemo(
    () => ALL_FILTERS.find((filter) => filter.key === activeFilterKey) || null,
    [activeFilterKey]
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
      ALL_FILTERS.map((filter) => ({
        content: t(`fieldLabels.${filter.key}`, filter.label),
        onAction: () => handleSelectFilter(filter.key),
      })),
    [t, handleSelectFilter]
  );

  return (
    <BlockStack gap="300">
      <InlineHeader />

      <InlineStack gap="200" wrap blockAlign="center">
        <Box minWidth="320px">
          <TextField
            labelHidden
            value={queryValue}
            placeholder={t("searchPlaceholder")}
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
              {t("addFilter")}
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
              onCancel={() => setActiveFilterKey(null)}
              t={t}
            />
          )}
        </Popover>

        {appliedFilters.length > 0 && (
          <Button variant="plain" onClick={onClearAll}>
            {t("clearAll", "Clear all")}
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