import React, { memo } from "react";
import {
  TextField,
  Button,
  InlineStack,
  BlockStack,
  Tabs,
  Text,
  Box,
  Card,
  Badge,
} from "@shopify/polaris";
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
  ({
    searchValue,
    onSearchChange,
    onExport,
    onSaveView,
    selectedTabIndex,
    onTabChange,
    tabs,
  }) => {
    return (
      <Card>
        <Box padding="500">
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="start" wrap gap="300">
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="h3" variant="headingMd">
                    Activity filters
                  </Text>
                  <Badge tone="new">Workspace</Badge>
                </InlineStack>

                <Text as="p" variant="bodySm" tone="subdued">
                  Search recent activity, switch between history types, and export
                  the current view.
                </Text>
              </BlockStack>
            </InlineStack>

            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="200"
            >
              <Tabs tabs={tabs} selected={selectedTabIndex} onSelect={onTabChange} />
            </Box>

            <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
              <div style={{ flex: "1 1 380px", minWidth: "260px" }}>
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

              <InlineStack gap="200" wrap>
                <Button onClick={onSaveView}>Save view</Button>
                <Button variant="primary" onClick={onExport}>
                  Export
                </Button>
              </InlineStack>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>
    );
  },
);

HistoryFilters.displayName = "HistoryFilters";

export default HistoryFilters;