// The vote receipts this browser holds (ballot secrecy, 2026-10-10).
//
// The hub keeps no record that links a resident to their ballot, so the
// voter's browser is the only place that knows which receipt is theirs. A
// first vote returns the receipt and a change key, once; they are kept here,
// per hub (localStorage is per origin), per account and per vote, with the
// choice the receipt carries. Changing a vote sends the receipt and key back.
// A browser without them (another device, cleared site data) cannot change
// the vote; it still counts.
//
// Kept per account so a second person signing in on the same browser is
// never offered someone else's receipt. Signing out keeps it: signing back in
// on this browser can still change the vote. Every access is wrapped:
// storage can be missing or throw (private windows), and the panel then
// behaves as on a new device.

export interface HeldReceipt {
  receipt_id: string;
  change_key: string;
  /** The choice the receipt carries, as last cast from this browser. */
  choice: string | string[];
}

const PREFIX = "civic.voteReceipt.v1";

function storageKey(userId: string, processId: string): string {
  return `${PREFIX}:${userId}:${processId}`;
}

function isHeld(v: unknown): v is HeldReceipt {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const choiceOk =
    typeof r.choice === "string" || (Array.isArray(r.choice) && r.choice.every((c) => typeof c === "string"));
  return typeof r.receipt_id === "string" && typeof r.change_key === "string" && choiceOk;
}

export function getHeldReceipt(userId: string, processId: string): HeldReceipt | null {
  if (!userId || userId === "anonymous") return null;
  try {
    const raw = localStorage.getItem(storageKey(userId, processId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isHeld(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Returns false when the browser would not keep it. */
export function saveHeldReceipt(userId: string, processId: string, receipt: HeldReceipt): boolean {
  if (!userId || userId === "anonymous") return false;
  try {
    localStorage.setItem(storageKey(userId, processId), JSON.stringify(receipt));
    return true;
  } catch {
    return false;
  }
}

export function dropHeldReceipt(userId: string, processId: string): void {
  try {
    localStorage.removeItem(storageKey(userId, processId));
  } catch {
    // Nothing to do: storage is unavailable, so nothing was held either.
  }
}
