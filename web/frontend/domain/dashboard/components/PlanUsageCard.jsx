import { memo } from "react";
import {
  BlockStack,
  Box,
  Card,
  Divider,
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

  const progressTone =
    status === "blocked"
      ? "critical"
      : status === "near_limit"
        ? "warning"
        : "highlight";

  const statusText =
    status === "blocked"
      ? t("planBlocked", "Plan limit reached")
      : status === "near_limit"
        ? t("planNearLimit", "Near monthly limit")
        : hasLimit
          ? t("bulkEditsThisMonth", "Bulk edits this month")
          : t("bulkEditsUsed", "Bulk edits used");

  const countLabel =
    usageLabel ||
    (hasLimit
      ? t("monthlyEditUsage", "{{current}} / {{max}}", {
          current: formatDashboardNumber(currentEditCount),
          max: formatDashboardNumber(maxEdits),
        })
      : formatDashboardNumber(currentEditCount));

  return (
    <Card roundedAbove="sm">
      <Box padding="400">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="start" gap="200">
            <BlockStack gap="0">
              <Text as="h2" variant="headingMd">
                {t("planUsage", "Plan usage")}
              </Text>
              <Text as="p" variant="bodySm" >
                {planName || t("currentPlan", "Current plan")}
              </Text>
            </BlockStack>

            <BlockStack gap="0" inlineAlign="end">
              <Text
                as="p"
                variant="headingMd"
                tone={status === "blocked" ? "critical" : undefined}
              >
                {countLabel}
              </Text>
              <Text
                as="p"
                variant="bodySm"
                tone={
                  status === "blocked"
                    ? "critical"
                    : status === "near_limit"
                      ? "caution"
                      : "subdued"
                }
              >
                {statusText}
              </Text>
            </BlockStack>
          </InlineStack>

          {percentage != null ? (
            <>
              <ProgressBar progress={percentage} size="small" tone={progressTone} />
              <Text as="p" variant="bodySm" >
                {t("planUsagePercent", "{{percentage}}% of monthly limit used", { percentage })}
              </Text>
            </>
          ) : null}
        </BlockStack>
      </Box>
    </Card>
  );
}

export default memo(PlanUsageCard);