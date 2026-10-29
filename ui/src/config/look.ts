// The design pass's two directions, A and B, on dev for Adam to compare
// (2026-10-29). TEMPORARY: ?look=a or ?look=b sets data-look on <html>
// (styles/tokens/looks.css holds the two token sets) and is remembered for
// the tab; ?look=off clears it. Without it the hub looks as it did. The
// commit that applies the chosen direction deletes this file.

const KEY = "civic_design_look";
const LOOKS = ["a", "b"] as const;

function stored(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function store(value: string | null): void {
  try {
    if (value) sessionStorage.setItem(KEY, value);
    else sessionStorage.removeItem(KEY);
  } catch {
    // Blocked storage: the flag holds for this page only.
  }
}

export function applyDesignLook(): void {
  if (typeof document === "undefined") return;
  const asked = new URLSearchParams(window.location.search).get("look")?.toLowerCase() ?? null;
  if (asked === "off") store(null);
  else if (asked && (LOOKS as readonly string[]).includes(asked)) store(asked);
  const look = stored();
  if (look && (LOOKS as readonly string[]).includes(look)) document.documentElement.dataset.look = look;
  else delete document.documentElement.dataset.look;
}
