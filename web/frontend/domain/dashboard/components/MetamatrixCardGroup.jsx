import { memo, useMemo } from "react";
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

const CARD_SPAN = { xs: 6, sm: 6, md: 3, lg: 3, xl: 3 };
const GRID_GAP = { xs: "400", sm: "400", md: "400", lg: "500", xl: "500" };

const FeatureCard = memo(function FeatureCard({
  icon,
  title,
  description,
  badge,
}) {
  return (
    <Card roundedAbove="sm">
      <Box padding="500" height="100%">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="start" gap="300">
            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="300"
            >
              <Icon source={icon} tone="base" />
            </Box>

            <Badge tone="info">{badge}</Badge>
          </InlineStack>

          <BlockStack gap="100">
            <Text variant="headingMd" as="h3">
              {title}
            </Text>

            <Text variant="bodyMd" tone="subdued" as="p">
              {description}
            </Text>
          </BlockStack>
        </BlockStack>
      </Box>
    </Card>
  );
});

export const MetamatrixCardGroup = memo(function MetamatrixCardGroup() {
  const { t } = useTranslation();

  const cards = useMemo(
    () => [
      {
        id: "bulk-edit",
        icon: EditIcon,
        title: t("tipsForBulkEditing", "Tips for bulk editing"),
        description: t(
          "bulkEditingTipDescription",
          "Learn how to edit products in bulk efficiently."
        ),
        badge: t("guide", "Guide"),
      },
      {
        id: "spreadsheet",
        icon: ImportIcon,
        title: t("editWithSpreadsheet", "Edit with spreadsheet"),
        description: t(
          "editWithSpreadsheetDescription",
          "Import spreadsheet changes and update products faster."
        ),
        badge: t("import", "Import"),
      },
      {
        id: "export",
        icon: ExportIcon,
        title: t("exportProductData", "Export product data"),
        description: t(
          "exportProductDataDescription",
          "Export product data for reporting, backups, and bulk workflows."
        ),
        badge: t("export", "Export"),
      },
      {
        id: "changelog",
        icon: PageClockFilledIcon,
        title: t("metamatrixChangelog", "Metamatrix changelog"),
        description: t(
          "metamatrixChangelogDescription",
          "Track recent updates, improvements, and product changes."
        ),
        badge: t("updates", "Updates"),
      },
    ],
    [t]
  );

  return (
    <BlockStack gap="500">
      <Text variant="headingLg" as="h2">
        {t("learnMore", "Learn more")}
      </Text>

      <Grid gap={GRID_GAP}>
        {cards.map((card) => (
          <Grid.Cell key={card.id} columnSpan={CARD_SPAN}>
            <FeatureCard {...card} />
          </Grid.Cell>
        ))}
      </Grid>
    </BlockStack>
  );
});

export default MetamatrixCardGroup;
