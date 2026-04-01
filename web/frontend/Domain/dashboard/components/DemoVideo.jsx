// web/frontend/domains/dashboard/components/DemoVideo.jsx
import React, { useState } from "react";
import {
  Card,
  Button,
  Text,
  BlockStack,
  InlineStack,
  Box,
  Spinner,
  Icon,
  Badge,
} from "@shopify/polaris";
import { PlayIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

/**
 * Demo video component
 * UI redesign only — functionality unchanged
 */
const DemoVideo = () => {
  const { t } = useTranslation(undefined, { i18n: appI18n });
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  const handleShowVideo = () => setShowVideo(true);

  return (
    <Box width="100%">
      {!showVideo ? (
        <Card roundedAbove="sm">
          <Box
            borderRadius="300"
            overflowX="hidden"
            overflowY="hidden"
            background="bg-surface"
          >
            <Box
              padding="0"
              style={{
                background:
                  "linear-gradient(180deg, #f6f6f7 0%, #ffffff 45%, #f6f6f7 100%)",
              }}
            >
              <Box padding="800">
                <BlockStack gap="700" inlineAlign="center">
                  {/* Top badge */}
                  <InlineStack align="center">
                    <Badge tone="info">{t("demoVideo", "Demo Video")}</Badge>
                  </InlineStack>

                  {/* Main preview panel */}
                  <Box width="100%" maxWidth="760px">
                    <Box
                      borderRadius="300"
                      padding="300"
                      background="bg-surface"
                      shadow="400"
                      borderWidth="025"
                      borderColor="border-secondary"
                      borderStyle="solid"
                    >
                      <Box
                        borderRadius="300"
                        minHeight="280px"
                        position="relative"
                        overflowX="hidden"
                        overflowY="hidden"
                        style={{
                          background:
                            "linear-gradient(135deg, #111827 0%, #1f2937 55%, #374151 100%)",
                        }}
                      >
                        {/* Decorative glow */}
                        <Box
                          style={{
                            position: "absolute",
                            top: "-40px",
                            right: "-20px",
                            width: "180px",
                            height: "180px",
                            background:
                              "radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%)",
                            pointerEvents: "none",
                          }}
                        />
                        <Box
                          style={{
                            position: "absolute",
                            bottom: "-50px",
                            left: "-20px",
                            width: "220px",
                            height: "220px",
                            background:
                              "radial-gradient(circle, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0) 72%)",
                            pointerEvents: "none",
                          }}
                        />

                        {/* Center content */}
                        <Box
                          style={{
                            minHeight: "280px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            position: "relative",
                            zIndex: 2,
                          }}
                        >
                          <BlockStack gap="400" inlineAlign="center">
                            <Box
                              background="bg-fill-brand"
                              borderRadius="full"
                              padding="500"
                              shadow="500"
                            >
                              <Icon source={PlayIcon} tone="base" />
                            </Box>

                            <BlockStack gap="100" inlineAlign="center">
                             
                              <Text variant="headingSm" as="p" tone="text-inverse">
                                {t("watchDemo", "Watch Demo")}
                              </Text>
                              
                              <Text variant="bodySm" as="p" tone="subdued">
                                {t(
                                  "watchDemoSubtext",
                                  "See the product flow in a quick guided walkthrough."
                                )}
                              </Text>
                            </BlockStack>
                          </BlockStack>
                        </Box>
                      </Box>
                    </Box>
                  </Box>

                  {/* Text */}
                  <BlockStack gap="300" inlineAlign="center">
                    <Text variant="headingXl" as="h2" alignment="center">
                      {t("watchDemoIntro")}
                    </Text>

                    <Box maxWidth="580px">
                      <Text variant="bodyLg" tone="subdued" alignment="center" as="p">
                        {t("watchDemoSubtext")}
                      </Text>
                    </Box>
                  </BlockStack>

                  {/* CTA */}
                  <InlineStack align="center" gap="300">
                     <Box paddingBlockStart="400">
                    <Button
                      variant="primary"
                      size="large"
                      icon={PlayIcon}
                      onClick={handleShowVideo}
                    >
                      {t("watchDemo")}
                    </Button>
                    </Box>
                  </InlineStack>
                </BlockStack>
              </Box>
            </Box>
          </Box>
        </Card>
      ) : (
        <Card roundedAbove="sm">
          <Box padding="500">
            <BlockStack gap="500">
              {/* Header */}
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h3">
                      {t("demoVideo")}
                    </Text>
                    <Badge tone="success">{t("playing", "Playing")}</Badge>
                  </InlineStack>

                  <Text variant="bodySm" tone="subdued" as="p">
                    {t(
                      "watchDemoSubtext",
                      "See the workflow in action through a guided demo."
                    )}
                  </Text>
                </BlockStack>

                <Button variant="plain" onClick={() => setShowVideo(false)}>
                  {t("close", "Close Video")}
                </Button>
              </InlineStack>

              {/* Video frame */}
              <Box
                borderRadius="300"
                padding="300"
                background="bg-surface-secondary"
                borderWidth="025"
                borderColor="border-secondary"
                borderStyle="solid"
              >
                <Box
                  position="relative"
                  borderRadius="300"
                  overflowX="hidden"
                  overflowY="hidden"
                  background="bg-surface"
                  style={{
                    boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
                  }}
                >
                  {!videoLoaded && (
                    <Box minHeight="450px" padding="800">
                      <InlineStack align="center" blockAlign="center">
                        <BlockStack gap="300" inlineAlign="center">
                          <Spinner size="large" />
                          <Text variant="bodyMd" tone="subdued">
                            {t("loadingVideo", "Loading video...")}
                          </Text>
                        </BlockStack>
                      </InlineStack>
                    </Box>
                  )}

                  <Box
                    style={{
                      display: videoLoaded ? "block" : "none",
                      aspectRatio: "16 / 9",
                      width: "100%",
                    }}
                  >
                    <iframe
                      width="100%"
                      height="100%"
                      src="https://www.youtube.com/embed/014uZYpNdMY?si=TWzKvsDA0TnE_gXe"
                      title={t("metamatrixDemoVideo", "Metamatrix Demo Video")}
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                      onLoad={() => setVideoLoaded(true)}
                      style={{
                        border: "none",
                        display: "block",
                        width: "100%",
                        aspectRatio: "16 / 9",
                      }}
                    />
                  </Box>
                </Box>
              </Box>

              {/* Footer actions */}
              <Box
                paddingBlockStart="100"
                borderColor="border-secondary"
              >
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodySm" tone="subdued" as="p">
                    {t("metamatrixDemoVideo", "Metamatrix Demo Video")}
                  </Text>

                  <InlineStack gap="200">
                    <Button variant="plain">
                      {t("share", "Share")}
                    </Button>
                    <Button
                      variant="secondary"
                      url="https://www.youtube.com/watch?v=014uZYpNdMY"
                      external
                    >
                      {t("watchOnYoutube")}
                    </Button>
                  </InlineStack>
                </InlineStack>
              </Box>
            </BlockStack>
          </Box>
        </Card>
      )}
    </Box>
  );
};

export default DemoVideo;
