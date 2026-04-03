import React from "react";
import { Badge, BlockStack, Card, InlineStack, Text, TextField } from "@shopify/polaris";

export default function ExportSettingsCard({
    fileName,
    setFileName,
    fileError,
    validateFileName,
    count,
    loading,
}) {
  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text variant="headingSm" as="h3">
              Export settings
            </Text>
            <Text tone="subdued" as="p" variant="bodyMd">
              Name the file and confirm the current product scope before generating a CSV.
            </Text>
          </BlockStack>
          <Badge tone="info">
            {count === 0 ? "All products" : `${count} products`}
          </Badge>
        </InlineStack>

        <TextField
          label="File name"
          value={fileName}
          onChange={(value) => {
            setFileName(value);
            if (fileError) validateFileName();
          }}
          autoComplete="off"
          placeholder="e.g. january-products"
          helpText="The file will be downloaded as a CSV."
          error={fileError}
          disabled={loading}
        />
      </BlockStack>
    </Card>
  );
}
