import React, { useState, useEffect } from "react";
import {
  Page,
  Card,
  ProgressBar,
  Text,
  BlockStack,
  InlineStack,
  Icon,
  Banner,
  SkeletonBodyText,
  Box,
  Spinner,
  Button,
} from "@shopify/polaris";
import {
  RefreshIcon,
  CheckCircleIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
import { useNavigate } from "react-router-dom";
import { authenticatedFetch } from "../hooks/useAuthenticatedFetch";

export default function ProductSyncPage({verifyStoreAccess}) {
  const navigate = useNavigate()
  const [syncStatus, setSyncStatus] = useState({
    status: "syncing",
    progress: 0,
    processedProducts: 0,
    totalProducts: 0,
    message: "Initializing sync...",
  });

  const handleGetStarted = () => {
    verifyStoreAccess()
  };

  // 🔥 POLLING API
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await authenticatedFetch(`/api/sync/product-track`);

        if (!response.ok) throw new Error("Failed to fetch");

        const data = await response.json();

        setSyncStatus({
          progress: data.progress || 0,
          processedProducts: data.processedProducts || 0,
          totalProducts: data.totalProducts || 0,
          status: data.status,
          message: data.message,
        });

        if (data.status === "completed" || data.status === "error") {
          clearInterval(pollInterval);
        }
      } catch (error) {
        // setSyncStatus((prev) => ({
        //   ...prev,
        //   status: "error",
        //   message: "Failed to sync products. Please try again.",
        // }));
        // clearInterval(pollInterval);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, []);

  const getStatusBanner = () => {
    if (syncStatus.status === "completed") {
      return (
        <Banner
          title="Sync completed successfully"
          tone="success"
          icon={CheckCircleIcon}
        >
          <p>Your products are now ready for bulk editing in Metamatrix.</p>
        </Banner>
      );
    }

    // if (syncStatus.status === "error") {
    //   return (
    //     <Banner title="Sync failed" tone="critical" icon={AlertCircleIcon}>
    //       <p>{syncStatus.message}</p>
    //     </Banner>
    //   );
    // }

    return null;
  };

  return (
    <Page title="Metamatrix" subtitle="Product Bulk Edit Platform">
      <BlockStack gap="500">
        {getStatusBanner()}

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">
                  {syncStatus.status === "syncing" && "Syncing Your Products"}
                  {syncStatus.status === "completed" && "Products Synced"}
                  {/* {syncStatus.status === "error" && "Sync Failed"} */}
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued">
                  {syncStatus.message}
                </Text>
              </BlockStack>

              {syncStatus.status === "syncing" && (
                <Box>
                  <Spinner size="small" />
                </Box>
              )}

              {syncStatus.status === "completed" && (
                <Icon source={CheckCircleIcon} tone="success" />
              )}

              {/* {syncStatus.status === "error" && (
                <Icon source={AlertCircleIcon} tone="critical" />
              )} */}
            </InlineStack>

            <BlockStack gap="300">
              <ProgressBar
                progress={syncStatus.progress}
                size="small"
                tone={"primary"}
              />

              <InlineStack align="space-between">
                <Text variant="bodySm" as="p" tone="subdued">
                  {syncStatus.processedProducts} of {syncStatus.totalProducts}{" "}
                  products processed
                </Text>
                <Text variant="bodySm" as="p" fontWeight="semibold">
                  {Math.round(syncStatus.progress)}%
                </Text>
              </InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>

        {syncStatus.status === "completed" && (
          <Card>
            <BlockStack gap="400">
              <Text variant="headingSm" as="h3">
                Ready to start editing!
              </Text>
              <Text variant="bodyMd" as="p" tone="subdued">
                Your products are now available in Metamatrix. You can start
                making bulk edits, update pricing, manage inventory, and
                streamline your product management workflow.
              </Text>
              <Box paddingBlockStart="200">
                <Button
                  variant="primary"
                  size="large"
                  onClick={handleGetStarted}
                >
                  Get Started
                </Button>
              </Box>
            </BlockStack>
          </Card>
        )}

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={RefreshIcon} tone="base" />
              <Text variant="headingSm" as="h3">
                What's happening?
              </Text>
            </InlineStack>

            <Text variant="bodyMd" as="p" tone="subdued">
              Metamatrix is importing your product catalog from Shopify. This
              process syncs all your product data including titles,
              descriptions, variants, prices, and inventory levels so you can
              edit them in bulk using our powerful platform.
            </Text>

            <BlockStack gap="200">
              <Text variant="bodySm" as="p" tone="subdued">
                • Product information and metadata
              </Text>
              <Text variant="bodySm" as="p" tone="subdued">
                • Variants and pricing
              </Text>
              <Text variant="bodySm" as="p" tone="subdued">
                • Inventory and SKUs
              </Text>
              <Text variant="bodySm" as="p" tone="subdued">
                • Images and collections
              </Text>
            </BlockStack>

            
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
