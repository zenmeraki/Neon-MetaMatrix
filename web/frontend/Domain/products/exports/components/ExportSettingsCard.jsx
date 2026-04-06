import React from "react";
import { Badge, BlockStack, Card, InlineStack, Text, TextField } from "@shopify/polaris";

import { useTranslation } from "react-i18next";

export default function ExportSettingsCard({
  fileName,
  setFileName,
  fileError,
  validateFileName,
  count,
  loading,
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text variant="headingSm" as="h3">
              {t("exportSettingsTitle",)}
            </Text>

            <Text tone="subdued" as="p" variant="bodyMd">
              {t("exportSettingsText",)}
            </Text>
          </BlockStack>
          <Badge tone="info">
            {count === 0 ? "All products" : `${count} products`}
          </Badge>
        </InlineStack>

        <BlockStack gap="100">
          <Text variant="bodyMd" fontWeight="semibold">
            {t("fileNameLabel")}
          </Text>
          <TextField
            labelHidden
            value={fileName}
            onChange={(value) => {
              setFileName(value);
              if (fileError) validateFileName();
            }}
            autoComplete="off"
            placeholder={t("fileNamePlaceholder")}
            helpText={t("fileNameHelpText")}
            error={fileError}
            disabled={loading}
          />
        </BlockStack>
      </BlockStack>
    </Card>
  );
}