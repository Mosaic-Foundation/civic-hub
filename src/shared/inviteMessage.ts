// The message "Share this hub" prefills for an invite (members and invites
// slice): the hub's intro and one line from the member. Shared, so the server
// can tell a message the member left as the page wrote it, which needs no
// Code of Conduct check (the cleanup slice, Adam's decision 2026-10-16: the
// hub wrote it), from one they changed, which does. Pure.

export const INVITE_MESSAGE_CLOSING = "I'm a member and thought you'd want to join too.";

/** The prefilled message for a hub whose intro reads `introBody`. */
export function defaultInviteMessage(introBody: string): string {
  return `${introBody}\n\n${INVITE_MESSAGE_CLOSING}`;
}

/** Line endings and outer space don't make a message different. */
export function sameInviteMessage(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\r\n?/g, "\n").trim();
  return norm(a) === norm(b);
}
