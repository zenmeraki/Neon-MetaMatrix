import { memo, useMemo } from "react";
import {
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

const METRIC_GRID_COLUMNS = { xs: 1, sm: 2, md: 4, lg: 4, xl: 4 };

function MetricsSection({
  loading = false,
  data,
  onFirstEdit,
  onImport,
  onWatchDemo,
  editDisabled = false,
}) {
  const { t } = useTranslation();

  const bulkEdits = data?.totals?.bulkEdits ?? 0;
  const exportsCount = data?.totals?.exports ?? 0;
  const importsCount = data?.totals?.imports ?? 0;
  const storeStatus = data?.totals?.storeStatus ?? t("active", "Active");
  const isEmptyActivity =
    !loading && bulkEdits === 0 && exportsCount === 0 && importsCount === 0;

  const metrics = useMemo(
    () => [
      {
        id: "store-status",
        icon: PageClockFilledIcon,
        label: t("storeStatus", "Store status"),
        value: storeStatus,
        context: t("catalogMirror", "Catalog mirror"),
      },
      {
        id: "bulk-edits",
        icon: EditIcon,
        label: t("bulkEdits", "Bulk edits"),
        value: bulkEdits,
        context: t("lastThirtyDays", "Last 30 days"),
      },
      {
        id: "exports",
        icon: ExportIcon,
        label: t("productExports", "Product exports"),
        value: exportsCount,
        context: t("lastThirtyDays", "Last 30 days"),
      },
      {
        id: "imports",
        icon: ImportIcon,
        label: t("productImports", "Product imports"),
        value: importsCount,
        context: t("lastThirtyDays", "Last 30 days"),
      },
    ],
    [t, storeStatus, bulkEdits, exportsCount, importsCount]
  );

  if (isEmptyActivity) {
    return (
      <Card roundedAbove="sm">
        <Box padding="500">
          <InlineStack align="space-between" blockAlign="center" gap="400">
            <Box>
              <Text as="h2" variant="headingLg">
                {t("noActivityYet", "No activity yet")}
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                {t(
                  "noActivityYetDescription",
                  "Start by editing products, importing a spreadsheet, or watching the demo."
                )}
              </Text>
            </Box>

            <InlineStack gap="200">
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
        <Box key={metric.id} height="100%">
          <MetricCard
            icon={metric.icon}
            label={metric.label}
            value={metric.value}
            context={metric.context}
            loading={loading}
          />
        </Box>
      ))}
    </InlineGrid>
  );
}

export default memo(MetricsSection);
