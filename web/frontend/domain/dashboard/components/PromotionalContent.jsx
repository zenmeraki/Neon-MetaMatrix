import { Text, BlockStack, Divider } from "@shopify/polaris";
import { useTranslation } from "react-i18next";

import DemoVideo from "../components/DemoVideo";
import MetamatrixCardGroup from "../components/MetamatrixCardGroup";

export default function PromotionalContent() {
  const { t } = useTranslation();

  return (
    <BlockStack gap="500">
      <MetamatrixCardGroup />

      <Divider />

      <BlockStack gap="400">
        <Text variant="headingMd" as="h3">
          {t("demoVideo", "Demo Video")}
        </Text>

        <DemoVideo />
      </BlockStack>
    </BlockStack>
  );
}
