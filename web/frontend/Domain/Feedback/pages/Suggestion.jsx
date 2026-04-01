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
        title={t("suggestionPageTitle", {
          defaultValue: "We Value Your Feedback",
        })}
        subtitle={t("suggestionPageSubtitle", {
          defaultValue:
            "Help us improve with thoughtful suggestions and product feedback.",
        })}
      >
        <Layout>
          <Layout.Section>
            <BlockStack gap="500">
              {success && (
                <Banner status="success" title="Thank you for your feedback!">
                  <Text as="p">
                    {t("suggestionSuccessBanner", {
                      defaultValue:
                        "Thank you for your feedback! We appreciate your input.",
                    })}
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
                          <Text as="h2" variant="heading2xl">
                            {t("suggestionPageTitle", {
                              defaultValue: "We Value Your Feedback",
                            })}
                          </Text>

                          <Box maxWidth="680px">
                            <Text as="p" variant="bodyLg" tone="subdued">
                              {t("suggestionIntroText", {
                                defaultValue:
                                  "Help us improve the experience by sharing ideas, product suggestions, or issues you have noticed. Clear feedback helps us build a stronger app.",
                              })}
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
                                {t("feedbackMiniTitle", {
                                  defaultValue: "What to include",
                                })}
                              </Text>
                              <Text as="p" variant="bodyMd" tone="subdued">
                                {t("feedbackMiniText", {
                                  defaultValue:
                                    "Tell us what you expected, what you experienced, and what would make the workflow better.",
                                })}
                              </Text>
                            </BlockStack>

                            <Badge tone="success">
                              {t("feedbackQuickLabel", {
                                defaultValue: "Reviewed by team",
                              })}
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
                              {t("formHeaderTitle", {
                                defaultValue: "Send your suggestion",
                              })}
                            </Text>
                            </Box>
                            <Text as="p" variant="bodyMd" tone="subdued">
                              {t("formHeaderText", {
                                defaultValue:
                                  "We read submissions carefully and use them to improve the product experience.",
                              })}
                            </Text>
                          </BlockStack>

                          <FormLayout>
                            <TextField
                              label={t("emailLabel", {
                                defaultValue: "Your Email",
                              })}
                              type="email"
                              value={email}
                              onChange={setEmail}
                              helpText={t("emailHelpText", {
                                defaultValue:
                                  "We'll only use this to reach out for clarification.",
                              })}
                              disabled={loading}
                              error={
                                error && error.includes("email")
                                  ? error
                                  : undefined
                              }
                              placeholder="your.email@example.com"
                              autoComplete="email"
                            />

                            <TextField
                              label={t("suggestionLabel", {
                                defaultValue: "Your Suggestion",
                              })}
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
                              placeholder={t("suggestionPlaceholder", {
                                defaultValue:
                                  "Describe your idea, improvement, or issue in a clear and concise way...",
                              })}
                            />

                            <Box
                              padding="350"
                              borderRadius="200"
                              background="bg-surface-secondary"
                            >
                              <Text as="p" variant="bodySm" tone="subdued">
                                {t("feedbackHint", {
                                  defaultValue:
                                    "The most useful feedback is specific, brief, and focused on one clear improvement.",
                                })}
                              </Text>
                            </Box>

                            <Box paddingBlockStart="200">
                              <Stack align="space-between" blockAlign="center">
                                <Text as="p" variant="bodySm" tone="subdued">
                                  {t("feedbackFooterNote", {
                                    defaultValue:
                                      "Every meaningful submission is reviewed.",
                                  })}
                                </Text>

                                <ButtonGroup>
                                  {success && (
                                    <Button
                                      onClick={resetForm}
                                      disabled={loading}
                                    >
                                      {t("submitAnotherButton", {
                                        defaultValue: "Submit Another",
                                      })}
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
                                      : t("submitButton", {
                                          defaultValue: "Submit Suggestion",
                                        })}
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