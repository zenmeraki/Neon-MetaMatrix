import React, { createContext, useCallback, useContext, useState } from 'react';
import { Frame, Toast } from '@shopify/polaris';

const ToastContext = createContext();

/**
 * Custom hook to access toast functionality.
 */
export const useToast = () => useContext(ToastContext);

/**
 * Sets up the ToastProvider using Shopify Polaris Toast.
 * Wrap your app with this provider to enable toast notifications.
 */
export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ content: '', error: false, active: false });

  const showToast = useCallback((content, options = {}) => {
    setToast({
      content,
      error: options.error || false,
      active: true,
    });
  }, []);

  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, active: false }));
  }, []);

  const toastMarkup = toast.active ? (
    <Toast content={toast.content} error={toast.error} onDismiss={hideToast} />
  ) : null;

  return (
    <ToastContext.Provider value={{ showToast }}>
      <Frame>
        {children}
        {toastMarkup}
      </Frame>
    </ToastContext.Provider>
  );
}
