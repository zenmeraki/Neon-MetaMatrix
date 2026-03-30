import { useCallback, useEffect, useState } from "react";
import { Page, Card, Tabs, BlockStack, Box, Text } from "@shopify/polaris";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import HistoryComponent from "../components/HistoryComponent";
import ExportComponent from "../components/ExportComponent";

export default function HistoryPage() {
  const location = useLocation();
  const { t } = useTranslation();

  const parentTabs = [
    { id: "edit", content: t("edit"), accessibilityLabel: t("editHistoryTab") },
    {
      id: "export",
      content: t("export"),
      accessibilityLabel: t("exportHistoryTab"),
    },
  ];

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

  return (
    <Page
      fullWidth
      title={t("history")}
      subtitle={t("TrackYourHistory")}
    >
      <BlockStack gap="400">
        <Card>
          <Box padding="400">
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Review edit activity, export runs, and background work from one place.
              </Text>
              <Tabs
                tabs={parentTabs}
                selected={selectedParentTab}
                onSelect={handleParentTabChange}
              />
            </BlockStack>
          </Box>
        </Card>

        {selectedParentTab === 0 ? <HistoryComponent /> : <ExportComponent />}
      </BlockStack>
    </Page>
  );
}
