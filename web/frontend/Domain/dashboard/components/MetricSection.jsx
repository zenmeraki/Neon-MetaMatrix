// web/frontend/Domain/dashboard/components/MetricsSection.jsx
import React, { memo } from "react";
import { Card, InlineStack } from "@shopify/polaris";
import { EditIcon, ExportIcon, ImportIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
// import MetricCard from "./MetricCard";

function MetricsSection({ loading, data }) {
  const { t } = useTranslation();

  const totals = data?.totals ?? {};

  return (
    <InlineStack distribution="fillEvenly" alignment="center">
      <Card
        icon={EditIcon}
        label={t("dashboard.bulkEdits")}
        value={totals.bulkEdits}
        loading={loading}
      />
      <Card
        icon={ExportIcon}
        label={t("dashboard.productExports")}
        value={totals.exports}
        loading={loading}
      />
      <Card
        icon={ImportIcon}
        label={t("dashboard.productImports")}
        value={totals.imports}
        loading={loading}
      />
    </InlineStack>
  );
}

export default memo(MetricsSection);