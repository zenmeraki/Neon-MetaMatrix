// web/frontend/domains/dashboard/icons/ExportIcon.jsx
import React from 'react';

const ExportIcon = React.memo(({ 'aria-label': ariaLabel, ...props }) => (
  <svg
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    aria-label={ariaLabel}
    role="img"
    {...props}
  >
    <rect width="64" height="64" rx="8" fill="var(--p-color-bg-fill-warning, #FFF4E5)" />
    <path
      d="M32 16v24M24 32l8-8 8 8"
      stroke="var(--p-color-icon-warning, #B86E00)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M16 44h32v4H16z"
      fill="var(--p-color-bg-fill-warning, #B86E00)"
      rx="2"
    />
  </svg>
));

ExportIcon.displayName = 'ExportIcon';

export default ExportIcon;