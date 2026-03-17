// web/frontend/Domain/History/components/ExportComponent.tsx
import React from "react";
import { Page,BlockStack } from "@shopify/polaris";
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
    <Page
      fullWidth
      title={t("exportHistory", { defaultValue: "Export History" })}
    >
      {/* <Card> */}
      <BlockStack gap="400">
        <ExportTable
          onExportSuccess={handleExportSuccess}
          onExportError={handleExportError}
        />
      </BlockStack>
      {/* </Card> */}

      {toastMarkup}
    </Page>
  );
};

export default ExportComponent;