// web/frontend/Domain/History/components/ExportComponent.tsx
import React from "react";
import { BlockStack, Card, Tabs, Text, Box } from "@shopify/polaris";
import ExportTable from "./ExportTable";
import { useToast } from "./useToast";
import { useTranslation } from "react-i18next";

const EXPORT_TYPE = {
  MANUAL: "Manual export",
  SCHEDULED: "Scheduled export",
} as const;

const ExportComponent: React.FC = () => {
  const { t } = useTranslation();
  const [selectedTab, setSelectedTab] = React.useState(0);

  const tabs = React.useMemo(
    () => [
      {
        id: "manual-exports",
        content: t("ManualExport"),
      },
      {
        id: "scheduled-exports",
        content: t("ScheduledExport"),
      },
    ],
    [t],
  );

  const selectedExportType = React.useMemo(
    () => (selectedTab === 1 ? EXPORT_TYPE.SCHEDULED : EXPORT_TYPE.MANUAL),
    [selectedTab],
  );

  const { toastMarkup, triggerToast } = useToast();

  const handleExportSuccess = React.useCallback(() => {
    triggerToast({
      content: t("exportSuccess"),
    });
  }, [triggerToast, t]);

  const handleExportError = React.useCallback(
    (errorMessage: string) => {
      triggerToast({ content: errorMessage, isError: true });
    },
    [triggerToast],
  );

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <Box paddingInlineStart="600">
            <Text as="h2" variant="headingLg">
              {t("exportHistory")}
            </Text>

            <Box paddingBlockStart="200">
              <Text as="p" tone="subdued" variant="bodyMd">
                {t("exportOverviewText")}
              </Text>
            </Box>
          </Box>

          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
        </BlockStack>
      </Card>

      <BlockStack gap="400">
        <ExportTable
          selectedType={selectedExportType}
          onExportSuccess={handleExportSuccess}
          onExportError={handleExportError}
        />
      </BlockStack>

      {toastMarkup}
    </BlockStack>
  );
};

export default ExportComponent;
