// An invite to create a hub, in words: the link that carries the code and the
// message the console copies. Shared by the console and the invite email.
// Pure.
//
// The code rides in the fragment, as a handoff token does: it never reaches a
// server's log or another site's Referer, and the start page takes it out of
// the address bar once read (ui/src/start/App.tsx). It adds nothing a copied
// code couldn't do: the code stays single-use and expiring.

export const INVITE_SUBJECT = "Here's your invite to create a Civic Hub";

export function inviteLink(startHost: string, code: string): string {
  return `https://${startHost}/#code=${encodeURIComponent(code)}`;
}

/** The start page's own part of the link: the code in a fragment, or null. */
export function codeFromFragment(hash: string): string | null {
  const m = /^#code=([^&]+)$/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).toUpperCase();
  } catch {
    return null;
  }
}

/** What the console's copy button puts on the clipboard. */
export function inviteMessage(startHost: string, code: string): string {
  return `${INVITE_SUBJECT}. Open this link: ${inviteLink(startHost, code)}\n\nOr go to https://${startHost} and enter this code: ${code}`;
}
