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
  BlockStack,
  Badge,
} from "@shopify/polaris";

import { useSuggestionForm } from "../hooks/useSuggestionForm";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

/**
 * Page component for suggestion/feedback submission
 * UI redesign only — functionality unchanged
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

  const { t } = useTranslation(undefined, { i18n: appI18n });

  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

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
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {success && (
                <Banner status="success" title="Thank you for your feedback!">
                  <Text as="p">
                    {t("suggestionSuccessBanner",)}
                  </Text>
                </Banner>
              )}

              <Card roundedAbove="sm">
                <Box padding="0">
                  <BlockStack gap="0">
                    {/* Intro section */}
                    <Box
                      padding="700"
                      borderRadius="300"
                      overflowX="hidden"
                      overflowY="hidden"
                      style={{
                        background:
                          "linear-gradient(180deg, #ffffff 0%, #f8f8f8 55%, #f3f4f6 100%)",
                      }}
                    >
                      <BlockStack gap="400">
                        <BlockStack gap="200">
                          <Text as="h2" variant="headingXl">
                            {t("suggestionPageSubTitle")}
                          </Text>

                          <Box maxWidth="680px">
                            <Text as="p" variant="bodyLg" tone="subdued">
                              {t("suggestionIntroText",)}
                            </Text>
                          </Box>
                        </BlockStack>

                        <Box
                          padding="400"
                          borderRadius="300"
                          background="bg-surface"
                          borderWidth="025"
                          borderStyle="solid"
                          borderColor="border-secondary"
                        >
                          <Stack
                            align="space-between"
                            blockAlign="center"
                            gap="400"
                          >
                            <BlockStack gap="100">
                              <Text as="h3" variant="headingSm">
                                {t("feedbackMiniTitle",)}
                              </Text>
                              <Text as="p" variant="bodyMd" tone="subdued">
                                {t("feedbackMiniText",)}
                              </Text>
                            </BlockStack>

                            <Badge tone="success">
                              {t("feedbackQuickLabel",)}
                            </Badge>
                          </Stack>
                        </Box>
                      </BlockStack>
                    </Box>

                    <Divider />

                    {/* Form section */}
                    <Box padding="700">
                      <Box maxWidth="760px">
                        <BlockStack gap="500">
                          <BlockStack gap="150">
                            <Box paddingBlockStart="400">
                              <Text as="h3" variant="headingLg">
                                {t("formHeaderTitle",)}
                              </Text>
                            </Box>
                            <Text as="p" variant="bodyMd" tone="subdued">
                              {t("formHeaderText",)}
                            </Text>
                          </BlockStack>

                          <FormLayout>
                            <BlockStack gap="200">
                              <Text as="label" variant="bodyLg" fontWeight="bold">
                                {t("emailLabel")}
                              </Text>
                              <TextField
                                label={t("emailLabel")}
                                type="email"
                                labelHidden
                                value={email}
                                onChange={setEmail}
                                helpText={t("emailHelpText",)}
                                disabled={loading}
                                error={
                                  error && error.includes("email")
                                    ? error
                                    : undefined
                                }
                                placeholder="your.email@example.com"
                                autoComplete="email"
                              />
                            </BlockStack>


                            <BlockStack gap="200">
                              <Text as="label" variant="bodyLg" fontWeight="bold">
                                {t("suggestionLabel",)}
                              </Text>

                              <TextField
                                label={t("suggestionLabel",)}
                                labelHidden
                                value={suggestion}
                                onChange={setSuggestion}
                                multiline={6}
                                showCharacterCount
                                maxLength={500}
                                helpText={t("suggestionHelpText", {
                                  defaultValue: "Max 500 characters.",
                                })}
                                disabled={loading}
                                error={
                                  error && error.includes("suggestion")
                                    ? error
                                    : undefined
                                }
                                placeholder={t("suggestionPlaceholder",)}
                              />
                            </BlockStack>
                            <Box
                              padding="350"
                              borderRadius="200"
                              background="bg-surface-secondary"
                            >
                              <Text as="p" variant="bodySm" tone="subdued">
                                {t("feedbackHint",)}
                              </Text>
                            </Box>

                            <Box paddingBlockStart="200">
                              <Stack align="space-between" blockAlign="center">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {t("feedbackFooterNote",)}
                                </Text>

                                <ButtonGroup>
                                  {success && (
                                    <Button
                                      onClick={resetForm}
                                      disabled={loading}
                                    >
                                      {t("submitAnotherButton", )}
                                    </Button>
                                  )}

                                  <Button
                                    onClick={handleSubmit}
                                    variant="primary"
                                    loading={loading}
                                    disabled={
                                      !email.trim() || !suggestion.trim()
                                    }
                                  >
                                    {loading
                                      ? "Submitting..."
                                      : t("submitButton",)}
                                  </Button>
                                </ButtonGroup>
                              </Stack>
                            </Box>
                          </FormLayout>
                        </BlockStack>
                      </Box>
                    </Box>
                  </BlockStack>
                </Box>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

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