import React, { useState, useCallback, useMemo, useEffect } from "react";
import {
  Page,
  Card,
  Tabs,
  Banner,
  Toast,
  Frame,
  BlockStack,
} from "@shopify/polaris";
import { useDispatch } from "react-redux";
import { historyService } from "../services/historyService";
// import { io } from "socket.io-client";

// Custom hooks
import { useHistoryList } from "../hooks/useHistoryList";
import { useHistorySearch } from "../hooks/useHistorySearch";

// Components
import HistoryTable from "../components/HistoryTable";
import RecurringHistoryTable from "../components/RecurringHistoryTable";
import HistoryFilters from "../components/HistoryFilters";
import SaveViewModal from "../components/SaveViewModal";
import { useStoreAccess } from "../../dashboard/hooks/useStoreAccess";
import { useTranslation } from "react-i18next";
import { KEY_TO_TYPE } from "../hooks/useHistoryList";

/**
 * History page component
 * Enterprise-level implementation with Redux integration
 *
 *
 */

// const socket = io("https://metamatrix-new-c6adf9244e93.herokuapp.com");
// const socket = io("http://localhost:62421")


const HistoryComponent = () => {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const { storeAccess } = useStoreAccess();

  // Toast state
  const [toastState, setToastState] = useState({
    active: false,
    message: "",
    error: false,
  });

  // Tabs
  const tabs = useMemo(
    () => [
      { id: "manual-edits", content: t("ManualEdit") },
      { id: "scheduled-edits", content: t("ScheduledEdit") },
      { id: "recurring-edits", content: t("RecurringEdit") },
    ],
    [t]
  );

  // History list hook
  const {
    histories,
    pagination,
    filters,
    isLoading,
    isLoadingMore,
    error,
    handleTabChange,
    loadMore,
    refetch,
  } = useHistoryList();

  // Socket events
  // useEffect(() => {
  //   if (socket && storeAccess) {
  //     socket.emit("register_store", storeAccess.shopUrl);

  //     socket.on("product_updated", (data) => {
  //       setToastState({
  //         active: true,
  //         message: data?.data?.title.en
  //           ? `${data?.data?.title.en}`
  //           : "Background editing completed",
  //         error: false,
  //       });

  //       const index = tabs.findIndex((tab) => tab.content === data?.data?.type);
  //       handleTabChange(index, tabs);
  //       refetch();
  //     });
  //   }
  //   return () => {
  //     socket.off("product_updated");
  //   };
  // }, [storeAccess, tabs, refetch, handleTabChange]);

  const { searchValue, debouncedSearchChange } = useHistorySearch();

  // Modals
  const [showSaveViewModal, setShowSaveViewModal] = useState(false);

  // Current tab index
  const selectedTabIndex = tabs.findIndex(
    (tab) =>
      tab.content ===
      t(
        Object.keys(KEY_TO_TYPE).find(
          (key) => KEY_TO_TYPE[key] === filters.type
        ) || "ManualEdit"
      )
  );

  // Handle export
  const handleExport = useCallback(async () => {
    try {
      const blob = await historyService.exportHistory(filters);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `history-export-${new Date().toISOString().split("T")[0]}.csv`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();

      setToastState({
        active: true,
        message:
          t("exportStarted") ||
          "Export started. Your file will download shortly.",
        error: false,
      });
    } catch {
      setToastState({
        active: true,
        message:
          t("exportFailed") || "Failed to export history. Please try again.",
        error: true,
      });
    }
  }, [filters, t]);

  // Handle save view
  const handleSaveView = useCallback(() => {
    setShowSaveViewModal(true);
  }, []);

  const handleSaveViewSubmit = useCallback(async (viewData) => {
    try {
      setToastState({
        active: true,
        message: `View "${viewData.name}" saved successfully.`,
        error: false,
      });
    } catch {
      setToastState({
        active: true,
        message: "Failed to save view. Please try again.",
        error: true,
      });
    }
  }, []);

  // Empty state message
  const getEmptyStateMessage = useCallback(() => {
    switch (filters.type) {
      case "Manual edit":
        return (
          t("noManualEdits") ||
          "No manual edits found. Try editing some products first."
        );
      case "Scheduled edit":
        return (
          t("noScheduledEdits") ||
          "No scheduled edits found. Try scheduling an edit."
        );
      case "Recurring edit":
        return (
          t("noRecurringEdits") ||
          "No recurring edits found. Try setting up a recurring edit."
        );
      default:
        return t("noHistory") || "No history items found.";
    }
  }, [filters.type, t]);

  // Check if current tab is recurring edit
  const isRecurringEditTab = filters.type === "Recurring edit";

  // Render appropriate table component
  const renderHistoryTable = () => {
    if (isRecurringEditTab) {
      return (
        <RecurringHistoryTable
          histories={histories}
          isLoading={isLoading}
          isLoadingMore={isLoadingMore}
          hasMore={pagination.hasNextPage}
          emptyStateMessage={getEmptyStateMessage()}
          onLoadMore={loadMore}
        />
      );
    }

    return (
      <HistoryTable
        histories={histories}
        isLoading={isLoading}
        isLoadingMore={isLoadingMore}
        hasMore={pagination.hasNextPage}
        emptyStateMessage={getEmptyStateMessage()}
        onLoadMore={loadMore}
      />
    );
  };

  return (
    // <Frame>
    <Page fullWidth >
      {/* <Card> */}
        <Tabs
          tabs={tabs}
          selected={selectedTabIndex}
          onSelect={(index) => {
            if (!isLoading) {
              handleTabChange(index, tabs);
            }
          }}
        />

        <BlockStack gap="400" >
          <HistoryFilters
            searchValue={searchValue}
            onSearchChange={debouncedSearchChange}
            onExport={handleExport}
            onSaveView={handleSaveView}
          />

          {error && <Banner status="critical">{error}</Banner>}

          {renderHistoryTable()}
        </BlockStack>
      {/* </Card> */}

      <SaveViewModal
        isOpen={showSaveViewModal}
        onClose={() => setShowSaveViewModal(false)}
        onSave={handleSaveViewSubmit}
        currentFilters={filters}
      />

      {toastState.active && (
        <Toast
          content={toastState.message}
          error={toastState.error}
          onDismiss={() =>
            setToastState({ active: false, message: "", error: false })
          }
        />
      )}
    </Page>
    // </Frame>
  );
};

export default HistoryComponent;
