// web/frontend/Domain/dashboard/components/MetricsSection.jsx
import React, { memo } from "react";
import { Card, InlineStack, Box, BlockStack, Icon, Text } from "@shopify/polaris";
import { EditIcon, ExportIcon, ImportIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

function MetricCard({ icon, label, value, loading }) {
  return (
    <Card>
      <Box padding="400">
        <BlockStack gap="200">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={icon} />
              <Text as="span" fontWeight="semibold">
                {label}
              </Text>
            </InlineStack>
            <Text as="span" tone="subdued">
              {loading ? "..." : value ?? 0}
            </Text>
          </InlineStack>
        </BlockStack>
      </Box>
    </Card>
  );
}

function MetricsSection({ loading, data }) {
  const { t } = useTranslation(undefined, { i18n: appI18n });

  const totals = data?.totals ?? {};

  return (
    <InlineStack align="start" gap="300" wrap>
      <MetricCard
        icon={EditIcon}
        label={t("bulkEdits", { defaultValue: "Bulk edits" })}
        value={totals.bulkEdits}
        loading={loading}
      />
      <MetricCard
        icon={ExportIcon}
        label={t("productExports", { defaultValue: "Product exports" })}
        value={totals.exports}
        loading={loading}
      />
      <MetricCard
        icon={ImportIcon}
        label={t("productImports", { defaultValue: "Product imports" })}
        value={totals.imports}
        loading={loading}
      />
    </InlineStack>
  );
}

export default memo(MetricsSection);
