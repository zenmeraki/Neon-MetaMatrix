// web/frontend/domains/subscription/hooks/useSubscription.js
import { useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  setSelectedPlan,
  clearSelectedPlan,
  selectSelectedPlan,
  selectSubscriptionStatus,
  selectSubscriptionError,
  // You'll need to add this action to your slice
  createSubscription,
  setActivePlan,
} from "../../../store/slices/subscriptionSlice";

import { subscriptionService } from "../services/subscriptionService";

export const useSubscription = () => {
  const dispatch = useDispatch();

  // Redux selectors
  const selectedPlan = useSelector(selectSelectedPlan);
  const status = useSelector(selectSubscriptionStatus);
  const error = useSelector(selectSubscriptionError);

  // Local state
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Compute loading state
  const isSubscribing = status === "loading";

  // Select a plan for subscription
  const handleSelectPlan = useCallback(
    (plan) => {
      dispatch(setSelectedPlan(plan));
      setShowConfirmModal(true);
    },
    [dispatch]
  );

  // Cancel plan selection
  const handleCancelSelection = useCallback(() => {
    setShowConfirmModal(false);
    dispatch(clearSelectedPlan());
  }, [dispatch]);

  // Confirm subscription with proper loading state
  const handleConfirmSubscription = useCallback(async () => {
    if (!selectedPlan) return;

    try {
      // Dispatch the async thunk which will handle loading states
      const result = await dispatch(createSubscription(selectedPlan));

      if (createSubscription.fulfilled.match(result)) {
        setShowConfirmModal(false);
        const { confirmationUrl, name } = result.payload;

        // Handle confirmation URL redirect if available
        if (confirmationUrl) {
          const redirectLink = document.createElement("a");
          redirectLink.href = confirmationUrl;
          redirectLink.target = "_top";
          redirectLink.click();
        } else if (name == "Free Version") {
          dispatch(setActivePlan({ name: "Free Version" }));
        }
      }
    } catch (error) {
      console.error("Subscription error:", error);
      // Error is handled by Redux slice
    }
  }, [dispatch, selectedPlan]);

  return {
    selectedPlan,
    showConfirmModal,
    isSubscribing,
    error,
    handleSelectPlan,
    handleCancelSelection,
    handleConfirmSubscription,
    setShowConfirmModal,
  };
};
