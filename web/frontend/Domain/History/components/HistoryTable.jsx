// web/frontend/domains/history/components/HistoryTable.jsx
import React, { memo, useCallback, useEffect, useState } from "react";
import { Eye, RotateCw } from "lucide-react";
import {
  DataTable,
  Badge,
  Button,
  ButtonGroup,
  Spinner,
  InlineStack,
  BlockStack,
  Text,
  Box,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import AlertUndo from "../../products/edit/components/AlertUndo";
import { useNavigate } from "react-router-dom";

const COLUMN_WIDTHS = {
  title: "320px",
};

const HistoryTable = memo(
  ({
    histories,
    isLoading,
    isLoadingMore,
    hasMore,
    onLoadMore,
    onCancelEdit,
    onRepeatEdit,
    emptyStateMessage = "No history items found.",
  }) => {
    const [open, setOpen] = useState(false);
    const [historyItem, setHistoryItem] = useState(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [showUndoModal, setShowUndoModal] = useState(false);
    const [undoLoading, setUndoLoading] = useState(false);
    const [undoHistoryItem, setUndoHistoryItem] = useState(null);
    const [localHistories, setLocalHistories] = useState(histories);
    const { t } = useTranslation();
    const navigate = useNavigate();

    const handleCloseDetails = useCallback(() => setOpen(false), []);
    const handleRepeatEdit = useCallback(
      (id) => onRepeatEdit(id),
      [onRepeatEdit],
    );
    const handleCancelEdit = useCallback(
      (id) => onCancelEdit(id),
      [onCancelEdit],
    );

    /**
     * Determines the display status based on edit and undo statuses
     * Priority: undo status > edit status
     */
    const getDisplayStatus = (item) => {
      const { status, undo } = item;

      // If undo is in progress or completed, show undo status
      if (undo?.status && undo.status !== "idle") {
        switch (undo.status) {
          case "pending":
          case "processing":
            return "undo_processing";
          case "completed":
            return "undo_completed";
          case "failed":
            return "undo_failed";
          default:
            return status;
        }
      }

      // Otherwise show the edit status
      return status;
    };

    /**
     * Renders status badge with appropriate styling
     */
    const renderStatusBadge = (item) => {
      const displayStatus = getDisplayStatus(item);
      let tone = "attention";
      let label = displayStatus;

      switch (displayStatus) {
        case "completed":
          tone = "success";
          label = t("completed") || "Completed";
          break;
        case "failed":
          tone = "critical";
          label = t("failed") || "Failed";
          break;
        case "processing":
          tone = "info";
          label = t("processing") || "Processing";
          break;
        case "pending":
          tone = "attention";
          label = t("pending") || "Pending";
          break;
        case "undo_processing":
          tone = "warning";
          label = t("undoProcessing") || "Undoing...";
          break;
        case "undo_completed":
          tone = "subdued";
          label = t("undoCompleted") || "Undone";
          break;
        case "undo_failed":
          tone = "critical";
          label = t("undoFailed") || "Undo Failed";
          break;
        default:
          tone = "attention";
          label = t(displayStatus) || displayStatus;
      }

      return (
        <Box minWidth="140px" textAlign="start">
          <Badge tone={tone}>{label}</Badge>
        </Box>
      );
    };

    /**
     * Determines if undo action is allowed for the item
     */
    const canUndo = (item) => {
      const { status, undo } = item;

      // Undo is allowed only if:
      // 1. Edit is completed
      // 2. Undo is allowed in the item
      // 3. Undo is not already processing or completed
      return (
        status === "completed" &&
        undo?.allowed === true &&
        (!undo?.status || undo.status === "idle" || undo.status === "failed")
      );
    };

    const handleUndo = (history) => {
      setUndoHistoryItem(history);
      setShowUndoModal(true);
    };

    const handleUndoClose = useCallback(() => {
      setShowUndoModal(false);
      setUndoHistoryItem(null);
    }, []);

    const handleUndoEditHistory = useCallback(async () => {
      if (!undoHistoryItem?.id) return;
      setUndoLoading(true);
      try {
        const response = await fetch(
          `/api/products/undo-edit/${undoHistoryItem?.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
          },
        );

        if (response.ok) {
          setShowUndoModal(false);
          // Update local state to show undo is processing
          setLocalHistories((prev) =>
            prev.map((h) =>
              h.id === undoHistoryItem.id
                ? {
                    ...h,
                    undo: {
                      ...h.undo,
                      status: "processing",
                      startedAt: new Date().toISOString(),
                    },
                  }
                : h,
            ),
          );
        } else {
          const errorData = await response.json();
          console.error("Undo failed:", errorData);
          // Optionally show error toast here
        }
      } catch (error) {
        console.error("Undo failed:", error.message);
      } finally {
        setUndoLoading(false);
        setUndoHistoryItem(null);
      }
    }, [undoHistoryItem]);

    useEffect(() => {
      setLocalHistories(histories);
    }, [histories]);

    /**
     * Formats edit time with proper handling for processing states
     */
    const formatEditTime = (item) => {
      const { editTime, status, undo } = item;

      // If undo is processing, show undo started time
      if (undo?.status === "processing" && undo?.startedAt) {
        return new Date(undo.startedAt).toLocaleString();
      }

      // If undo is completed, show undo completed time
      if (undo?.status === "completed" && undo?.completedAt) {
        return new Date(undo.completedAt).toLocaleString();
      }

      // If edit is still processing or no editTime
      if (status === "processing" || !editTime) {
        return (
          <Text as="span" tone="subdued" italic>
            {t("processing") || "Processing..."}
          </Text>
        );
      }

      try {
        return new Date(editTime).toLocaleString();
      } catch {
        return t("dateUnavailable") || "Date unavailable";
      }
    };

    /**
     * Formats processed count with proper context
     */
    const formatProcessedCount = (item) => {
      const { processedCount, totalItems, undo } = item;

      // Show undo processed count if undo is active
      if (undo?.status === "processing" || undo?.status === "completed") {
        const undoCount = undo.processedCount || 0;
        return `${undoCount} / ${totalItems || processedCount}`;
      }

      return `${processedCount} / ${totalItems || processedCount}`;
    };

    if (isLoading) {
      return (
        <Box padding="400" textAlign="center">
          <Spinner accessibilityLabel="Loading history" size="large" />
        </Box>
      );
    }

    if (!localHistories || localHistories.length === 0) {
      return (
        <Box padding="400" textAlign="center">
          <Text as="span" tone="subdued">
            {emptyStateMessage}
          </Text>
        </Box>
      );
    }

  const rows = localHistories.map((item) => {
  const { id, title, shop } = item;
  const user = shop?.split(".")[0];
  const isUndoable = canUndo(item);
  const displayStatus = getDisplayStatus(item);
  const isProcessing =
    displayStatus === "processing" || displayStatus === "undo_processing";

  return [
    <Box
      key={`title-${id}`}
      width={COLUMN_WIDTHS.title}
      maxWidth={COLUMN_WIDTHS.title}
      textAlign="start"
    >
      <Text variant="bodyMd" fontWeight="medium" truncate>
        {title}
      </Text>
    </Box>,

    renderStatusBadge(item),

    <Box key={`count-${id}`} minWidth="120px" textAlign="start">
      <Text>{formatProcessedCount(item)}</Text>
    </Box>,

    <Box key={`user-${id}`} minWidth="120px" textAlign="start">
      <Text>{user || "-"}</Text>
    </Box>,

    <Box key={`time-${id}`} minWidth="180px" textAlign="start">
      {formatEditTime(item)}
    </Box>,

    <InlineStack key={`actions-${id}`} align="start" gap="200">
      <ButtonGroup variant="segmented">
        <Button
          size="slim"
          icon={<Eye size={14} />}
          onClick={() => {
            if (!id) return;
            navigate(`/editDetails/${id}`);
          }}
        >
          {t("view") || "View"}
        </Button>

        <Button
          size="slim"
          icon={<RotateCw size={14} />}
          onClick={() => isUndoable && handleUndo(item)}
          disabled={!isUndoable || isProcessing}
          tone={isUndoable ? "critical" : undefined}
        >
          {t("undoEdit") || "Undo"}
        </Button>
      </ButtonGroup>
    </InlineStack>,
  ];
});

    return (
      <BlockStack gap="400">
        <Box background="bg-surface" borderRadius="200">
          <DataTable
            columnContentTypes={[
              "text", // Title
              "text", // Status
              "text", // Count
              "text", // User
              "text", // Time
              "text", // Actions
            ]}
            headings={[
              t("title") || "Title",
              t("statusLabel") || "Status",
              t("processedCount") || "Processed",
              t("user") || "User",
              t("editTime") || "Time",
              t("actions") || "Actions",
            ]}
            rows={rows}
            verticalAlign="middle"
            footerContent={
              hasMore ? (
                <Box paddingBlockStart="400" textAlign="center">
                  <Button loading={isLoadingMore} onClick={onLoadMore}>
                    {t("loadMore") || "Load More"}
                  </Button>
                </Box>
              ) : null
            }
          />
        </Box>

        <AlertUndo
          show={showUndoModal}
          handleClose={handleUndoClose}
          undoEditHistory={handleUndoEditHistory}
          loading={undoLoading}
        />
      </BlockStack>
    );
  },
);

HistoryTable.displayName = "HistoryTable";
export default HistoryTable;
