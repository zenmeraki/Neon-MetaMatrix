// web/frontend/Domain/History/components/ExportComponent.tsx
import React from "react";
import { BlockStack, Card, Tabs, Text } from "@shopify/polaris";
import ExportTable from "./ExportTable";
import { useToast } from "./useToast";
import { useTranslation } from "react-i18next";

const ExportComponent: React.FC = () => {
  const { t } = useTranslation();
  const [selectedTab, setSelectedTab] = React.useState(0);

  const tabs = React.useMemo(
    () => [
      {
        id: "manual-exports",
        content: t("ManualExport", { defaultValue: "Manual Export" }),
      },
      {
        id: "scheduled-exports",
        content: t("ScheduledExport", { defaultValue: "Scheduled Export" }),
      },
    ],
    [t],
  );

  const selectedExportType = React.useMemo(
    () => (selectedTab === 1 ? "Scheduled export" : "Manual export"),
    [selectedTab],
  );

  // Toast hook
  const { toastMarkup, triggerToast } = useToast();

  // Success handler
  const handleExportSuccess = React.useCallback(() => {
    triggerToast({
      content: t("exportSuccess", {
        defaultValue: "Export completed successfully.",
      }),
    });
  }, [triggerToast, t]);

  // Error handler
  const handleExportError = React.useCallback(
    (errorMessage: string) => {
      triggerToast({ content: errorMessage, isError: true });
    },
    [triggerToast]
  );

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            {t("exportHistory", { defaultValue: "Export History" })}
          </Text>
          <Text as="p" tone="subdued" variant="bodyMd">
            Track generated files, monitor progress, and download completed exports.
          </Text>
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