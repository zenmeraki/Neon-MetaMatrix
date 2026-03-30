// web/frontend/hooks/useToast.tsx
import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Toast } from "@shopify/polaris";

interface ToastOptions {
  content: string;
  isError?: boolean;
}

export function useToast() {
  const [toastContent, setToastContent] = useState("");
  const [toastError, setToastError] = useState(false);
  const [showToast, setShowToast] = useState(false);

  // Clear content/error after Polaris fade-out (~300ms)
  const cleanupToast = useCallback(() => {
    setTimeout(() => {
      setToastContent("");
      setToastError(false);
    }, 300);
  }, []);

  // Debounce factory (with cancel)
  function debounce<T extends (...args: any[]) => any>(
    func: T,
    delay: number
  ): ((...args: Parameters<T>) => void) & { cancel?: () => void } {
    let timeout: ReturnType<typeof setTimeout>;
    const debounced = (...args: Parameters<T>) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), delay);
    };
    debounced.cancel = () => clearTimeout(timeout);
    return debounced;
  }

  // Stable debounced triggerToast
  const triggerToastRef = useMemo(
    () =>
      debounce((options: ToastOptions) => {
        const { content, isError = false } = options;
        if (!content.trim()) {
          console.warn("useToast: Empty content provided");
          return;
        }
        setToastContent(content);
        setToastError(isError);
        setShowToast(true);
      }, 100),
    []
  );

  // Stable debounced triggerToastWithAutoDismiss
  const triggerToastWithAutoDismissRef = useMemo(
    () =>
      debounce(
        (
          options: ToastOptions & { autoDismiss?: boolean; duration?: number }
        ) => {
          const {
            content,
            isError = false,
            autoDismiss = false,
            duration = 4000,
          } = options;
          if (!content.trim()) return;

          setToastContent(content);
          setToastError(isError);
          setShowToast(true);

          if (autoDismiss && !isError) {
            setTimeout(() => {
              setShowToast(false);
              cleanupToast();
            }, duration);
          }
        },
        100
      ),
    [cleanupToast]
  );

  // Cancel any pending timeouts on unmount
  useEffect(() => {
    return () => {
      triggerToastRef.cancel?.();
      triggerToastWithAutoDismissRef.cancel?.();
    };
  }, [triggerToastRef, triggerToastWithAutoDismissRef]);

  const showSuccess = useCallback(
    (message: string) => triggerToastRef({ content: message, isError: false }),
    [triggerToastRef]
  );

  const showError = useCallback(
    (message: string) => triggerToastRef({ content: message, isError: true }),
    [triggerToastRef]
  );

  const dismissToast = useCallback(() => {
    setShowToast(false);
    cleanupToast();
  }, [cleanupToast]);

  const toastMarkup = useMemo(() => {
    if (!showToast) return null;
    return (
      <Toast
        content={toastContent}
        error={toastError}
        onDismiss={dismissToast}
        duration={toastError ? 6000 : 4000}
      />
    );
  }, [showToast, toastContent, toastError, dismissToast]);

  return useMemo(
    () => ({
      toastMarkup,
      triggerToast: triggerToastRef,
      showSuccess,
      showError,
      triggerToastWithAutoDismiss: triggerToastWithAutoDismissRef,
      isVisible: showToast,
    }),
    [
      toastMarkup,
      triggerToastRef,
      showSuccess,
      showError,
      triggerToastWithAutoDismissRef,
      showToast,
    ]
  );
}
