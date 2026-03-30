import React, { memo } from "react";
import { TextField, Button, InlineStack, BlockStack, Tabs, Text, Box } from "@shopify/polaris";
import { t } from "i18next";

interface HistoryFiltersProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onExport: () => void;
  onSaveView: () => void;
  selectedTabIndex: number;
  onTabChange: (index: number) => void;
  tabs: Array<{ id: string; content: string }>;
}

const HistoryFilters = memo<HistoryFiltersProps>(
  ({ searchValue, onSearchChange, onExport, onSaveView, selectedTabIndex, onTabChange, tabs }) => {
    return (
      <Box padding="400">
        <BlockStack gap="300">
          <BlockStack gap="100">
            <Text as="h3" variant="headingSm">
              Activity filters
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Search recent activity, switch history types, or export the current view.
            </Text>
          </BlockStack>

          <Tabs tabs={tabs} selected={selectedTabIndex} onSelect={onTabChange} />

          <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
            <div style={{ flex: "1 1 320px", minWidth: "260px" }}>
              <TextField
                label="Search"
                labelHidden
                placeholder={t("searchHistory")}
                value={searchValue}
                onChange={onSearchChange}
                clearButton
                onClearButtonClick={() => onSearchChange("")}
                autoComplete="off"
              />
            </div>

            <InlineStack gap="200">
              <Button onClick={onSaveView}>Save view</Button>
              <Button variant="primary" onClick={onExport}>
                Export
              </Button>
            </InlineStack>
          </InlineStack>
        </BlockStack>
      </Box>
    );
  },
);

HistoryFilters.displayName = "HistoryFilters";

export default HistoryFilters;
