import React, { useEffect } from "react";
import {
  Page,
  Card,
  Layout,
  Text,
  Button,
  BlockStack,
  Divider,
  Banner,
  List,
  Box,
  InlineStack,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import "../../../utils/i18n";

const PrivacyPage = () => {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    // Detect browser language
    const browserLang = navigator.language.split("-")[0];

    // List of supported languages (must match i18n.js)
    const supportedLanguages = [
      "en",
      "es",
      "fr",
      "de",
      "pt",
      "ar",
      "hi",
      "zh",
      "ja",
      "ko",
      "ru",
    ];

    // Pick browser language if supported, otherwise fallback
    const languageToUse = supportedLanguages.includes(browserLang)
      ? browserLang
      : "en";

    // Check if user previously selected a language
    const storedLang = localStorage.getItem("selectedLanguage");

    // Use stored language if available, otherwise use browser language
    i18n.changeLanguage(storedLang || languageToUse);
  }, [i18n]);

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
      backAction={{ content: "Back to Home", url: "/" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Header Banner */}
            <Banner tone="info" title={t("privacyPolicyBannerTitle")}>
              <Text as="p">{t("privacyIntro")}</Text>
            </Banner>

            {/* Main Privacy Sections */}
            {sections.map((section, index) => (
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

            {/* Contact Information */}
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
