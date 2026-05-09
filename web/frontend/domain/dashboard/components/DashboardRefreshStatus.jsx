import { memo } from "react";
import { Box, Button, InlineStack, Text } from "@shopify/polaris";
import { RefreshIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

function formatAge(timestamp, t) {
  if (!timestamp) return t("neverUpdated", "Not updated yet");

  const ageMs = Date.now() - timestamp;
  const ageSeconds = Math.max(0, Math.round(ageMs / 1000));

  if (ageSeconds < 60) {
    return t("updatedSecondsAgo", "{{count}}s ago", { count: ageSeconds });
  }

  const ageMinutes = Math.round(ageSeconds / 60);
  if (ageMinutes < 60) {
    return t("updatedMinutesAgo", "{{count}}m ago", { count: ageMinutes });
  }

  const ageHours = Math.round(ageMinutes / 60);
  return t("updatedHoursAgo", "{{count}}h ago", { count: ageHours });
}

function DashboardRefreshStatus({ lastFetchedAt, loading, onRefresh }) {
  const { t } = useTranslation();

  return (
    <Box paddingBlockEnd="200">
      <InlineStack align="end" blockAlign="center" gap="200">
        <Text as="p" variant="bodySm" >
          {t("lastUpdatedAgo", "Updated {{age}}", {
            age: formatAge(lastFetchedAt, t),
          })}
        </Text>
        <Button
          icon={RefreshIcon}
          size="slim"
          variant="plain"
          onClick={onRefresh}
          loading={loading}
          disabled={loading}
        >
          {t("refresh", "Refresh")}
        </Button>
      </InlineStack>
    </Box>
  );
}

export default memo(DashboardRefreshStatus);