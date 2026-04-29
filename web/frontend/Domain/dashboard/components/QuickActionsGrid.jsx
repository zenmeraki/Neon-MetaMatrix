import { memo } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  Icon,
  InlineGrid,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const QUICK_ACTION_COLUMNS = { xs: 1, sm: 2, md: 4, lg: 4, xl: 4 };

const QuickActionCard = memo(function QuickActionCard({
  icon,
  title,
  description,
  actionText,
  trustCopy,
  primary = false,
  disabled = false,
  disabledReason,
  loading = false,
  onAction,
}) {
  const bodyText = description || trustCopy;

  return (
    <Card roundedAbove="sm">
      <Box padding="400" minHeight="260px">
        <BlockStack gap="400">
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <Box
              background="bg-surface-secondary"
              borderRadius="300"
              padding="300"
            >
              <Icon source={icon} tone="base" />
            </Box>

            <Text as="h3" variant="headingSm">
              {title}
            </Text>
          </InlineStack>

          <Box minHeight="48px">
            {bodyText ? (
              <Text as="p" variant="bodySm" tone="subdued">
                {bodyText}
              </Text>
            ) : null}
          </Box>

          <Box minHeight="24px">
            {disabled && disabledReason ? (
              <Text as="p" variant="bodySm" tone="critical">
                {disabledReason}
              </Text>
            ) : null}
          </Box>

          <Box paddingBlockStart="300">
            <Button
              fullWidth
              variant={primary ? "primary" : undefined}
              onClick={onAction}
              disabled={disabled}
              loading={loading}
            >
              {actionText}
            </Button>
          </Box>
        </BlockStack>
      </Box>
    </Card>
  );
});

function QuickActionsGrid({ actions }) {
  const { t } = useTranslation();

  return (
    <BlockStack gap="400">
      <BlockStack gap="100">
        <Box paddingInlineStart="200">
          <Text as="h2" variant="headingLg">
            {t("quickActions", "Quick actions")}
          </Text>

          <Text as="p" variant="bodyMd" tone="subdued">
            {t(
              "quickActionsDescription",
              "Run common catalog workflows without leaving the dashboard."
            )}
          </Text></Box>
      </BlockStack>

      <InlineGrid columns={QUICK_ACTION_COLUMNS} gap="400" alignItems="stretch">
        {actions.map((action) => (
          <QuickActionCard key={action.key} {...action} />
        ))}
      </InlineGrid>
    </BlockStack>
  );
}

export default memo(QuickActionsGrid);