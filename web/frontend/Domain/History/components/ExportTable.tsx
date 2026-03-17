// web/frontend/Domain/History/components/ExportTable.js

import React, { useEffect, useMemo, useState } from "react";
import {
  Card,
  IndexTable,
  Text,
  Badge,
  ProgressBar,
  Button,
  EmptyState,
  Banner,
  Spinner,
  InlineStack,
  Box,
} from "@shopify/polaris";
import { ArrowDownIcon } from "@shopify/polaris-icons";
import { t } from "i18next";

const ExportTable = ({ onExportSuccess, onExportError }) => {
  const [histories, setHistories] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(null);
  const [downloadingItems, setDownloadingItems] = useState(new Set());

  // ✅ Fetch histories directly
  useEffect(() => {
    const fetchHistories = async () => {
      try {
        setHistoryLoading(true);
        const res = await fetch("/api/history/get-shop-exporthistory?");
        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.message || "Failed to fetch export history");
        }

        setHistories(data.data || []);
      } catch (error) {
        setHistoryError(error);
      } finally {
        setHistoryLoading(false);
      }
    };

    fetchHistories();
  }, []);

  // ——— Helpers ———

  const badgeStatusForStatus = (status) => {
    if (!status) return "attention";

    switch (status.toLowerCase()) {
      case "completed":
        return "success";
      case "failed":
        return "critical";
      case "processing":
        return "info";
      default:
        return "attention";
    }
  };

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
    } catch (error) {
      onExportError?.("Failed to download file.");
    } finally {
      setDownloadingItems((prev) => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  };

  const renderTimeCell = (dateString, status) => {
    const lower = status?.toLowerCase();

    if (lower === "processing") {
      return (
        <InlineStack align="center" gap="200">
          <Spinner size="small" />
          <Text as="span" variant="bodySm" tone="subdued">
            Processing…
          </Text>
        </InlineStack>
      );
    }

    if (!dateString) {
      return (
        <Text as="span" variant="bodySm" tone="subdued">
          —
        </Text>
      );
    }

    const date = new Date(dateString);
    return (
      <Text as="span" variant="bodySm" tone="subdued">
        {date.toLocaleString()}
      </Text>
    );
  };

  // ——— Table Rows ———

  const historyRowMarkup = useMemo(() => {
    return histories.map((item, index) => {
      const {
        _id,
        filename,
        status,
        type,
        completedAt,
        createdAt,
        fileUrl,
      } = item;

      const isDownloading = downloadingItems.has(_id);

      const isDownloadable =
        status?.toLowerCase() === "completed" && !!fileUrl;

      const progress =
        status?.toLowerCase() === "completed" ? 100 : 0;

      return (
        <IndexTable.Row id={_id} key={_id} position={index}>
          <IndexTable.Cell>
            <Text variant="bodyMd" as="span" fontWeight="semibold">
              {filename || "Untitled Export"}
            </Text>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <div style={{ width: "120px" }}>
              <ProgressBar
                progress={progress}
                size="small"
                tone={
                  status?.toLowerCase() === "failed"
                    ? "critical"
                    : "highlight"
                }
              />
            </div>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Text as="span" variant="bodyMd">
              {type || "—"}
            </Text>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Badge tone={badgeStatusForStatus(status)}>
              {status || "Unknown"}
            </Badge>
          </IndexTable.Cell>

          <IndexTable.Cell>
            {renderTimeCell(completedAt || createdAt, status)}
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Button
              icon={isDownloading ? undefined : ArrowDownIcon}
              disabled={!isDownloadable || isDownloading}
              loading={isDownloading}
              variant="plain"
              onClick={() =>
                handleDownloadClick(_id, fileUrl, filename)
              }
            >
              {isDownloading ? "Downloading..." : "Download"}
            </Button>
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    });
  }, [histories, downloadingItems]);

  // ——— Render ———

  const emptyStateMarkup = (
    <EmptyState
      heading="You have no export history"
      image="https://cdn.shopify.com/s/files/1/0262/4074/files/emptystate-files.png"
    >
      <Text as="p" variant="bodyMd">
        Export operations will appear here once completed.
      </Text>
    </EmptyState>
  );

  return (
    <Box>
      <Card>
        {historyError && (
          <Box padding="400">
            <Banner tone="critical">
              <Text as="p">
                {historyError.message ||
                  "Failed to load export history."}
              </Text>
            </Banner>
          </Box>
        )}

        <IndexTable
          resourceName={{ singular: "export", plural: "exports" }}
          itemCount={histories.length}
          selectable={false}
          headings={[
            { title: "Title" },
            { title: "Progress" },
            { title: "Type" },
            { title: "Status" },
            { title: "Export Time" },
            { title: "Actions" },
          ]}
          loading={historyLoading}
          emptyState={
            histories.length === 0 && !historyLoading
              ? emptyStateMarkup
              : null
          }
        >
          {historyRowMarkup}
        </IndexTable>
      </Card>
    </Box>
  );
};

export default ExportTable;
