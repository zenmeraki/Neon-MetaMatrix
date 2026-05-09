// web/frontend/utils/analytics.js

export const trackEvent = (eventName, data = {}) => {
  if (window.gtag) {
    window.gtag('event', eventName, data);
  } else {
  }
};
