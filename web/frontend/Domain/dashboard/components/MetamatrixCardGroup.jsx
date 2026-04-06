import React from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Grid,
  Icon,
  Badge,
} from "@shopify/polaris";
import {
  EditIcon,
  ExportIcon,
  PageClockFilledIcon,
  ImportIcon,
} from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

export const MetamatrixCardGroup = () => {
  const { t } = useTranslation();

  const cards = [
    {
      icon: EditIcon,
      title: t("tipsForBulkEditing"),
      description: t("bulkEditingTipDescription"),
      iconColor: "critical",
      badge: "Guide",
    },
    {
      icon: ImportIcon,
      title: t("editWithSpreadsheet"),
      description: t("editWithSpreadsheetDescription"),
      iconColor: "critical",
      badge: "Import",
    },
    {
      icon: ExportIcon,
      title: t("exportProductData"),
      description: t("exportProductDataDescription"),
      iconColor: "critical",
      badge: "Export",
    },
    {
      icon: PageClockFilledIcon,
      title: t("metamatrixChangelog"),
      description: t("metamatrixChangelogDescription"),
      iconColor: "critical",
      badge: "Updates",
    },
  ];

  const FeatureCard = ({ icon, title, description, iconColor, badge }) => (
    <Card roundedAbove="sm">
      <Box padding="500" minHeight="100%">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start">
            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="300"
            >
              <Icon source={icon} tone={iconColor} />
            </Box>

            <Badge tone="critical">{badge}</Badge>
          </InlineStack>

          <BlockStack gap="200">
            <Text variant="headingMd" as="h3">
              {title}
            </Text>
            <Text variant="bodyMd" tone="subdued">
              {description}
            </Text>
          </BlockStack>
        </BlockStack>
      </Box>
    </Card>
  );

  return (
    <BlockStack gap="500">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="100">
          <Text variant="headingLg" as="h2">
            {t("learnMore")}
          </Text>
        </BlockStack>
      </InlineStack>

      <Grid>
        {cards.map((card, index) => (
          <Grid.Cell
            key={index}
            columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}
          >
            <Box height="100%">
              <FeatureCard {...card} />
            </Box>
          </Grid.Cell>
        ))}
      </Grid>
    </BlockStack>
  );
};

export default MetamatrixCardGroup;