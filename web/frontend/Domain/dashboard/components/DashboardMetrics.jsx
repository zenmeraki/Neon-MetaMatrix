import { memo, useMemo } from "react";
import {
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Text,
  BlockStack
} from "@shopify/polaris";
import {
  EditIcon,
  ExportIcon,
  ImportIcon,
  PageClockFilledIcon,
} from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import MetricCard from "./MetricCard";

const METRIC_GRID_COLUMNS = { xs: 1, sm: 2, md: 4, lg: 4, xl: 4 };

function DashboardMetrics({
  loading = false,
  totals,
  storeStatusLabel,
  onFirstEdit,
  onImport,
  onWatchDemo,
  editDisabled = false,
}) {
  const { t } = useTranslation();
  const isEmptyActivity =
    !loading &&
    totals.bulkEdits === 0 &&
    totals.exports === 0 &&
    totals.imports === 0;

  const metrics = useMemo(
    () => [
      {
        id: "store-status",
        icon: PageClockFilledIcon,
        label: t("storeStatus", "Store status"),
        value: storeStatusLabel,
        context: t("catalogMirror", "Catalog mirror"),
      },
      {
        id: "bulk-edits",
        icon: EditIcon,
        label: t("bulkEdits", "Bulk edits"),
        value: totals.bulkEdits,
        context: t("lastThirtyDays", "Last 30 days"),
      },
      {
        id: "exports",
        icon: ExportIcon,
        label: t("productExports", "Product exports"),
        value: totals.exports,
        context: t("lastThirtyDays", "Last 30 days"),
      },
      {
        id: "imports",
        icon: ImportIcon,
        label: t("productImports", "Product imports"),
        value: totals.imports,
        context: t("lastThirtyDays", "Last 30 days"),
      },
    ],
    [t, storeStatusLabel, totals.bulkEdits, totals.exports, totals.imports]
  );

  if (isEmptyActivity) {
    return (
      <Card roundedAbove="sm">
        <Box padding="500">
          <InlineStack align="space-between" blockAlign="center" gap="400" wrap>
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {t("noActivityYet", "No activity yet")}
              </Text>
              <Text as="p" variant="bodyMd">
                {t(
                  "noActivityYetDescription",
                  "Start by editing products, importing a spreadsheet, or watching the demo."
                )}
              </Text>
            </BlockStack>

            <InlineStack gap="200" wrap>
              <Button
                variant="primary"
                onClick={onFirstEdit}
                disabled={editDisabled}
              >
                {t("editYourFirstProducts", "Edit your first products")}
              </Button>
              <Button onClick={onImport}>
                {t("importSpreadsheet", "Import spreadsheet")}
              </Button>
              <Button variant="plain" onClick={onWatchDemo}>
                {t("watchDemo", "Watch demo")}
              </Button>
            </InlineStack>
          </InlineStack>
        </Box>
      </Card>
    );
  }

  return (
    <InlineGrid columns={METRIC_GRID_COLUMNS} gap="400">
      {metrics.map((metric) => (
        <MetricCard
          key={metric.id}
          icon={metric.icon}
          label={metric.label}
          value={metric.value}
          context={metric.context}
          loading={loading}
        />
      ))}
    </InlineGrid>
  );
}

export default memo(DashboardMetrics);