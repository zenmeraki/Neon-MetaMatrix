import { getAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";

export const historyService = {
  controller: null, // Store the controller for cancellation

  async getHistories(type, cursor, limit, search, signal, lang) {
    try {
      const fetchWithAuth = getAuthenticatedFetch();
      const queryParams = new URLSearchParams();

      // Add parameters that are always required
      if (type) queryParams.append("type", type);
      if (limit) queryParams.append("limit", limit);
      if (search) queryParams.append("search", search);
      if (lang) queryParams.append("lang", lang);
      // Only add cursor if it's a non-empty string
      if (cursor && typeof cursor === "string" && cursor.trim() !== "") {
        queryParams.append("cursor", cursor);
      }

      const response = await fetchWithAuth(
        `/api/history/get-shop-operation-history?${queryParams.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal, // <- Pass AbortController signal here
        }
      );

      const data = await response.json();

      if (!response.ok) {
        // Extract the best available error message
        const errorMessage =
          data.message || data.error?.details || "Failed to fetch history";
        throw new Error(errorMessage);
      }

      return data;
    } catch (error) {
      // Handle fetch cancellation separately
      if (error.name === "AbortError") {
        console.warn("Fetch aborted:", error);
      } else {
        console.error("Error in getHistories:", error);
      }

      // Always re-throw so redux-thunk can handle it
      throw error;
    }
  },

  async getRecurringEditHistories(type, cursor, limit, search, signal, lang) {
    try {
      const fetchWithAuth = getAuthenticatedFetch();
      const queryParams = new URLSearchParams();

      // // Add parameters that are always required
      // if (type) queryParams.append("type", type);
      // if (limit) queryParams.append("limit", limit);
      // if (search) queryParams.append("search", search);
      // if (lang) queryParams.append("lang", lang);
      // // Only add cursor if it's a non-empty string
      // if (cursor && typeof cursor === "string" && cursor.trim() !== "") {
      //   queryParams.append("cursor", cursor);
      // }

      const response = await fetchWithAuth(
        `/api/products/get-recurring-edits?${queryParams.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal, // <- Pass AbortController signal here
        }
      );

      const data = await response.json();

      if (!response.ok) {
        // Extract the best available error message
        const errorMessage =
          data.message || data.error?.details || "Failed to fetch history";
        throw new Error(errorMessage);
      }

      return data;
    } catch (error) {
      // Handle fetch cancellation separately
      if (error.name === "AbortError") {
        console.warn("Fetch aborted:", error);
      } else {
        console.error("Error in getHistories:", error);
      }

      // Always re-throw so redux-thunk can handle it
      throw error;
    }
  },

  async getExportHistories({ lang, exportType }) {
    try {
      const fetchWithAuth = getAuthenticatedFetch();
      const queryParams = new URLSearchParams();
      queryParams.append("lang", lang || "en");
      if (exportType) queryParams.append("exportType", exportType);
      queryParams.append("limit", "50");
      // Add parameters that are always required
      // if (filters.type) queryParams.append('type', filters.type);
      // if (filters.search) queryParams.append('search', filters.search);

      const response = await fetchWithAuth(
        `/api/history/get-shop-operation-history?${queryParams.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage =
          errorData.message ||
          errorData.error?.details ||
          "Failed to export history";
        throw new Error(errorMessage);
      }

      return await response.json();
    } catch (error) {
      // Handle fetch cancellation separately
      if (error.name === "AbortError") {
        console.warn("Fetch aborted:", error);
      } else {
        console.error("Error in getHistories:", error);
      }

      // Always re-throw so redux-thunk can handle it
      throw error;
    }
  },

  async downloadExportedData(id, fileName = "exported_data") {
    try {
      const fetchWithAuth = getAuthenticatedFetch();
      const response = await fetchWithAuth(`/api/products/download-export/${id}`, {
        method: "GET",
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error exporting products:", errorData);
        throw new Error(
          errorData.message || "Failed to download exported data."
        );
      }
      // Get the CSV file content
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      // Trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.csv`;
      a.click();

      // Cleanup
      window.URL.revokeObjectURL(url);
      return {
        success: true,
      };
    } catch (error) {
      console.error("Error during export:", error);
      return {
        success: false,
        error: error.message || "An unexpected error occurred during export.",
      };
    }
  },

  async getLiveProgress(id, signal) {
    const fetchWithAuth = getAuthenticatedFetch();
    const response = await fetchWithAuth(`/api/history/live-progress/${id}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.message || "Failed to fetch live progress");
    }
    return data?.data || null;
  },
};
