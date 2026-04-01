// web/frontend/domains/subscription/hooks/useActivePlan.js
import { useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useLocation } from "react-router-dom";
import {
 fetchSubscriptionPlans,
  selectActivePlan,
  selectActivePlanStatus,
  selectActivePlanError,
} from "../../../store/slices/subscriptionSlice";

/**
 * Custom hook for managing active subscription plan
 * @returns {Object} Active plan state and handlers
 */
export const useActivePlan = () => {
  const dispatch = useDispatch();
  const { pathname, search } = useLocation();

  // Redux selectors
  const activePlan = useSelector(selectActivePlan);
  const status = useSelector(selectActivePlanStatus);
  const error = useSelector(selectActivePlanError);

  // Compute loading state
  const isLoading = status === "loading";
  // Check for charge_id in URL
  const urlParams = new URLSearchParams(search);
  const chargeId = urlParams.get("charge_id");


  // Verify current plan
 const verifyPlan = useCallback(() => {
    dispatch(fetchSubscriptionPlans());
  }, [dispatch]);


 

  // Check initial state based on URL
 useEffect(() => {
    if (activePlan == null) verifyPlan();
  }, [activePlan, verifyPlan]);


  // Clean up URL after activation
  useEffect(() => {
    if (chargeId && activePlan) {
      const nextParams = new URLSearchParams(search);
      if (nextParams.has("charge_id")) {
        nextParams.delete("charge_id");
        const nextSearch = nextParams.toString();
        const nextUrl = nextSearch ? `${pathname}?${nextSearch}` : pathname;
        window.history.replaceState({}, document.title, nextUrl);
      }
    }
  }, [activePlan, chargeId, pathname, search]);

  return {
    activePlan,
    isLoading,
    error,
    verifyPlan,
    chargeId,
  };
};
