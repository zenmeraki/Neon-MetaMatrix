import React, { memo, useCallback, useMemo, useState } from "react";
import {
  ActionList,
  BlockStack,
  Box,
  Button,
  InlineStack,
  Popover,
  Select,
  Tag,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { ALL_FILTERS } from "../constants";
import FilterPanel from "./FilterPanel";

const ProductsFiltersBar = memo(function ProductsFiltersBar({
  appliedFilters = [],
  facetStats = [],
  onFilterChange,
  onClearAll,
}) {
  const { t, i18n } = useTranslation();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [activeFilterKey, setActiveFilterKey] = useState(null);

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

  const actionItems = useMemo(
    () =>
      translatedFilters.map((filter) => ({
        content: filter.translatedLabel,
        onAction: () => setActiveFilterKey(filter.key),
      })),
    [translatedFilters]
  );

  const openPicker = useCallback(() => {
    setActiveFilterKey(null);
    setIsPopoverOpen(true);
  }, []);

  const closePopover = useCallback(() => {
    setIsPopoverOpen(false);
    setActiveFilterKey(null);
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

  return (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="start" gap="300" wrap>
        <InlineStack gap="200" blockAlign="center" wrap>
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
              {t("addFilterPlus", { defaultValue: "Add filter +" })}
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

        {appliedFilters.map((item) => (
          <Tag
            key={item.key}
            onClick={() => openFilterEditor(item.key)}
            onRemove={item.onRemove}
          >
            {item.label}
          </Tag>
        ))}

        {appliedFilters.length > 0 ? (
          <Button
            type="button"
            variant="plain"
            onClick={onClearAll}
            accessibilityLabel={t("clearProductFiltersAccessibilityLabel", {
              defaultValue: "Clear all product filters",
            })}
          >
            {t("clearFilters", { defaultValue: "Clear filters" })}
          </Button>
        ) : null}
        </InlineStack>

        <Box minWidth="180px">
          <Select
            label={t("filterMatchMode", { defaultValue: "Filter match mode" })}
            labelHidden
            options={[
              {
                label: t("matchAllFilters", {
                  defaultValue: "Match all filters",
                }),
                value: "all",
              },
            ]}
            value="all"
            onChange={() => {}}
          />
        </Box>
      </InlineStack>

      {facetStats.length > 0 ? (
        <BlockStack gap="150">
          <Box paddingBlockStart="600">
          <Text as="p" variant="bodySm" fontWeight="semibold">
            {t("liveFacetRecalculationTitle", )}
          </Text>
          <InlineStack gap="300" wrap>
            {facetStats.map((facet) => (
              <Text key={facet.key} as="span" variant="bodySm" tone="subdued">
                {facet.label}{" "}
                <Text as="span" fontWeight="medium">
                  ({facet.beforeLabel} {"->"} {facet.afterLabel})

                </Text>
              </Text>
            ))}
          </InlineStack></Box>
        </BlockStack>
      ) : null}
    </BlockStack>
  );
});

export default ProductsFiltersBar;
