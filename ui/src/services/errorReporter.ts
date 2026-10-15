// Errors the page hits, sent to the hub's own /api/client-errors (operations
// shell, ADR-006), which scrubs them and forwards them to error tracking.
//
// Uncaught errors and unhandled promise rejections only: an error the page
// already shows the person (a failed save, a refused request) is the API's
// answer and was reported there if it was unexpected. Nothing personal is
// read here: the error's name, message and stack, the page's path (the
// server drops any query and replaces ids and tokens), which page this is,
// and the build. Production builds only; at most five reports per page load,
// and each distinct message once.

declare const __CIVIC_COMMIT__: string;

type Surface = "hub" | "console" | "start";

const MAX_PER_PAGE = 5;
let sent = 0;
const seen = new Set<string>();

function endpoint(): string {
  return import.meta.env.DEV ? "http://localhost:3000/client-errors" : "/api/client-errors";
}

export function reportClientError(error: unknown, surface: Surface): void {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-error thrown");
  const message = err.message || "(no message)";
  const key = `${err.name}:${message}`;
  if (sent >= MAX_PER_PAGE || seen.has(key)) return;
  seen.add(key);
  sent += 1;
  const body = JSON.stringify({
    name: err.name,
    message,
    stack: err.stack ?? "",
    path: window.location.pathname,
    surface,
    commit: typeof __CIVIC_COMMIT__ === "string" ? __CIVIC_COMMIT__ : "",
  });
  try {
    // keepalive: the report still goes if the error is followed by a navigation.
    void fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // Reporting must never throw.
  }
}

/** Listen for uncaught errors and rejections on this page. Call once, before render. */
export function installErrorReporter(surface: Surface): void {
  if (!import.meta.env.PROD) return;
  window.addEventListener("error", (e) => {
    // A failed <img> or <script> load is an Event without an error: not ours to report.
    if (e.error !== undefined && e.error !== null) reportClientError(e.error, surface);
  });
  window.addEventListener("unhandledrejection", (e) => reportClientError(e.reason, surface));
}
