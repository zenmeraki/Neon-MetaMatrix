import React from "react";
import { BlockStack, Card, List, Text } from "@shopify/polaris";

import { useTranslation } from "react-i18next";

export default function InfoCard() {
  const { t } = useTranslation();
  return (
    <Card>
      <BlockStack gap="300">
        <Text variant="headingSm" as="h3">
          {t("exportNextStepsTitle",)}
        </Text>
        <List>
          <List.Item>
            {t("exportNextStepOne",)}
          </List.Item>

          <List.Item>
            {t("exportNextStepTwo",)}
          </List.Item>

          <List.Item>
            {t("exportNextStepThree",)}
          </List.Item>
        </List>
      </BlockStack>
    </Card>
  );
}