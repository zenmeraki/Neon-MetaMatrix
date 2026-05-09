import { memo } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
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
    <Card roundedAbove="sm">
      <Box padding="400">
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <Text as="h2" variant="headingMd">
              {t("recentActivity", "Recent activity")}
            </Text>
            <Button variant="plain" size="slim" onClick={onViewHistory}>
              {t("viewHistory", "View history")}
            </Button>
          </InlineStack>

          {activities.length > 0 ? (
            <BlockStack gap="0">
              {activities.map((activity, i) => {
                const ActivityIcon =
                  ACTIVITY_ICON_MAP[activity.type] || PageClockFilledIcon;

                return (
                  <BlockStack key={activity.id} gap="0">
                    {i > 0 ? <Divider /> : null}
                    <Box paddingBlock="250">
                      <InlineStack gap="200" blockAlign="center" wrap={false}>
                        <Icon source={ActivityIcon} />
                        <BlockStack gap="0">
                          <Text as="p" variant="bodySm">
                            {activity.title}
                          </Text>
                          {activity.description ? (
                            <Text as="p" variant="bodySm">
                              {activity.description}
                            </Text>
                          ) : null}
                        </BlockStack>
                      </InlineStack>
                    </Box>
                  </BlockStack>
                );
              })}
            </BlockStack>
          ) : (
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" >
                {t(
                  "activityWillAppearHere",
                  "Bulk edits, exports, imports, and sync events will appear here."
                )}
              </Text>
              <InlineStack align="start">
                <Button variant="primary" size="slim" onClick={onStartEditing}>
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