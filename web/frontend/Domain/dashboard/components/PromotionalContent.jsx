import React, { lazy, Suspense } from "react";
import {
  Card,
  Spinner,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Divider,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

// Lazy-loaded components for better performance
import DemoVideo from "../components/DemoVideo";
import MetamatrixCardGroup from "../components/MetamatrixCardGroup";

/**
 * Component to display promotional content
 */
const PromotionalContent = () => {
  const { t } = useTranslation();

  return (
    <BlockStack gap="500">
      {/* Metamatrix Card Group Section */}
      <Box>
        <MetamatrixCardGroup />
      </Box>

      <Divider />
      

      {/* Demo Video Section */}
      <BlockStack gap="400">
        <Text variant="headingMd" as="h3">
          {t("Demo Video")}
        </Text>

        <Box paddingBlock="400">
          <InlineStack align="center">
            <DemoVideo />
          </InlineStack>
        </Box>
      </BlockStack>

      <Divider />


      {/* More Apps Section */}
      {/* <BlockStack gap="500">
        <Text variant="headingMd" as="h3">
          {t("moreApps")}
        </Text>

        <Box paddingBlock="500">
          <InlineStack align="center">
            <TarankerIframe />
          </InlineStack>
        </Box>

        <Box>
          <PlanBanner />
        </Box>
      </BlockStack> */}

    </BlockStack>
  );
};

export default PromotionalContent;