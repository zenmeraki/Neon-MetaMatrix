import React from "react";
import {
  Badge,
  BlockStack,
  Box,
  Card,
  Checkbox,
  Divider,
  InlineStack,
  Text,
} from "@shopify/polaris";

export default function FieldSelectionCard({
  productFields,
  variantFields,
  seoFields,
  selectedFields,
  setSelectedFields,
  allFields,
  loading,
}) {
  const toggleField = (value) => {
    setSelectedFields((prev) =>
      prev.includes(value) ? prev.filter((field) => field !== value) : [...prev, value],
    );
  };

  const handleSelectAll = () => {
    if (selectedFields.length === allFields.length) {
      setSelectedFields([]);
      return;
    }

    setSelectedFields(allFields.map((field) => field.value));
  };

  const renderSection = (title, fields) => (
    <BlockStack gap="300">
      <InlineStack align="space-between" blockAlign="center">
        <Text variant="headingXs" tone="subdued" as="h4">
          {title}
        </Text>
        <Badge>{fields.length} fields</Badge>
      </InlineStack>

      <Box
        padding="300"
        background="bg-surface-secondary"
        borderRadius="300"
        borderWidth="1"
        borderColor="border"
      >
        <InlineStack wrap gap="400">
          {fields.map((field) => (
            <Box key={field.value} minWidth="220px">
              <Checkbox
                label={field.label}
                checked={selectedFields.includes(field.value)}
                onChange={() => toggleField(field.value)}
                disabled={loading}
              />
            </Box>
          ))}
        </InlineStack>
      </Box>
    </BlockStack>
  );

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="start">
          <BlockStack gap="100">
            <Text variant="headingSm" as="h3">
              Field selection
            </Text>
            <Text tone="subdued" as="p" variant="bodyMd">
              Choose the product, variant, and SEO columns to include in this export.
            </Text>
          </BlockStack>

          <Checkbox
            label={selectedFields.length === allFields.length ? "Deselect all" : "Select all"}
            checked={selectedFields.length === allFields.length}
            onChange={handleSelectAll}
            disabled={loading}
          />
        </InlineStack>

        <Divider />
        {renderSection("Product fields", productFields)}
        <Divider />
        {renderSection("Variant fields", variantFields)}
        <Divider />
        {renderSection("SEO fields", seoFields)}
      </BlockStack>
    </Card>
  );
}