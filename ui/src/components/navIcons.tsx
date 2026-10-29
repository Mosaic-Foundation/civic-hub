// The navigation's icons (navigation slice, 2026-10-14): one per section and
// hub link, keyed by the names process types declare (TypeDisplay.icon in
// src/shared/typeDisplay.ts). A key not here draws the generic icon, so a
// plugin's type has an icon before anyone draws it one. Line icons on a
// 24px grid, stroked in currentColor, decorative: every icon sits beside its
// word, which is what a screen reader reads.

import type { ReactElement } from "react";

const PATHS: Record<string, ReactElement> = {
  feed: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  conversation: <path d="M4 5h16v10H9l-5 4z" />,
  // A whole light bulb filling the grid, so it reads at the size of its
  // neighbours (Adam, 2026-10-14: the small bulb with a dot looked tiny).
  proposal: (
    <>
      <path d="M9 21h6M10 18h4" />
      <path d="M12 2.5a6.5 6.5 0 0 0-3.8 11.8c.5.4.8.9.8 1.5V18h6v-2.2c0-.6.3-1.1.8-1.5A6.5 6.5 0 0 0 12 2.5z" />
    </>
  ),
  vote: (
    <>
      <path d="M9 12l2 2 4-5" />
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </>
  ),
  project: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V10l7-5 7 5v11" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  outcome: (
    <>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M9 12h6M9 16h6M9 8h3" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
    </>
  ),
  announcement: (
    <>
      <path d="M3 10v4h4l7 4V6L7 10z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
    </>
  ),
  meeting: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  wordcloud: <path d="M7 18a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6-1.5A4.5 4.5 0 0 1 17.5 18z" />,
  share: (
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4" />
    </>
  ),
  feedback: (
    <>
      <path d="M4 4h16v12H8l-4 4z" />
      <path d="M12 7v4M12 13.5v.5" />
    </>
  ),
  about: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  welcome: <path d="M4 20V9l8-5 8 5v11zM9 20v-5h6v5" />,
  reviews: (
    <>
      <path d="M3 13l2.5-8h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" />
      <path d="M3 13h5l1.5 2.5h5L16 13h5" />
    </>
  ),
  activity: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-6" />
    </>
  ),
  moderation: (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.5 8-8 9-4.5-1-8-4.5-8-9V6z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  edits: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </>
  ),
  archived: (
    <>
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" />
    </>
  ),
  admin: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  plugins: (
    <>
      <path d="M9 3v4M15 3v4" />
      <path d="M6 7h12v4a6 6 0 0 1-12 0z" />
      <path d="M12 17v4" />
    </>
  ),
  contact: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  submissions: (
    <>
      <path d="M6 3h12v18H6z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  "your-settings": (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  announce: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  "sign-out": (
    <>
      <path d="M15 4h4v16h-4" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  "sign-in": (
    <>
      <path d="M9 4H5v16h4" />
      <path d="M14 8l4 4-4 4M18 12H8" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  generic: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 12h8" />
    </>
  ),
};

export default function NavIcon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name] ?? PATHS.generic}
    </svg>
  );
}
