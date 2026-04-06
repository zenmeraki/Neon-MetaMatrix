import React from "react";
import {
  Text,
  BlockStack,
  InlineStack,
  Box,
  Divider,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

import DemoVideo from "../components/DemoVideo";
import MetamatrixCardGroup from "../components/MetamatrixCardGroup";

const PromotionalContent = () => {
  const { t } = useTranslation();

  return (
    <BlockStack gap="500">
      <Box>
        <MetamatrixCardGroup />
      </Box>

      <Divider />

      <BlockStack gap="400">
        <Text variant="headingMd" as="h3">
          {t("demoVideo")}
        </Text>

        <Box paddingBlock="400">
          <InlineStack align="center">
            <DemoVideo />
          </InlineStack>
        </Box>
      </BlockStack>

      <Divider />
    </BlockStack>
  );
};

export default PromotionalContent;