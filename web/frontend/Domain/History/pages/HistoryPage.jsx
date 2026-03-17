import { useState, useCallback, useEffect } from "react";
import {
  Frame,
  Page,
  Tabs,
  Card,
  Text,
  Spinner,
  BlockStack,
  Box,
} from "@shopify/polaris";
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
      window.history.replaceState({}, document.title)
    }
  }, [location.state]);

  return (
    <Frame>
      <Page
        fullWidth
        title={t("history")}
        subtitle={t("TrackYourHistory")}
      >
        {/* INLINE LEFT TABS — edit and export.shedule and manual */}
        <Tabs
          tabs={parentTabs}
          selected={selectedParentTab}
          onSelect={handleParentTabChange}
        />

        <BlockStack gap="400">
          <Box width="100%">
            {selectedParentTab === 0 && (
              <Card>
                <HistoryComponent />
              </Card>
            )}

            {selectedParentTab === 1 && (
              <Box width="100%">
                <ExportComponent />
              </Box>
            )}
          </Box>
        </BlockStack>
      </Page>
    </Frame>
  );
}
