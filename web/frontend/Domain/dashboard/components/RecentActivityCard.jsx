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

function RecentActivityCard({
  activities = [],
  onViewHistory,
  onStartEditing,
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <Box padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
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
                    align="start"
                    wrap={false}
                  >
                    <Box paddingBlockStart="025">
                      <Icon source={ActivityIcon} tone="base" />
                    </Box>

                    <BlockStack gap="050">
                      <Text as="p" variant="bodyMd">
                        {activity.title}
                      </Text>

                      {activity.description ? (
                        <Text as="p" variant="bodySm" tone="subdued">
                          {activity.description}
                        </Text>
                      ) : null}
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

              <InlineStack align="start">
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