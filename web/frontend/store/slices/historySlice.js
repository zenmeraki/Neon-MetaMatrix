// web/frontend/store/slices/historySlice.js
import { createSlice, createAsyncThunk, createAction } from "@reduxjs/toolkit";
import { historyService } from "../../Domain/History/services/historyService";
import { ExportHistoryResponseSchema } from "../../Domain/History/schema/exportHistorySchema";
// import { ExportHistoryResponseSchema } from "../../Domain/History/schemas/exportHistorySchema";

// Async thunks for history operations
let controller = null;

export const fetchHistories = createAsyncThunk(
  "history/fetchHistories",
  async ({ type, cursor, limit, search, lang }, { rejectWithValue }) => {
    try {
      // Abort previous request
      if (controller) {
        controller.abort();
      }

      controller = new AbortController();
      let response;
      if (type == "Recurring edit") {
        response = await historyService.getRecurringEditHistories(
          type,
          cursor,
          limit,
          search,
          controller.signal, // <-- pass abort signal here
          lang
        );
      } else {
        response = await historyService.getHistories(
          type,
          cursor,
          limit,
          search,
          controller.signal, // <-- pass abort signal here
          lang
        );
      }
      return response;
    } catch (error) {
      if (error.name === "AbortError") {
        console.warn("Previous request aborted");
        return rejectWithValue("Request cancelled");
      }
      return rejectWithValue(error.message || "Failed to fetch histories");
    }
  }
);

export const fetchExportHistories = createAsyncThunk(
  "history/fetchExportHistories",
  async ({ lang }, { rejectWithValue }) => {
    try {
      // Abort previous request
      if (controller) {
        controller.abort();
      }

      controller = new AbortController();

      const response = await historyService.getExportHistories({ lang });

      // Validate the response data using Zod schema
      if (response && response.data) {
        const parsed = ExportHistoryResponseSchema.safeParse(response.data);

        if (!parsed.success) {
          const errorMessage = `Malformed API response: ${JSON.stringify(
            parsed.error.errors
          )}`;
          console.error("Validation Error:", errorMessage);
          return rejectWithValue(errorMessage);
        }

        // Return validated data
        return {
          ...response,
          data: parsed.data,
        };
      }

      return response;
    } catch (error) {
      if (error.name === "AbortError") {
        console.warn("Previous request aborted");
        return rejectWithValue("Request cancelled");
      }
      return rejectWithValue(error.message || "Failed to fetch histories");
    }
  }
);

export const loadMoreHistories = createAsyncThunk(
  "history/loadMoreHistories",
  async ({ cursor, limit, lang }, { getState, rejectWithValue }) => {
    try {
      const state = getState();
      const { type, search } = state.history.filters;

      // Create a new controller for this request
      if (controller) {
        controller.abort();
      }
      controller = new AbortController();

      const response = await historyService.getHistories(
        type,
        cursor,
        limit,
        search,
        controller.signal,
        lang
      );

      return response;
    } catch (error) {
      if (error.name === "AbortError") {
        console.warn("Load more request aborted");
        return rejectWithValue("Request cancelled");
      }
      return rejectWithValue(error.message || "Failed to load more histories");
    }
  }
);

// Additional action for validation errors
export const setExportHistoriesError = createAction(
  "history/setExportHistoriesError"
);

// Additional action to clear export histories
export const clearExportHistories = createAction(
  "history/clearExportHistories"
);

// Initial state
const initialState = {
  histories: [],
  exportData: {
    histories: [],
    error: null,
    loading: false,
    validationError: null, // New field for validation errors
  },
  currentHistory: null,
  pagination: {
    hasNextPage: false,
    endCursor: null,
    limit: 10,
  },
  filters: {
    type: "Manual edit",
    search: "",
  },
  status: "idle", // 'idle' | 'loading' | 'succeeded' | 'failed'
  error: null,
  detailsStatus: "idle",
  detailsError: null,
  loadMoreStatus: "idle", // Added missing loadMoreStatus
};

// Create the slice
const historySlice = createSlice({
  name: "history",
  initialState,
  reducers: {
    setHistoryType: (state, action) => {
      state.filters.type = action.payload;
      state.histories = []; // Reset histories when type changes
      state.pagination.endCursor = null;
      state.pagination.hasNextPage = false;
    },
    setSearchQuery: (state, action) => {
      state.filters.search = action.payload;
      state.histories = []; // Reset histories when search changes
      state.pagination.endCursor = null;
      state.pagination.hasNextPage = false;
    },
    clearCurrentHistory: (state) => {
      state.currentHistory = null;
      state.detailsStatus = "idle";
      state.detailsError = null;
    },
    // New reducer to clear export data
    clearExportData: (state) => {
      state.exportData = {
        histories: [],
        error: null,
        loading: false,
        validationError: null,
      };
    },
  },

  extraReducers: (builder) => {
    builder
      // Fetch Histories
      .addCase(fetchHistories.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(fetchHistories.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.histories = action.payload.data;
        state.pagination = {
          ...state.pagination,
          hasNextPage: action.payload.meta?.pageInfo?.hasNextPage || false,
          endCursor: action.payload.meta?.pageInfo?.endCursor || null,
          totalItems: action.payload.meta?.total || 0,
        };
        state.error = null;
      })
      .addCase(fetchHistories.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload || "Failed to fetch histories";
      })

      // Fetch Export Histories with enhanced error handling
      .addCase(fetchExportHistories.pending, (state) => {
        state.exportData.loading = true;
        state.exportData.error = null;
        state.exportData.validationError = null;
      })
      .addCase(fetchExportHistories.fulfilled, (state, action) => {
        state.exportData.loading = false;
        state.exportData.histories = action.payload.data || [];
        state.exportData.error = null;
        state.exportData.validationError = null;
      })
      .addCase(fetchExportHistories.rejected, (state, action) => {
        state.exportData.loading = false;
        state.exportData.histories = [];

        // Check if this is a validation error
        const errorMessage = action.payload || "Failed to fetch histories";
        if (errorMessage.includes("Malformed API response")) {
          state.exportData.validationError = errorMessage;
          state.exportData.error = null;
        } else {
          state.exportData.error = errorMessage;
          state.exportData.validationError = null;
        }
      })

      // Load More Histories
      .addCase(loadMoreHistories.pending, (state) => {
        state.loadMoreStatus = "loading";
      })
      .addCase(loadMoreHistories.fulfilled, (state, action) => {
        state.loadMoreStatus = "succeeded";
        // Append new items to existing list
        state.histories = [...state.histories, ...action.payload.data];
        // Update pagination info
        state.pagination = {
          ...state.pagination,
          hasNextPage: action.payload.meta?.pageInfo?.hasNextPage || false,
          endCursor: action.payload.meta?.pageInfo?.endCursor || null,
          totalItems: action.payload.meta?.total || 0,
        };
      })
      .addCase(loadMoreHistories.rejected, (state, action) => {
        state.loadMoreStatus = "failed";
        state.error = action.payload || "Failed to load more histories";
      })

      // Additional action handlers for manual error setting
      .addCase(setExportHistoriesError, (state, action) => {
        state.exportData.loading = false;
        state.exportData.error = action.payload;
      })
      .addCase(clearExportHistories, (state) => {
        state.exportData.histories = [];
        state.exportData.error = null;
        state.exportData.validationError = null;
      });
  },
});

// Export actions
export const {
  setHistoryType,
  setSearchQuery,
  clearCurrentHistory,
  clearExportData,
} = historySlice.actions;

// Export selectors
export const selectHistories = (state) => state.history.histories;
export const selectExportData = (state) => state.history.exportData;
export const selectCurrentHistory = (state) => state.history.currentHistory;
export const selectHistoryPagination = (state) => state.history.pagination;
export const selectHistoryFilters = (state) => state.history.filters;
export const selectHistoryStatus = (state) => state.history.status;
export const selectHistoryError = (state) => state.history.error;
export const selectLoadMoreStatus = (state) => state.history.loadMoreStatus;
export const selectHistoryDetailsStatus = (state) =>
  state.history.detailsStatus;
export const selectHistoryDetailsError = (state) => state.history.detailsError;

// New selectors for export data validation
export const selectExportValidationError = (state) =>
  state.history.exportData.validationError;
export const selectExportHistories = (state) =>
  state.history.exportData.histories;
export const selectExportLoading = (state) => state.history.exportData.loading;
export const selectExportError = (state) => state.history.exportData.error;

// Export reducer
export default historySlice.reducer;
