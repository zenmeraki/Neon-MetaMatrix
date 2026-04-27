// web/frontend/domains/dashboard/icons/SpreadsheetIcon.jsx
import React from 'react';

const SpreadsheetIcon = React.memo(({ 'aria-label': ariaLabel, ...props }) => (
  <svg
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    aria-label={ariaLabel}
    role="img"
    {...props}
  >
    <rect width="64" height="64" rx="8" fill="var(--p-color-bg-fill-info, #E7F7FF)" />
    <rect
      x="16"
      y="16"
      width="32"
      height="32"
      rx="2"
      fill="white"
      stroke="var(--p-color-border-subdued, #E1E3E5)"
    />
    <path d="M16 26h32M16 34h32M26 16v32M36 16v32" stroke="var(--p-color-border-subdued, #E1E3E5)" />
    <rect x="18" y="18" width="6" height="6" fill="var(--p-color-bg-fill-brand, #005BD3)" rx="1" />
  </svg>
));

SpreadsheetIcon.displayName = 'SpreadsheetIcon';

export default SpreadsheetIcon;