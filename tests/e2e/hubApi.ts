/**
 * Where the E2E specs read the hub's API directly (its /hub-config, a
 * settings write). The dev server by default; a production build behind
 * `vite preview` passes its own proxied `/api`:
 *
 *   CIVIC_E2E_API_BASE=http://localhost:4194/api npx playwright test
 */
export const E2E_API_BASE = process.env.CIVIC_E2E_API_BASE?.trim() || "http://localhost:3000";
