// web/frontend/Domain/History/hooks/useExportHistoryList.js
import { useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  selectExportData,
  fetchExportHistories,
} from "../../../store/slices/historySlice";
import { historyService } from "../services/historyService";
import { useTranslation } from "react-i18next";
import { i18n as appI18n } from "../../../utils/i18nUtils";

export const useExportHistoryList = () => {
  const dispatch = useDispatch();
  const { histories, error, loading } = useSelector(selectExportData);
  const { i18n } = useTranslation(undefined, { i18n: appI18n });

  // Refetch function to trigger fresh data fetch
  const refetch = useCallback(() => {
    dispatch(fetchExportHistories({ lang: i18n.language }));
  }, [dispatch]);

  // Fetch data on component mount
  useEffect(() => {
    refetch();
  }, [refetch]);

  // Enhanced download function with proper error handling
  const downloadExportedData = useCallback(async (id, filename) => {
    // Input validation
    if (!id || typeof id !== "string") {
      throw new Error("Invalid export ID provided");
    }

    if (!filename || typeof filename !== "string") {
      throw new Error("Invalid filename provided");
    }

    try {
      const response = await historyService.downloadExportedData(id, filename);
      return response;
    } catch (err) {
      console.error("Error downloading exported data:", err);
      // Re-throw error so component can handle it (show toast, etc.)
      throw err instanceof Error
        ? err
        : new Error(`Download failed: ${String(err)}`);
    }
  }, []);

  // Optional: Function to clear error state
  const clearError = useCallback(() => {
    // If you have a clearError action in your slice
    // dispatch(clearExportError());
  }, []);

  return {
    histories: histories || [],
    loading: Boolean(loading),
    error,
    refetch,
    downloadExportedData,
    clearError,
  };
};
