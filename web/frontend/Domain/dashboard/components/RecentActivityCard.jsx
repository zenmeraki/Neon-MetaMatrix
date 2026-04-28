import { memo } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineStack,
  Text,
} from "@shopify/polaris";
import {
  EditIcon,
  ExportIcon,
  ImportIcon,
  PageClockFilledIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

const ACTIVITY_ICON_MAP = {
  edit: EditIcon,
  export: ExportIcon,
  import: ImportIcon,
  sync: RefreshIcon,
};

function RecentActivityCard({ activities, onViewHistory, onStartEditing }) {
  const { t } = useTranslation();

  return (
    <Card roundedAbove="sm">
      <Box padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" gap="400">
            <Text as="h2" variant="headingMd">
              {t("recentActivity", "Recent activity")}
            </Text>
            <Button variant="plain" onClick={onViewHistory}>
              {t("viewHistory", "View history")}
            </Button>
          </InlineStack>

          {activities.length > 0 ? (
            <BlockStack gap="300">
              {activities.map((activity) => {
                const ActivityIcon =
                  ACTIVITY_ICON_MAP[activity.type] || PageClockFilledIcon;
                return (
                  <InlineStack
                    key={activity.id}
                    gap="300"
                    blockAlign="start"
                    wrap={false}
                  >
                    <Icon source={ActivityIcon} tone="base" />
                    <BlockStack gap="050">
                      <Text as="p" variant="bodyMd">
                        {activity.title}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {activity.description}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                );
              })}
            </BlockStack>
          ) : (
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd">
                  {t("noRecentActivity", "No recent activity yet.")}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t(
                    "activityWillAppearHere",
                    "Bulk edits, exports, imports, and sync events will appear here."
                  )}
                </Text>
              </BlockStack>
              <InlineStack>
                <Button variant="primary" onClick={onStartEditing}>
                  {t("editProducts", "Edit products")}
                </Button>
              </InlineStack>
            </BlockStack>
          )}
        </BlockStack>
      </Box>
    </Card>
  );
}

export default memo(RecentActivityCard);
