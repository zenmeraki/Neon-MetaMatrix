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
import "./DemoVideo.css";

const DEMO_VIDEO_ID = "014uZYpNdMY";
const DEMO_VIDEO_EMBED_URL = `https://www.youtube-nocookie.com/embed/${DEMO_VIDEO_ID}?rel=0`;
const DEMO_VIDEO_WATCH_URL = `https://www.youtube.com/watch?v=${DEMO_VIDEO_ID}`;

const DemoVideo = () => {
  const { t } = useTranslation();
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  const handleShowVideo = () => setShowVideo(true);
  const handleCloseVideo = () => {
    setShowVideo(false);
    setVideoLoaded(false);
  };

  const handleShareVideo = async () => {
    const shareTitle = t("metamatrixDemoVideo", "Metamatrix Demo Video");

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          url: DEMO_VIDEO_WATCH_URL,
        });
        return;
      }

      await navigator.clipboard.writeText(DEMO_VIDEO_WATCH_URL);
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
      }
    }
  };

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
            <Box padding="0" className="DemoVideo__shell">
              <Box padding="800">
                <BlockStack gap="700" inlineAlign="center">
                  <InlineStack align="center">
                    <Badge tone="info">{t("demoVideo", "Demo Video")}</Badge>
                  </InlineStack>

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
                        className="DemoVideo__preview"
                      >
                        <Box className="DemoVideo__previewContent">
                          <BlockStack gap="400" inlineAlign="center">
                            <Box
                              background="bg-fill-brand"
                              borderRadius="full"
                              padding="500"
                              shadow="500"
                            >
                              <Icon source={PlayIcon} />
                            </Box>

                            <BlockStack gap="100" inlineAlign="center">
                              <Text
                                variant="headingSm"
                                as="p"
                                tone="text-inverse"
                              >
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

                  <BlockStack gap="300" inlineAlign="center">
                    <Text variant="headingXl" as="h2" alignment="center">
                      {t("watchDemoIntro")}
                    </Text>

                    <Box maxWidth="580px">
                      <Text
                        variant="bodyLg"
                        tone="subdued"
                        alignment="center"
                        as="p"
                      >
                        {t("watchDemoSubtext")}
                      </Text>
                    </Box>
                  </BlockStack>

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
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text variant="headingMd" as="h3">
                      {t("demoVideo")}
                    </Text>
                    <Badge tone="success">{t("playing")}</Badge>
                  </InlineStack>

                  <Text variant="bodySm" tone="subdued" as="p">
                    {t(
                      "watchDemoSubtext",
                      "See the workflow in action through a guided demo."
                    )}
                  </Text>
                </BlockStack>

                <Button variant="plain" onClick={handleCloseVideo}>
                  {t("close", "Close Video")}
                </Button>
              </InlineStack>

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
                  className="DemoVideo__playerFrame"
                >
                  <Box className="DemoVideo__aspect">
                    {!videoLoaded && (
                      <Box
                        position="absolute"
                        insetBlockStart="0"
                        insetInlineStart="0"
                        width="100%"
                        minHeight="100%"
                        padding="800"
                        background="bg-surface"
                        className="DemoVideo__loadingOverlay"
                      >
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

                    <iframe
                      width="100%"
                      height="100%"
                      src={DEMO_VIDEO_EMBED_URL}
                      title={t("metamatrixDemoVideo", "Metamatrix Demo Video")}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      allowFullScreen
                      onLoad={() => setVideoLoaded(true)}
                      className="DemoVideo__iframe"
                    />
                  </Box>
                </Box>
              </Box>

              <Box paddingBlockStart="100" borderColor="border-secondary">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="bodySm" tone="subdued" as="p">
                    {t("metamatrixDemoVideo", "Metamatrix Demo Video")}
                  </Text>

                  <InlineStack gap="200">
                    <Button variant="plain" onClick={handleShareVideo}>
                      {t("share", "Share")}
                    </Button>
                    <Button
                      variant="secondary"
                      url={DEMO_VIDEO_WATCH_URL}
                      external
                      accessibilityLabel={t(
                        "watchOnYoutubeAccessibilityLabel",
                        "Watch Metamatrix demo video on YouTube"
                      )}
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
