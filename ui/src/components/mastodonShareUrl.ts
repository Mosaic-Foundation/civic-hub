// Share on Mastodon's two pure parts (MastodonShare.tsx): the server a person
// means, and the compose link on it.

/**
 * The server's hostname from what a person types: "mastodon.social",
 * "https://mastodon.social/home", "@adam@mastodon.social" or
 * "adam@mastodon.social". Null when it isn't a hostname.
 */
export function mastodonServerFrom(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s.includes("@")) s = s.slice(s.lastIndexOf("@") + 1);
  s = s.replace(/^[a-z]+:\/\//, "").replace(/[/?#].*$/, "");
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) return null;
  return s;
}

/** The compose page on `server` with `text` filled in. */
export function mastodonShareUrl(server: string, text: string): string {
  return `https://${server}/share?text=${encodeURIComponent(text)}`;
}

/**
 * The hub's own post about this item, opened on `server` so the person can
 * boost it or reply to it: Mastodon's remote-interaction page fetches the
 * post and shows it as a follower sees it.
 */
export function mastodonInteractUrl(server: string, noteUri: string): string {
  return `https://${server}/authorize_interaction?uri=${encodeURIComponent(noteUri)}`;
}
