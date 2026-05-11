import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { subscriptionService } from "../../domain/subscription/services/subscriptionService";

export const fetchSubscriptionPlans = createAsyncThunk(
  "subscription/fetchPlans",
  async ({ fetchFn } = {}, { rejectWithValue }) => {
    try {
      return await subscriptionService.getSubscriptionPlans(fetchFn);
    } catch (error) {
      return rejectWithValue(
        error.message || "Failed to fetch subscription plans",
      );
    }
  },
);

export const createSubscription = createAsyncThunk(
  "subscription/createSubscription",
  async ({ plan, fetchFn }, { rejectWithValue }) => {
    try {
      return await subscriptionService.createSubscription(plan, fetchFn);
    } catch (error) {
      return rejectWithValue(
        error.message || "Failed to create subscription",
      );
    }
  },
);

const initialState = {
  plans: [],
  activePlan: null,
  isActivePlan: false,
  selectedPlan: null,
  plansStatus: "idle",
  plansError: null,
  activePlanStatus: "idle",
  activePlanError: null,
  subscriptionStatus: "idle",
  subscriptionError: null,
};

const subscriptionSlice = createSlice({
  name: "subscription",
  initialState,
  reducers: {
    setSelectedPlan: (state, action) => {
      state.selectedPlan = action.payload;
    },
    setActivePlan: (state, action) => {
      state.activePlan = action.payload?.activePlan || null;
      state.isActivePlan = Boolean(
        state.activePlan && state.activePlan.isFree !== true,
      );
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
      .addCase(fetchSubscriptionPlans.pending, (state) => {
        state.plansStatus = "loading";
        state.activePlanStatus = "loading";
      })
      .addCase(fetchSubscriptionPlans.fulfilled, (state, action) => {
        const plans = action.payload?.plans || [];
        const currentPlanKey = action.payload?.currentPlanKey || null;
        const activePlan =
          plans.find((plan) => plan?.isCurrent === true)
          || plans.find((plan) => plan?.key === currentPlanKey)
          || null;

        state.plansStatus = "succeeded";
        state.activePlanStatus = "succeeded";
        state.plans = plans;
        state.activePlan = activePlan;
        state.isActivePlan = Boolean(activePlan && activePlan.isFree !== true);
        state.plansError = null;
        state.activePlanError = null;
      })
      .addCase(fetchSubscriptionPlans.rejected, (state, action) => {
        state.plansStatus = "failed";
        state.activePlanStatus = "failed";
        state.plansError = action.payload || "Failed to fetch subscription plans";
        state.activePlanError = action.payload || "Failed to fetch subscription plans";
      })
      .addCase(createSubscription.pending, (state) => {
        state.subscriptionStatus = "loading";
        state.subscriptionError = null;
      })
      .addCase(createSubscription.fulfilled, (state) => {
        state.subscriptionStatus = "succeeded";
        state.subscriptionError = null;
        state.selectedPlan = null;
      })
      .addCase(createSubscription.rejected, (state, action) => {
        state.subscriptionStatus = "failed";
        state.subscriptionError = action.payload || "Failed to create subscription";
      });
  },
});

export const {
  setSelectedPlan,
  clearSelectedPlan,
  clearConfirmationUrl,
  clearErrors,
  setActivePlan,
} = subscriptionSlice.actions;

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

export default subscriptionSlice.reducer;
