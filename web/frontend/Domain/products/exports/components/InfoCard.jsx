import React from "react";
import { BlockStack, Card, List, Text } from "@shopify/polaris";

export default function InfoCard() {
  return (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingSm" as="h3">
          What happens next?
        </Text>
        <List>
          <List.Item>The export is created using the current filtered product set.</List.Item>
          <List.Item>Your file appears in export history once generation completes.</List.Item>
          <List.Item>Completed files can be downloaded again from the history page.</List.Item>
        </List>
      </BlockStack>
    </Card>
  );
}