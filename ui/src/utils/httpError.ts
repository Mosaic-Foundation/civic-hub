// The message to show for a failed API response (2026-10-06). The hub's API
// answers { error: "<text>" }, but a response that never reached it does
// not: Vercel's firewall answers 403 with { error: { code, message } }, and
// the sign-in form printed "[object Object]". Anything that is not the hub's
// own string becomes a sentence a person can act on.

export function apiErrorMessage(body: unknown, status: number, statusText = ""): string {
  const err = (body as { error?: unknown } | null)?.error;
  if (typeof err === "string" && err.trim()) return err;
  if (err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string") {
    const message = (err as { message: string }).message.trim();
    if (status === 403) return `The request was blocked before it reached the hub (${message || "403"}). Try again in a few minutes.`;
    if (message) return message;
  }
  if (status === 403) return "The request was blocked before it reached the hub (403). Try again in a few minutes.";
  return statusText ? `Request failed: ${status} ${statusText}` : `Request failed: ${status}`;
}
