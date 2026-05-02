// web/frontend/context/ToastContext.js
import React, { createContext, useContext, useState } from 'react';
import { Toast, Frame } from '@shopify/polaris';

const ToastContext = createContext();

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  const showToast = (content, primaryAction, secondaryAction) => {
    setToast({ content, primaryAction, secondaryAction });
  };

  const hideToast = () => {
    setToast(null);
  };

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      <Frame>
        {children}
        {toast && (
          <Toast
            content={toast.content}
            error={true}
            onDismiss={hideToast}
            action={toast.primaryAction}
            secondaryAction={toast.secondaryAction}
            duration={5000}
          />
        )}
      </Frame>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}