// web/frontend/domains/dashboard/icons/BulkEditIcon.jsx
import React from 'react';

const BulkEditIcon = React.memo(({ 'aria-label': ariaLabel, ...props }) => (
  <svg
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    aria-label={ariaLabel}
    role="img"
    {...props}
  >
    <rect width="64" height="64" rx="8" fill="var(--p-color-bg-fill-brand, #EBF5FF)" />
    <path
      d="M20 24h24M20 32h24M20 40h16"
      stroke="var(--p-color-icon-brand, #005BD3)"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle
      cx="44"
      cy="40"
      r="8"
      fill="var(--p-color-bg-fill-success, #E3F7E3)"
      stroke="var(--p-color-border-success, #00A651)"
      strokeWidth="2"
    />
    <path
      d="m40 40 2 2 4-4"
      stroke="var(--p-color-icon-success, #00A651)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
));

BulkEditIcon.displayName = 'BulkEditIcon';

export default BulkEditIcon;