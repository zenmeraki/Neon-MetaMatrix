import React from "react";
import {
  Page,
  Card,
  Layout,
  Text,
  Button,
  BlockStack,
  Divider,
  Banner,
  Box,
  InlineStack,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";

const PrivacyPage = () => {
  const { t } = useTranslation();

  const sections = [
    {
      id: "section1",
      titleKey: "section1Title",
      contentKey: "section1Content",
    },
    {
      id: "section2",
      titleKey: "section2Title",
      contentKey: "section2Content",
    },
    {
      id: "section3",
      titleKey: "section3Title",
      contentKey: "section3Content",
    },
    {
      id: "section4",
      titleKey: "section4Title",
      contentKey: "section4Content",
    },
    {
      id: "section5",
      titleKey: "section5Title",
      contentKey: "section5Content",
    },
    {
      id: "section6",
      titleKey: "section6Title",
      contentKey: "section6Content",
    },
  ];

  return (
    <Page
      title={t("privacyPolicyPageTitle")}
      subtitle={t("privacyPolicyHeading")}
      backAction={{
        content: t("backToHome", { defaultValue: "Back to Home" }),
        url: "/",
      }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner
              tone="info"
              title={t("privacyPolicyBannerTitle", {
                defaultValue: "How we handle your data",
              })}
            >
              <Text as="p">{t("privacyIntro")}</Text>
            </Banner>

            {sections.map((section) => (
              <Card key={section.id}>
                <Box padding="500">
                  <BlockStack gap="400">
                    <InlineStack align="center">
                      <Text as="h2" variant="headingMd">
                        {t(section.titleKey)}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodyMd">
                      {t(section.contentKey)}
                    </Text>
                  </BlockStack>
                </Box>
              </Card>
            ))}

            <Divider />

            <Card>
              <Box padding="500">
                <BlockStack gap="400">
                  <Box textAlign="center">
                    <Text as="h2" variant="headingMd">
                      {t("contactUs")}
                    </Text>
                  </Box>
                  <InlineStack align="start" gap="200">
                    <Button
                      variant="primary"
                      url="https://zenmeraki.com/contact"
                      external
                    >
                      {t("contactPrivacy")}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Box>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
};

export default PrivacyPage;
