import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Page,
  Card,
  Tabs,
  BlockStack,
  Box,
  Text,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import HistoryComponent from "../components/HistoryComponent";
import ExportComponent from "../components/ExportComponent";

export default function HistoryPage() {
  const location = useLocation();
  const { t } = useTranslation();

  const parentTabs = useMemo(
    () => [
      {
        id: "edit",
        content: t("edit"),
        accessibilityLabel: t("editHistoryTab"),
      },
      {
        id: "export",
        content: t("export"),
        accessibilityLabel: t("exportHistoryTab"),
      },
    ],
    [t],
  );

  const [selectedParentTab, setSelectedParentTab] = useState(() => {
    const savedTab = localStorage.getItem("selectedHistoryTab");
    return savedTab ? Number(savedTab) : 0;
  });

  const handleParentTabChange = useCallback((index) => {
    setSelectedParentTab(index);
    localStorage.setItem("selectedHistoryTab", index);
  }, []);

  useEffect(() => {
    if (location.state?.openExport) {
      setSelectedParentTab(1);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const activeTabLabel =
    selectedParentTab === 0 ? t("edit") : t("export");

  return (
    <Page fullWidth title={t("history")} subtitle={t("TrackYourHistory")}>
      <BlockStack gap="500">
        <Card>
          <Box padding="600">
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="start" wrap gap="300">
                <BlockStack gap="150">
                  <InlineStack gap="200" blockAlign="center" wrap>
                    <Text as="h1" variant="headingLg">
                      {t("history")}
                    </Text>
                    <Badge tone="info">{activeTabLabel}</Badge>
                  </InlineStack>

                  <Text as="p" variant="bodyMd" tone="subdued">
                    Review edit activity, export runs, and background work from one
                    organized workspace.
                  </Text>
                </BlockStack>
              </InlineStack>

              <Box
                background="bg-surface-secondary"
                borderRadius="300"
                padding="200"
              >
                <Tabs
                  tabs={parentTabs}
                  selected={selectedParentTab}
                  onSelect={handleParentTabChange}
                  fitted
                />
              </Box>
            </BlockStack>
          </Box>
        </Card>

        <Card padding="0">
          {selectedParentTab === 0 ? <HistoryComponent /> : <ExportComponent />}
        </Card>
      </BlockStack>
    </Page>
  );
}