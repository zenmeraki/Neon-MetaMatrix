import React from "react";
import {
  Card,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Grid,
  Icon,
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
    },
    {
      icon: ImportIcon,
      title: t("editWithSpreadsheet"),
      description: t("editWithSpreadsheetDescription"),
      iconColor: "critical",
    },
    {
      icon: ExportIcon,
      title: t("exportProductData"),
      description: t("exportProductDataDescription"),
      iconColor: "critical",
    },
    {
      icon: PageClockFilledIcon,
      title: t("metamatrixChangelog"),
      description: t("metamatrixChangelogDescription"),
      iconColor: "critical",
    },
  ];

  const FeatureCard = ({ icon, title, description, iconColor }) => (
    <Card>
      <Box padding="500">
        <BlockStack gap="400">
          {/* Icon Section */}
          <Box
            padding="500"
            background="bg-surface-secondary"
            borderRadius="200"
          >
            <InlineStack align="center">
              <Box
                padding="300"
                background="bg-fill-critical-secondary"
                borderRadius="100"
              >
                <Icon source={icon} tone={iconColor} />
              </Box>
            </InlineStack>
          </Box>

          {/* Content Section */}
          <BlockStack gap="300">
            <Text
              variant="headingSm"
              as="h3"
              alignment="center"
              tone="critical"
            >
              {title}
            </Text>
            <Text variant="bodyMd" tone="subdued" alignment="center">
              {description}
            </Text>
          </BlockStack>
        </BlockStack>
      </Box>
    </Card>
  );

  return (
    <BlockStack gap="500">
      <Text variant="headingMd" as="h2">
        {t("learnMore")}
      </Text>

      <Grid>
        {cards.map((card, index) => (
          <Grid.Cell
            key={index}
            columnSpan={{ xs: 6, sm: 3, md: 6, lg: 6, xl: 6 }}
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