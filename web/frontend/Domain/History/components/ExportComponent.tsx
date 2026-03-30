// web/frontend/Domain/History/components/ExportComponent.tsx
import React from "react";
import { BlockStack, Card, Text } from "@shopify/polaris";
import ExportTable from "./ExportTable";
import { useToast } from "./useToast";
import { useTranslation } from "react-i18next";

const ExportComponent: React.FC = () => {
  const { t } = useTranslation();

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
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {t("exportHistory", { defaultValue: "Export History" })}
          </Text>
          <Text as="p" tone="subdued" variant="bodyMd">
            Track generated files, monitor progress, and download completed exports.
          </Text>
        </BlockStack>
      </Card>

      <BlockStack gap="400">
        <ExportTable
          onExportSuccess={handleExportSuccess}
          onExportError={handleExportError}
        />
      </BlockStack>

      {toastMarkup}
    </BlockStack>
  );
};

export default ExportComponent;
