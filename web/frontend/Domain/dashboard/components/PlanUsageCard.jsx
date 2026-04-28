import { memo } from "react";
import {
  BlockStack,
  Box,
  Card,
  InlineStack,
  ProgressBar,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { formatDashboardNumber } from "../utils/normalizeStoreAccess";

function PlanUsageCard({
  currentEditCount,
  maxEdits,
  planName,
  status,
  usageLabel,
  usagePercent,
}) {
  const { t } = useTranslation();
  const hasLimit = maxEdits != null && Number(maxEdits) > 0;
  const percentage =
    usagePercent ??
    (hasLimit
      ? Math.min(
          100,
          Math.round((Number(currentEditCount ?? 0) / maxEdits) * 100)
        )
      : null);

  return (
    <Card roundedAbove="sm">
      <Box padding="400">
        <InlineStack align="space-between" blockAlign="center" gap="400">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {t("planUsage", "Plan usage")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {planName || t("currentPlan", "Current plan")}
            </Text>
          </BlockStack>

          <BlockStack gap="050" inlineAlign="end">
            <Text as="p" variant="headingLg">
              {usageLabel ||
                (hasLimit
                  ? t("monthlyEditUsage", "{{current}} / {{max}}", {
                      current: formatDashboardNumber(currentEditCount),
                      max: formatDashboardNumber(maxEdits),
                    })
                  : formatDashboardNumber(currentEditCount))}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {status === "blocked"
                ? t("planBlocked", "Plan limit reached")
                : status === "near_limit"
                ? t("planNearLimit", "Near monthly limit")
                : hasLimit
                ? t("bulkEditsThisMonth", "Bulk edits this month")
                : t("bulkEditsUsed", "Bulk edits used")}
            </Text>
          </BlockStack>
        </InlineStack>

        {percentage != null ? (
          <Box paddingBlockStart="300">
            <BlockStack gap="200">
              <ProgressBar progress={percentage} size="small" />
              <Text as="p" variant="bodySm" tone="subdued">
                {t(
                  "planUsagePercent",
                  "{{percentage}}% of monthly edit limit",
                  {
                    percentage,
                  }
                )}
              </Text>
            </BlockStack>
          </Box>
        ) : null}
      </Box>
    </Card>
  );
}

export default memo(PlanUsageCard);
