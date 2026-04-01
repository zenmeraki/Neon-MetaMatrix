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
} from "@shopify/polaris";
import { PlayIcon } from "@shopify/polaris-icons";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";
import { openTopLevelUrl } from "../../../utils/embeddedNavigation";

/**
 * Demo video component (Polaris 13 design + simplified logic)
 */
const DemoVideo = () => {
  const { t } = useTranslation(undefined, { i18n: appI18n });
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [showVideo, setShowVideo] = useState(false);

  const handleShowVideo = () => setShowVideo(true);

  return (
    <Box width="100%">
      {!showVideo ? (
        <Card>
          <Box padding="800">
            <BlockStack gap="500" inlineAlign="center">
              {/* Thumbnail placeholder */}
              <Box
                background="bg-surface-secondary"
                borderRadius="300"
                padding="600"
                minHeight="200px"
                width="100%"
              >
                <InlineStack align="center" blockAlign="center">
                  <Box background="bg-fill-info" borderRadius="100" padding="400">
                    <Icon source={PlayIcon} tone="info" />
                  </Box>
                </InlineStack>
              </Box>

              {/* Content */}
              <BlockStack gap="300" inlineAlign="center">
                <Text variant="headingSm" as="h3" alignment="center">
                  {t("watchDemoIntro", )}
                </Text>
                <Text variant="bodyMd" tone="subdued" alignment="center">
                  {t("watchDemoSubtext", )}
                </Text>
              </BlockStack>

              {/* CTA button */}
              <Box paddingBlockStart="400">
                <Button
                  variant="primary"
                  size="large"
                  icon={PlayIcon}
                  onClick={handleShowVideo}
                >
                  {t("watchDemo" )}
                </Button>
              </Box>
            </BlockStack>
          </Box>
        </Card>
      ) : (
        <Card>
          <Box padding="400">
            <BlockStack gap="400">
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  {t("demoVideo")}
                </Text>
               
              </BlockStack>

              {/* Video container */}
              <Box
                background="bg-surface-secondary"
                borderRadius="200"
                padding="200"
                position="relative"
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
                    aspectRatio: "16/9",
                    width: "100%",
                    maxWidth: "700px",
                    margin: "0 auto",
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
                      borderRadius: "8px",
                      border: "none",
                    }}
                  />
                </Box>
              </Box>

              {/* Actions */}
              <InlineStack align="space-between">
                <Button variant="plain" onClick={() => setShowVideo(false)}>
                  {t("close", "Close Video")}
                </Button>
                <InlineStack gap="200">
                  <Button variant="plain">{t("share", "Share")}</Button>
                  <Button
                    variant="plain"
                    onClick={() =>
                      openTopLevelUrl("https://www.youtube.com/watch?v=014uZYpNdMY")
                    }
                  >
                    {t("watchOnYoutube")}
                  </Button>
                </InlineStack>
              </InlineStack>
            </BlockStack>
          </Box>
        </Card>
      )}
    </Box>
  );
};

export default DemoVideo;
