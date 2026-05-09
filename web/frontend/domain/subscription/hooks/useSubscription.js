import { useCallback, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useAuthenticatedFetch } from "../../../hooks/useAuthenticatedFetch";
import {
  clearSelectedPlan,
  createSubscription,
  fetchSubscriptionPlans,
  selectSelectedPlan,
  selectSubscriptionError,
  selectSubscriptionStatus,
  setSelectedPlan,
} from "../../../store/slices/subscriptionSlice";

export const useSubscription = () => {
  const dispatch = useDispatch();
  const fetchWithAuth = useAuthenticatedFetch();
  const selectedPlan = useSelector(selectSelectedPlan);
  const status = useSelector(selectSubscriptionStatus);
  const error = useSelector(selectSubscriptionError);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const handleSelectPlan = useCallback((plan) => {
    dispatch(setSelectedPlan(plan));
    setShowConfirmModal(true);
  }, [dispatch]);

  const handleCancelSelection = useCallback(() => {
    setShowConfirmModal(false);
    dispatch(clearSelectedPlan());
  }, [dispatch]);

  const handleConfirmSubscription = useCallback(async () => {
    if (!selectedPlan) return;

    try {
      const result = await dispatch(
        createSubscription({ plan: selectedPlan, fetchFn: fetchWithAuth }),
      );

      if (!createSubscription.fulfilled.match(result)) {
        return;
      }

      setShowConfirmModal(false);

      if (result.payload?.confirmationUrl) {
        window.open(result.payload.confirmationUrl, "_top");
        return;
      }

      await dispatch(fetchSubscriptionPlans({ fetchFn: fetchWithAuth }));
    } catch (subscriptionError) {
      console.error("Subscription error:", subscriptionError);
    }
  }, [dispatch, fetchWithAuth, selectedPlan]);

  return {
    selectedPlan,
    showConfirmModal,
    isSubscribing: status === "loading",
    error,
    handleSelectPlan,
    handleCancelSelection,
    handleConfirmSubscription,
    setShowConfirmModal,
  };
};
