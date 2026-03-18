// web/frontend/store/slices/subscriptionSlice.js
import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { subscriptionService } from "../../Domain/Subscription/services/subscriptionService";

// Async thunks for subscription operations
export const fetchSubscriptionPlans = createAsyncThunk(
  "subscription/fetchPlans",
  async (_, { rejectWithValue }) => {
    try {
      const response = await subscriptionService.getSubscriptionPlans();
      return response;
    } catch (error) {
      return rejectWithValue(
        error.message || "Failed to fetch subscription plans"
      );
    }
  }
);


export const activateBilling = createAsyncThunk(
  "subscription/activateBilling",
  async (chargeId, { rejectWithValue }) => {
    try {
      const response = await subscriptionService.activateBilling(chargeId);
      return response;
    } catch (error) {
      return rejectWithValue(error.message || "Failed to activate billing");
    }
  }
);

// Add new async thunk for creating subscription
export const createSubscription = createAsyncThunk(
  "subscription/createSubscription",
  async (plan, { rejectWithValue }) => {
    try {
      const response = await subscriptionService.createSubscription(plan);
      return response;
    } catch (error) {
      return rejectWithValue(error.message || "Failed to create subscription");
    }
  }
);

// Initial state
const initialState = {
  plans: [],
  activePlan: null,
  isActivePlan: false,
  selectedPlan: null,
  plansStatus: "idle", // 'idle' | 'loading' | 'succeeded' | 'failed'
  plansError: null,
  activePlanStatus: "idle",
  activePlanError: null,
  subscriptionStatus: "idle",
  subscriptionError: null,
};

// Create the slice
const subscriptionSlice = createSlice({
  name: "subscription",
  initialState,
  reducers: {
    setSelectedPlan: (state, action) => {
      state.selectedPlan = action.payload;
    },
    setActivePlan: (state, action) => {
      state.activePlan = action.payload?.activePlan || null;
    },
    clearSelectedPlan: (state) => {
      state.selectedPlan = null;
    },
    clearConfirmationUrl: (state) => {
      state.confirmationUrl = null;
    },
    clearErrors: (state) => {
      state.plansError = null;
      state.activePlanError = null;
      state.subscriptionError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Fetch Subscription Plans
      .addCase(fetchSubscriptionPlans.pending, (state) => {
        state.plansStatus = "loading";
      })
      .addCase(fetchSubscriptionPlans.fulfilled, (state, action) => {
        state.plansStatus = "succeeded";
        state.plans = action.payload;
        state.plansError = null;
      })
      .addCase(fetchSubscriptionPlans.rejected, (state, action) => {
        state.plansStatus = "failed";
        state.plansError =
          action.payload || "Failed to fetch subscription plans";
      })

      // Verify Active Plan
      .addCase(verifyActivePlan.pending, (state) => {
        state.activePlanStatus = "loading";
      })
      .addCase(verifyActivePlan.fulfilled, (state, action) => {
        state.activePlanStatus = "succeeded";
        state.activePlan = action.payload?.activePlan || null;
        state.isActivePlan = action.payload?.active;
        state.activePlanError = null;
      })
      .addCase(verifyActivePlan.rejected, (state, action) => {
        state.activePlanStatus = "failed";
        state.activePlanError =
          action.payload || "Failed to verify active plan";
      })

      // Create Subscription (NEW)
      .addCase(createSubscription.pending, (state) => {
        state.subscriptionStatus = "loading";
        state.subscriptionError = null;
      })
      .addCase(createSubscription.fulfilled, (state, action) => {
        state.subscriptionStatus = "succeeded";
        state.subscriptionError = null;
        // Optionally clear selected plan after successful subscription
        state.selectedPlan = null;
      })
      .addCase(createSubscription.rejected, (state, action) => {
        state.subscriptionStatus = "failed";
        state.subscriptionError =
          action.payload || "Failed to create subscription";
      });

    // Activate Billing
    // .addCase(activateBilling.pending, (state) => {
    //   state.activePlanStatus = 'loading';
    // })
    // .addCase(activateBilling.fulfilled, (state, action) => {
    //   state.activePlanStatus = 'succeeded';
    //   state.activePlan = action.payload;
    //   state.activePlanError = null;
    // })
    // .addCase(activateBilling.rejected, (state, action) => {
    //   state.activePlanStatus = 'failed';
    //   state.activePlanError = action.payload || 'Failed to activate billing';
    // })
  },
});

// Export actions
export const {
  setSelectedPlan,
  clearSelectedPlan,
  clearConfirmationUrl,
  clearErrors,
  setActivePlan,
} = subscriptionSlice.actions;

// Export selectors
export const selectSubscriptionPlans = (state) => state.subscription.plans;
export const selectActivePlan = (state) => state.subscription.activePlan;
export const isActivePlan = (state) => state.subscription.isActivePlan;
export const selectSelectedPlan = (state) => state.subscription.selectedPlan;
export const selectPlansStatus = (state) => state.subscription.plansStatus;
export const selectPlansError = (state) => state.subscription.plansError;
export const selectActivePlanStatus = (state) =>
  state.subscription.activePlanStatus;
export const selectActivePlanError = (state) =>
  state.subscription.activePlanError;
export const selectSubscriptionStatus = (state) =>
  state.subscription.subscriptionStatus;
export const selectSubscriptionError = (state) =>
  state.subscription.subscriptionError;

// Export reducer
export default subscriptionSlice.reducer;
