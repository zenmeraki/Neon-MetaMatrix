import { memo, useMemo } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import {
  EditIcon,
  ExportIcon,
  ImportIcon,
  PageClockFilledIcon,
} from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import MetricCard from "./MetricCard";

const METRIC_GRID_COLUMNS = {
  xs: 1,
  sm: 2,
  md: 2,
  lg: 2,
  xl: 2,
};

function DashboardMetrics({
  loading = false,
  totals = {},
  storeStatusLabel,
  onFirstEdit,
  onImport,
  onWatchDemo,
  editDisabled = false,
}) {
  const { t } = useTranslation();

  const safeTotals = {
    bulkEdits: Number(totals.bulkEdits ?? 0),
    exports: Number(totals.exports ?? 0),
    imports: Number(totals.imports ?? 0),
  };

  const isEmptyActivity =
    !loading &&
    safeTotals.bulkEdits === 0 &&
    safeTotals.exports === 0 &&
    safeTotals.imports === 0;

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
        value: safeTotals.bulkEdits,
        context: t("lastThirtyDays", "Last 30 days"),
      },
      {
        id: "exports",
        icon: ExportIcon,
        label: t("productExports", "Product exports"),
        value: safeTotals.exports,
        context: t("lastThirtyDays", "Last 30 days"),
      },
      {
        id: "imports",
        icon: ImportIcon,
        label: t("productImports", "Product imports"),
        value: safeTotals.imports,
        context: t("lastThirtyDays", "Last 30 days"),
      },
    ],
    [
      t,
      storeStatusLabel,
      safeTotals.bulkEdits,
      safeTotals.exports,
      safeTotals.imports,
    ]
  );

  if (isEmptyActivity) {
    return (
      <Card roundedAbove="sm">
        <Box padding="400" minHeight="100%">
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              {t("noActivityYet", "No activity yet")}
            </Text>

            <Text as="p" variant="bodySm">
              {t(
                "noActivityYetDescription",
                "Start by editing products, importing a spreadsheet, or watching the demo."
              )}
            </Text>

            <InlineStack gap="200" wrap>
              <Button
                variant="primary"
                size="slim"
                onClick={onFirstEdit}
                disabled={editDisabled}
              >
                {t("editYourFirstProducts", "Edit your first products")}
              </Button>

              <Button size="slim" onClick={onImport}>
                {t("importSpreadsheet", "Import spreadsheet")}
              </Button>

              <Button variant="plain" size="slim" onClick={onWatchDemo}>
                {t("watchDemo", "Watch demo")}
              </Button>
            </InlineStack>
          </BlockStack>
        </Box>
      </Card>
    );
  }

  return (
    <InlineGrid columns={METRIC_GRID_COLUMNS} gap="400" alignItems="stretch">
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