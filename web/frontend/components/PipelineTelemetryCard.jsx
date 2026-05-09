import React, { memo, useMemo } from "react";
import { Badge, BlockStack, Box, Card, InlineStack, Text } from "@shopify/polaris";
import {
  formatTelemetryEta,
  formatTelemetryNumber,
  formatTelemetryPercent,
  formatTelemetryThroughput,
  getApiHealthTone,
  getSafetyShieldBadges,
  normalizeTelemetryPhase,
} from "../utils/pipelineTelemetry";

function buildAsciiBar(percent, width = 16) {
  const normalized = Math.max(0, Math.min(100, Number(percent || 0)));
  const filled = Math.round((normalized / 100) * width);
  const empty = Math.max(0, width - filled);
  return `${"\u2588".repeat(filled)}${"\u2591".repeat(empty)}`;
}

const PipelineTelemetryCard = memo(function PipelineTelemetryCard({
  telemetry = null,
  title = "Pipeline Telemetry",
}) {
  const asciiBar = useMemo(
    () => buildAsciiBar(telemetry?.percent ?? 0),
    [telemetry?.percent],
  );

  if (!telemetry) return null;

  return (
    <Card>
      <BlockStack gap="200">
        <Text as="h3" variant="headingSm">
          {title}
        </Text>

        <Text as="p" variant="headingMd">
          {normalizeTelemetryPhase(telemetry.phase)}
        </Text>

        <Box background="bg-surface-secondary" borderRadius="200" padding="200">
          <Text as="p" variant="bodyMd" fontWeight="medium">
            {asciiBar}
          </Text>
        </Box>

        <Text as="p" variant="bodyMd">
          {formatTelemetryPercent(telemetry.percent)}
        </Text>

        <Text as="p" variant="bodySm" tone="subdued">
          {`${formatTelemetryNumber(telemetry.processedProducts)} / ${formatTelemetryNumber(
            telemetry.totalProducts,
          )} products processed`}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {`${formatTelemetryNumber(telemetry.variantsUpdated)} variants updated`}
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          {`ETA: ${formatTelemetryEta(telemetry.etaLabel)} • Current throughput: ${formatTelemetryThroughput(
            telemetry.throughputPerSecond,
          )} updates/sec`}
        </Text>

        <InlineStack gap="150" wrap>
          <Badge tone={getApiHealthTone(telemetry.shopifyApiHealth)}>
            {`Shopify API Health: ${telemetry.shopifyApiHealth || "UNKNOWN"}`}
          </Badge>
          <Badge>{`Retry Queue: ${telemetry.retryQueue ?? 0}`}</Badge>
          <Badge tone={Number(telemetry.failedItems || 0) > 0 ? "warning" : "success"}>
            {`Failed Items: ${telemetry.failedItems ?? 0}`}
          </Badge>
          <Badge tone={telemetry.undoSnapshot === "VERIFIED" ? "success" : "attention"}>
            {`Undo Snapshot: ${telemetry.undoSnapshot || "N/A"}`}
          </Badge>
          <Badge tone={telemetry.mirrorConsistency === "SAFE" ? "success" : "warning"}>
            {`Mirror Consistency: ${telemetry.mirrorConsistency || "UNKNOWN"}`}
          </Badge>
        </InlineStack>

        <InlineStack gap="150" wrap>
          {getSafetyShieldBadges(telemetry).map((badge) => (
            <Badge key={badge.label} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
        </InlineStack>

        {Array.isArray(telemetry.activityStream) && telemetry.activityStream.length > 0 ? (
          <Box background="bg-surface-secondary" borderRadius="200" padding="200">
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" fontWeight="medium">
                What's Happening Right Now
              </Text>
              {telemetry.activityStream.slice(0, 6).map((entry, index) => (
                <Text key={`${entry?.text || "activity"}-${index}`} as="p" variant="bodySm" tone="subdued">
                  {`\u2713 ${entry?.text || "Event recorded"}`}
                </Text>
              ))}
            </BlockStack>
          </Box>
        ) : null}

        {telemetry?.confidence ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {`Execution Confidence: ${telemetry.confidence.score}%${
              telemetry.confidence.reasons?.length
                ? ` • ${telemetry.confidence.reasons.join(" • ")}`
                : ""
            }`}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
});

export default PipelineTelemetryCard;
