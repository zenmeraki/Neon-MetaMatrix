import React, { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  InlineStack as Stack,
  FormLayout,
  Toast,
  Frame,
  Banner,
  ButtonGroup,
  Text,
  Box,
  Divider,
  BlockStack
} from "@shopify/polaris";

import { useSuggestionForm } from "../hooks/useSuggestionForm";
import { useTranslation } from "react-i18next";

/**
 * Page component for suggestion/feedback submission
 */
const Suggestion = () => {
  const {
    email,
    setEmail,
    suggestion,
    setSuggestion,
    loading,
    error,
    success,
    handleSubmit,
    resetForm,
  } = useSuggestionForm();

  const { t, i18n } = useTranslation();

  // Toast state
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  useEffect(() => {
    // Detect browser language
    const browserLang = navigator.language.split("-")[0];
    const supportedLanguages = ["en", "es", "fr", "de", "pt", "ar", "hi", "zh", "ja", "ko", "ru"];
    const languageToUse = supportedLanguages.includes(browserLang) ? browserLang : "en";

    // If user previously selected language in localStorage, use it
    const storedLang = localStorage.getItem("selectedLanguage");

    i18n.changeLanguage(storedLang || languageToUse);
  }, [i18n]);

  // Show toast when success or error changes
  useEffect(() => {
    if (success) {
      setToastMessage(t("toastSuccessMessage"));
      setToastActive(true);
    } else if (error) {
      setToastMessage(error);
      setToastActive(true);
    }
  }, [success, error, t]);

  return (
    <Frame>
      <Page
        title={t("suggestionPageTitle")}
        subtitle={t("suggestionPageSubtitle")}
        // backAction={{ content: 'Back', url: '/' }}
      >
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              <BlockStack gap="400">

                {/* Success Banner */}
                {success && (
                  <Banner status="success" title="Thank you for your feedback!">
                    <Text as="p">
                      {t("suggestionSuccessBanner")}
                    </Text>
                  </Banner>
                )}

                {/* Main Form Card */}
                <Card>
                  <Box padding="500">
                    <BlockStack gap="400">

                      {/* Header */}
                      <BlockStack gap="200">
                        {/* <Stack gap="200" alignment="center">
                          <Text as="h2" variant="headingLg">
                            {t("suggestionPageTitle")}
                          </Text>
                        </Stack> */}
                        <Text as="p" variant="bodyMd" color="subdued">
                          {t("suggestionIntroText")}
                        </Text>
                      </BlockStack>

                      <Divider />

                      {/* Form */}
                      <FormLayout>
                        <FormLayout.Group>
                          <TextField
                            label={t("emailLabel")}
                            type="email"
                            value={email}
                            onChange={setEmail}
                            helpText={t("emailHelpText")}
                            disabled={loading}
                            error={error && error.includes("email") ? error : undefined}
                            placeholder="your.email@example.com"
                            autoComplete="email"
                          />
                        </FormLayout.Group>

                        <TextField
                          label={t("suggestionLabel")}
                          value={suggestion}
                          onChange={setSuggestion}
                          multiline={4}
                          showCharacterCount
                          maxLength={500}
                          helpText={t("suggestionHelpText")}
                          disabled={loading}
                          error={error && error.includes("suggestion") ? error : undefined}
                        />

                        <Box paddingBlockStart="400">
                          <Stack distribution="trailing" gap="300">
                            <ButtonGroup>
                              {success && (
                                <Button
                                  onClick={resetForm}
                                  disabled={loading}
                                >
                                  {t("submitAnotherButton")}
                                </Button>
                              )}
                              <Button
                                onClick={handleSubmit}
                                variant="primary"
                                loading={loading}
                                disabled={!email.trim() || !suggestion.trim()}
                              >
                                {loading ? "Submitting..." : t("submitButton")}
                              </Button>
                            </ButtonGroup>
                          </Stack>
                        </Box>
                      </FormLayout>

                    </BlockStack>
                  </Box>
                </Card>

              </BlockStack>
            </Layout.Section>
          </Layout>
        </BlockStack>

        {toastActive && (
          <Toast
            content={toastMessage}
            onDismiss={() => setToastActive(false)}
            duration={4000}
          />
        )}
      </Page>
    </Frame>
  );
};

export default Suggestion;