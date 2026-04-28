import React, { memo, Suspense } from "react";
import {
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  InlineStack,
  SkeletonBodyText,
  Text,
} from "@shopify/polaris";
import { ViewIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";

const DemoVideo = React.lazy(() => import("./DemoVideo"));
const MetamatrixCardGroup = React.lazy(() => import("./MetamatrixCardGroup"));

function DashboardOnboarding({
  showGuide,
  showVideo,
  onToggleGuide,
  onWatchDemo,
}) {
  const { t } = useTranslation();

  return (
    <Card roundedAbove="sm">
      <Box padding="500">
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center" gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">
                {t("needHelpGettingStarted", "Need help getting started?")}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {t(
                  "gettingStartedCompactDescription",
                  "Use a short walkthrough or guide when you need it."
                )}
              </Text>
            </BlockStack>

            <InlineStack gap="200">
              <Button icon={ViewIcon} onClick={onWatchDemo}>
                {t("watchTwoMinuteDemo", "Watch 2-min demo")}
              </Button>
              <Button variant="plain" onClick={onToggleGuide}>
                {showGuide
                  ? t("hideGuide", "Hide guide")
                  : t("readGuide", "Read guide")}
              </Button>
            </InlineStack>
          </InlineStack>

          {showVideo ? (
            <>
              <Divider />
              <Suspense fallback={<SkeletonBodyText lines={6} />}>
                <DemoVideo />
              </Suspense>
            </>
          ) : null}

          {showGuide ? (
            <>
              <Divider />
              <Suspense fallback={<SkeletonBodyText lines={4} />}>
                <MetamatrixCardGroup />
              </Suspense>
            </>
          ) : null}
        </BlockStack>
      </Box>
    </Card>
  );
}

export default memo(DashboardOnboarding);
