import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted variable fonts. Bundled by Vite — no external CDN call.
import '@fontsource-variable/inter/index.css'
import '@fontsource-variable/libre-franklin/index.css'
import '@fontsource-variable/manrope/index.css'
import './styles/theme.css'
import './index.css'
import App from './App.tsx'
import { loadHubConfig, applyHubHead } from './config/hubConfig'
import { HubConfigProvider } from './config/HubConfigContext'

// Slice 11 follow-up: hard-disable pinch zoom on iOS.
// `maximum-scale=1` in the viewport meta is increasingly ignored by
// modern iOS Safari (Apple respects user accessibility scaling). The
// reliable belt-and-braces approach is to swallow gesture events at
// the document level. We also defang the iOS "double-tap to zoom"
// behavior by snapping any rogue zoom back to 1.0 on touchend.
//
// We attach these BEFORE React mounts so they're active on first
// paint. They're idempotent and the listeners stay for the life of
// the document; no cleanup needed.
if (typeof document !== "undefined") {
  // gesture* events are iOS-Safari-specific and fire on pinch.
  document.addEventListener("gesturestart", (e) => e.preventDefault(), {
    passive: false,
  });
  document.addEventListener("gesturechange", (e) => e.preventDefault(), {
    passive: false,
  });
  document.addEventListener("gestureend", (e) => e.preventDefault(), {
    passive: false,
  });
  // Two-finger touchmove is the cross-browser way pinch zooms reach
  // the page. Block it preemptively. Single-finger scrolling is left
  // alone (e.touches.length === 1).
  document.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // Double-tap-to-zoom: track time between touchends; if two land
  // within 300ms, swallow the second so iOS doesn't trigger zoom.
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) e.preventDefault();
      lastTouchEnd = now;
    },
    { passive: false },
  );
}

// Which hub is this? Decided by the hostname, so it has to be fetched before
// anything renders: a first paint with the wrong hub's name and banner, then
// a correction, is worse than waiting one round trip. loadHubConfig never
// rejects — if the hub cannot be reached we render on the build-time
// VITE_HUB_* fallbacks rather than showing nothing.
await loadHubConfig()
applyHubHead()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HubConfigProvider>
      <App />
    </HubConfigProvider>
  </StrictMode>,
)
