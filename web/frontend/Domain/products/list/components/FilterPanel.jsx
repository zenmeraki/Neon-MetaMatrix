import React, { memo } from "react";
import {
  Box,
  BlockStack,
  Select,
  Button,
  Text,
} from "@shopify/polaris";

import FilterValueInput from "./FilterValueInput";

// Make sure these are exported from your main file or utils
import {
  operatorRequiresValue,
  getTranslatedOperatorLabel,
} from "../utils/filterUtils";

const FilterPanel = memo(function FilterPanel({
  filter,
  draft,
  options,
  loading,
  onDraftChange,
  onSearch,
  onApply,
  t,
}) {
  return (
    <Box width="280px">
      <BlockStack gap="300">
        <Text as="p" variant="bodySm" tone="subdued">
          {t("configureField", {
            field: t(`fieldLabels.${filter.key}`, filter.label),
          })}
        </Text>

        {filter.operators.length > 0 && (
          <Select
            labelHidden
            options={filter.operators.map((operator) => ({
              label: getTranslatedOperatorLabel(t, operator),
              value: operator,
            }))}
            value={draft.operator}
            onChange={(nextOperator) =>
              onDraftChange({
                ...draft,
                operator: nextOperator,
              })
            }
          />
        )}

        <FilterValueInput
          filter={filter}
          value={draft.value}
          options={options}
          loading={loading}
          t={t}
          onChange={(nextValue) =>
            onDraftChange({
              ...draft,
              value: nextValue,
            })
          }
          onSearch={onSearch}
        />

        <Button
          variant="primary"
          disabled={
            operatorRequiresValue(draft.operator)
              ? !String(draft.value || "").trim()
              : false
          }
          onClick={onApply}
        >
          {t("addFilter")}
        </Button>
      </BlockStack>
    </Box>
  );
});

export default FilterPanel;