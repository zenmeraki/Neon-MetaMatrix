import React from "react";
import {
  Text,
  BlockStack,
  InlineStack,
  Box,
  Divider,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

// Lazy-loaded components for better performance
import DemoVideo from "../components/DemoVideo";
import MetamatrixCardGroup from "../components/MetamatrixCardGroup";

/**
 * Component to display promotional content
 */
const PromotionalContent = () => {
  const { t } = useTranslation(undefined, { i18n: appI18n });

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
    </BlockStack>
  );
};

export default PromotionalContent;
