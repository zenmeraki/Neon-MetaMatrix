import { memo } from "react";
import { Box, Button, Card, InlineStack, Text } from "@shopify/polaris";
import { RefreshIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

function formatAge(timestamp, t) {
  if (!timestamp) return t("neverUpdated", "Not updated yet");

  const ageMs = Date.now() - timestamp;
  const ageSeconds = Math.max(0, Math.round(ageMs / 1000));

  if (ageSeconds < 60) {
    return t("updatedSecondsAgo", "{{count}} seconds ago", {
      count: ageSeconds,
    });
  }

  const ageMinutes = Math.round(ageSeconds / 60);
  if (ageMinutes < 60) {
    return t("updatedMinutesAgo", "{{count}} minutes ago", {
      count: ageMinutes,
    });
  }

  const ageHours = Math.round(ageMinutes / 60);
  return t("updatedHoursAgo", "{{count}} hours ago", { count: ageHours });
}

function DashboardRefreshStatus({ lastFetchedAt, loading, onRefresh }) {
  const { t } = useTranslation();

  return (
    <Card roundedAbove="sm">
      <Box padding="400">
        <InlineStack align="space-between" blockAlign="center" gap="400">
          <Text as="p" variant="bodySm" tone="subdued">
            {t("lastUpdatedAgo", "Last updated {{age}}", {
              age: formatAge(lastFetchedAt, t),
            })}
          </Text>
          <Button
            icon={RefreshIcon}
            size="slim"
            onClick={onRefresh}
            loading={loading}
            disabled={loading}
          >
            {t("refresh", "Refresh")}
          </Button>
        </InlineStack>
      </Box>
    </Card>
  );
}

export default memo(DashboardRefreshStatus);
