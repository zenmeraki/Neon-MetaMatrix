// web/frontend/domains/dashboard/icons/ChangelogIcon.jsx
import React from 'react';

const ChangelogIcon = React.memo(({ 'aria-label': ariaLabel, ...props }) => (
  <svg
    width="64"
    height="64"
    viewBox="0 0 64 64"
    fill="none"
    aria-label={ariaLabel}
    role="img"
    {...props}
  >
    <rect width="64" height="64" rx="8" fill="var(--p-color-bg-fill-critical-subdued, #FFF4F4)" />
    <rect
      x="20"
      y="16"
      width="24"
      height="32"
      rx="2"
      fill="white"
      stroke="var(--p-color-border-subdued, #E1E3E5)"
    />
    <circle
      cx="32"
      cy="24"
      r="2"
      fill="var(--p-color-icon-critical, #D72C0D)"
    />
    <path
      d="M28 32h8M26 36h12M28 40h8"
      stroke="var(--p-color-text-subdued, #6D7175)"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
));

ChangelogIcon.displayName = 'ChangelogIcon';

export default ChangelogIcon;