import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

const HistoryComponent = lazy(() => import("../components/HistoryComponent"));
const ExportComponent = lazy(() => import("../components/ExportComponent"));

function normalizeHistoryTab(value) {
  if (value === "export") return 1;
  if (value === "edit") return 0;

  const index = Number(value);
  return index === 0 || index === 1 ? index : 0;
}

function tabIndexToQueryValue(index) {
  return index === 1 ? "export" : "edit";
}

export default function HistoryPage() {
  const location = useLocation();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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

  const [selectedParentTab, setSelectedParentTab] = useState(
    normalizeHistoryTab(searchParams.get("tab"))
  );
  const [visitedTabs, setVisitedTabs] = useState(() =>
    new Set([normalizeHistoryTab(searchParams.get("tab"))])
  );

  useEffect(() => {
    const urlTab = normalizeHistoryTab(searchParams.get("tab"));
    setSelectedParentTab(urlTab);
    setVisitedTabs((current) => {
      const next = new Set(current);
      next.add(urlTab);
      return next;
    });
  }, [searchParams]);

  const handleParentTabChange = useCallback((index) => {
    const normalizedIndex = normalizeHistoryTab(index);
    setSelectedParentTab(normalizedIndex);
    setVisitedTabs((current) => {
      const next = new Set(current);
      next.add(normalizedIndex);
      return next;
    });

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("tab", tabIndexToQueryValue(normalizedIndex));
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (location.state?.openExport) {
      setSelectedParentTab(1);
      setVisitedTabs((current) => {
        const next = new Set(current);
        next.add(1);
        return next;
      });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("tab", "export");
      setSearchParams(nextParams, { replace: true });
      navigate(`${location.pathname}?${nextParams.toString()}`, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate, searchParams, setSearchParams]);

  const activeTabLabel =
    selectedParentTab === 0 ? t("edit") : t("export");

  return (
    <Page fullWidth title={t("history")} subtitle={t("TrackYourHistory")}
  backAction={{
    content: t("Products"),
    onAction: () => navigate("/products"),
  }}>
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="start" wrap gap="300">
              <BlockStack gap="150">
                <InlineStack gap="200" blockAlign="center" wrap>
                  <Text as="h1" variant="headingLg">
                    {t("historyNext")}
                  </Text>
                  <Badge tone="info">{activeTabLabel}</Badge>
                </InlineStack>

                <Text as="p" variant="bodyMd" tone="subdued">
                  {t("historyOverviewText",)}
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
        </Card>

        <Card padding="0">
          <Suspense fallback={<Box padding="400"><Text as="p">{t("loading", { defaultValue: "Loading..." })}</Text></Box>}>
            {visitedTabs.has(0) ? (
              <Box display={selectedParentTab === 0 ? "block" : "none"}>
                <HistoryComponent />
              </Box>
            ) : null}
            {visitedTabs.has(1) ? (
              <Box display={selectedParentTab === 1 ? "block" : "none"}>
                <ExportComponent />
              </Box>
            ) : null}
          </Suspense>
        </Card>
      </BlockStack>
    </Page>
  );
}
