import React, { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  ProgressBar,
  SkeletonBodyText,
  SkeletonDisplayText,
  Text,
} from "@shopify/polaris";
import { ArrowDownIcon } from "@shopify/polaris-icons";

function getNormalizedExportType(item) {
  return String(item?.rawType || item?.type || "").trim().toLowerCase();
}

function getPrimaryStatus(item) {
  const statusKey = String(
    item?.primaryStatus?.key || item?.status || "pending",
  ).toLowerCase();

  if (statusKey === "completed") {
    return { key: "completed", label: "Completed", tone: "success", isTerminal: true };
  }
  if (statusKey === "failed") {
    return { key: "failed", label: "Failed", tone: "critical", isTerminal: true };
  }
  if (statusKey === "processing") {
    return { key: "processing", label: "Processing", tone: "info", isTerminal: false };
  }

  return { key: "pending", label: "Pending", tone: "attention", isTerminal: false };
}

function getProgressValue(item, primaryStatus) {
  const explicitProgress = Number(
    item?.progressPercent ?? item?.progressSummary?.percent,
  );

  if (Number.isFinite(explicitProgress) && explicitProgress > 0) {
    return Math.max(0, Math.min(100, explicitProgress));
  }

  if (primaryStatus.key === "completed") {
    return 100;
  }

  const processedCount = Number(item?.processedCount ?? 0);
  const totalItems = Number(
    item?.targetSnapshotCount ?? item?.totalItems ?? 0,
  );

  if (totalItems > 0) {
    return Math.max(
      0,
      Math.min(100, Math.round((processedCount / totalItems) * 100)),
    );
  }

  return 0;
}

const ExportTable = ({ selectedType = "Manual export", onExportSuccess, onExportError }) => {
  const [histories, setHistories] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [downloadingItems, setDownloadingItems] = useState(new Set());

  useEffect(() => {
    let isMounted = true;

    const fetchHistories = async ({ silent = false } = {}) => {
      try {
        if (!silent) {
          setHistoryLoading(true);
        }
        setHistoryError(null);

        const res = await fetch("/api/history/get-shop-exporthistory?");
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.message || "Failed to fetch export history");
        }

        if (isMounted) {
          setHistories(data.data || []);
        }
      } catch (error) {
        if (isMounted) {
          setHistoryError(error);
        }
      } finally {
        if (isMounted && !silent) {
          setHistoryLoading(false);
        }
      }
    };

    fetchHistories();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const hasActiveHistory = histories.some(
      (item) => getPrimaryStatus(item).isTerminal !== true,
    );

    if (!hasActiveHistory) return undefined;

    let isFetching = false;

    const interval = setInterval(async () => {
      if (document.hidden || isFetching) {
        return;
      }

      isFetching = true;
      try {
        const res = await fetch("/api/history/get-shop-exporthistory?");
        const data = await res.json();
        if (res.ok && data.success) {
          setHistories(data.data || []);
        }
      } catch {
        // Keep polling silent while a run is active.
      } finally {
        isFetching = false;
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [histories]);

  const filteredHistories = useMemo(() => {
    const normalizedSelectedType = String(selectedType).trim().toLowerCase();

    return histories.filter(
      (item) => getNormalizedExportType(item) === normalizedSelectedType,
    );
  }, [histories, selectedType]);

  const handleDownloadClick = async (id, fileUrl, filename) => {
    if (!fileUrl) {
      onExportError?.("Download link not available.");
      return;
    }

    setDownloadingItems((prev) => new Set(prev).add(id));

    try {
      const link = document.createElement("a");
      link.href = fileUrl;
      link.download = filename || "export.csv";
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      link.remove();

      onExportSuccess?.();
    } catch {
      onExportError?.("Failed to download file.");
    } finally {
      setDownloadingItems((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const renderTimeCell = (item) => {
    const primaryStatus = getPrimaryStatus(item);
    const dateString = item.completedAt || item.createdAt;

    if (!primaryStatus.isTerminal) {
      return (
        <Text as="span" variant="bodySm" tone="subdued">
          {primaryStatus.detail || "In progress"}
        </Text>
      );
    }

    if (!dateString) {
      return (
        <Text as="span" variant="bodySm" tone="subdued">
          -
        </Text>
      );
    }

    return (
      <Text as="span" variant="bodySm" tone="subdued">
        {new Date(dateString).toLocaleString()}
      </Text>
    );
  };

  const historyRowMarkup = useMemo(
    () =>
      filteredHistories.map((item, index) => {
        const id = item.id || item._id;
        const primaryStatus = getPrimaryStatus(item);
        const filename = item.filename || "Untitled export";
        const isDownloading = downloadingItems.has(id);
        const isDownloadable = primaryStatus.key === "completed" && Boolean(item.fileUrl);
        const progress = getProgressValue(item, primaryStatus);
        const progressLabel = item?.progressSummary?.label || primaryStatus.label;
        const supportDetail =
          item?.supportStatus?.failureStage || primaryStatus.detail || null;

        return (
          <IndexTable.Row id={id} key={id} position={index}>
            <IndexTable.Cell>
              <BlockStack gap="100">
                <Text variant="bodyMd" as="span" fontWeight="semibold">
                  {filename}
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {id}
                </Text>
              </BlockStack>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <BlockStack gap="100">
                <div style={{ minWidth: "120px" }}>
                  <ProgressBar
                    progress={progress}
                    size="small"
                    tone={primaryStatus.key === "failed" ? "critical" : primaryStatus.key === "partial" ? "warning" : "highlight"}
                  />
                </div>
                <Text as="span" variant="bodySm" tone="subdued">
                  {progressLabel}
                </Text>
              </BlockStack>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <Text as="span" variant="bodyMd">
                {item.type || "-"}
              </Text>
            </IndexTable.Cell>

            <IndexTable.Cell>
              <BlockStack gap="100">
                <Badge tone={primaryStatus.tone}>{primaryStatus.label}</Badge>
                {supportDetail ? (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {supportDetail}
                  </Text>
                ) : null}
              </BlockStack>
            </IndexTable.Cell>

            <IndexTable.Cell>{renderTimeCell(item)}</IndexTable.Cell>

            <IndexTable.Cell>
              <Button
                icon={isDownloading ? undefined : ArrowDownIcon}
                disabled={!isDownloadable || isDownloading}
                loading={isDownloading}
                variant="plain"
                onClick={() => handleDownloadClick(id, item.fileUrl, filename)}
              >
                {isDownloading ? "Downloading..." : "Download"}
              </Button>
            </IndexTable.Cell>
          </IndexTable.Row>
        );
      }),
    [downloadingItems, filteredHistories],
  );

  if (historyLoading) {
    return (
      <Card>
        <BlockStack gap="400">
          <SkeletonDisplayText size="small" />
          <SkeletonBodyText lines={8} />
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card padding="0">
      <BlockStack gap="0">
        <Box padding="400" borderBlockEndWidth="1" borderColor="border">
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h3" variant="headingSm">
                Generated exports
              </Text>
              <Text as="p" tone="subdued" variant="bodySm">
                Download completed files and review recent export activity.
              </Text>
            </BlockStack>
            <Text as="span" tone="subdued" variant="bodySm">
              {filteredHistories.length} items
            </Text>
          </InlineStack>
        </Box>

        {historyError && (
          <Box padding="400" borderBlockEndWidth="1" borderColor="border">
            <Banner tone="critical">
              <Text as="p">{historyError.message || "Failed to load export history."}</Text>
            </Banner>
          </Box>
        )}

        {filteredHistories.length === 0 ? (
          <Box padding="1200">
            <EmptyState heading="No exports yet">
              <p>Completed export files will appear here once a CSV has been generated.</p>
            </EmptyState>
          </Box>
        ) : (
          <IndexTable
            resourceName={{ singular: "export", plural: "exports" }}
            itemCount={filteredHistories.length}
            selectable={false}
            headings={[
              { title: "Title" },
              { title: "Progress" },
              { title: "Type" },
              { title: "Status" },
              { title: "Export time" },
              { title: "Actions" },
            ]}
          >
            {historyRowMarkup}
          </IndexTable>
        )}
      </BlockStack>
    </Card>
  );
};

export default ExportTable;
