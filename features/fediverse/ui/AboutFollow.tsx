// "Follow on Mastodon" on the About page: the hub's handle, while the
// Fediverse feature is on. The handle is the hub's own address twice
// (@floyd.civic.social@floyd.civic.social; features/fediverse/federation.ts).

import { useHub } from "../../../ui/src/config/hub";
import "./fediverse.css";

export default function AboutFollow() {
  const hub = useHub();
  if (!hub.plugins.enabled("fediverse")) return null;
  const host = window.location.hostname;
  const handle = `@${host}@${host}`;
  return (
    <section className="about-follow" aria-labelledby="about-follow" data-testid="about-follow">
      <h2 id="about-follow">Follow on Mastodon</h2>
      <p>
        Follow <strong>{handle}</strong> from Mastodon or any fediverse app to see what opens and what is decided here.
        Search for it in your app. Voting and commenting happen on this site.
      </p>
    </section>
  );
}
