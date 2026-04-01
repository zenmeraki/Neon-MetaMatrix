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
import { i18n as appI18n } from "../../../utils/i18nUtils";

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

  const { t } = useTranslation(undefined, { i18n: appI18n });

  // Toast state
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

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
        title={t("suggestionPageTitle", { defaultValue: "We Value Your Feedback" })}
        subtitle={t("suggestionPageSubtitle", {
          defaultValue: "Help us improve! Share your thoughts and suggestions.",
        })}
        // backAction={{ content: 'Back', url: '/' }}
      >
        <BlockStack gap="500">
          <Layout>
            <Layout.Section>
              <BlockStack gap="400">

                {/* Success Banner */}
                {success && (
                  <Banner
                    tone="success"
                    title={t("suggestionSuccessBanner", {
                      defaultValue: "Thank you for your feedback!",
                    })}
                  >
                    <Text as="p">
                      {t("suggestionSuccessBanner", {
                        defaultValue: "Thank you for your feedback! We appreciate your input.",
                      })}
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
                        <Text as="p" variant="bodyMd" tone="subdued">
                          {t("suggestionIntroText", {
                            defaultValue:
                              "Your feedback is invaluable to us! Share your suggestions, ideas, or any issues you've encountered, and we'll do our best to improve the app experience.",
                          })}
                        </Text>
                      </BlockStack>

                      <Divider />

                      {/* Form */}
                      <FormLayout>
                        <FormLayout.Group>
                          <TextField
                            label={t("emailLabel", { defaultValue: "Your Email" })}
                            type="email"
                            value={email}
                            onChange={setEmail}
                            helpText={t("emailHelpText", {
                              defaultValue: "We'll only use this to reach out for clarification.",
                            })}
                            disabled={loading}
                            error={error && error.includes("email") ? error : undefined}
                            placeholder="your.email@example.com"
                            autoComplete="email"
                          />
                        </FormLayout.Group>

                        <TextField
                          label={t("suggestionLabel", { defaultValue: "Your Suggestion" })}
                          value={suggestion}
                          onChange={setSuggestion}
                          multiline={4}
                          showCharacterCount
                          maxLength={500}
                          helpText={t("suggestionHelpText", {
                            defaultValue: "Max 500 characters.",
                          })}
                          disabled={loading}
                          error={error && error.includes("suggestion") ? error : undefined}
                        />

                        <Box paddingBlockStart="400">
                          <Stack align="end" gap="300">
                            <ButtonGroup>
                              {success && (
                                <Button
                                  onClick={resetForm}
                                  disabled={loading}
                                >
                                  {t("submitAnotherButton", { defaultValue: "Submit Another" })}
                                </Button>
                              )}
                              <Button
                                onClick={handleSubmit}
                                variant="primary"
                                loading={loading}
                                disabled={!email.trim() || !suggestion.trim()}
                              >
                                {loading
                                  ? "Submitting..."
                                  : t("submitButton", { defaultValue: "Submit Suggestion" })}
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
