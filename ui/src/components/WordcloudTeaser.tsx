import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getWordcloudCloud } from "../services/api";
import hub from "../config/hub";
import "./WordcloudTeaser.css";

/**
 * Module-scoped cache of the cloud fetch.
 *
 * The teaser is mounted in two mutually exclusive branches of App (the beta
 * splash and the main app). Only one renders at a time, but the auth-loading
 * transition swaps between those subtrees, so React unmounts one and mounts the
 * other — and the effect ran twice, firing the same request twice on every
 * cold page load. It was the slowest thing on any page (480ms + 244ms, against
 * 154ms for the actual page content).
 *
 * Caching the promise rather than the value means concurrent mounts share one
 * in-flight request instead of racing.
 *
 * The module cache dies with the page, so sessionStorage carries it across
 * reloads and new tabs — the banner then paints from cache immediately instead
 * of waiting on the slowest request on the site. Cloud contents change on the
 * order of days and the cache dies with the tab, so no TTL is needed.
 */
const CACHE_KEY = "wordcloud-teaser-cache-v1";

type CloudResponse = Awaited<ReturnType<typeof getWordcloudCloud>>;

let cloudRequest: Promise<CloudResponse> | null = null;

function readCache(id: string): CloudResponse | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { id: string; data: CloudResponse };
    return parsed.id === id ? parsed.data : null;
  } catch {
    // Private windows and blocked site-data both throw here. A cache miss is
    // always survivable, so never let storage break the banner.
    return null;
  }
}

function writeCache(id: string, data: CloudResponse): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ id, data }));
  } catch {
    /* quota or blocked storage — the in-memory cache still applies */
  }
}

function loadCloud(id: string): Promise<CloudResponse> {
  const cached = readCache(id);
  if (cached) return Promise.resolve(cached);
  if (!cloudRequest) {
    cloudRequest = getWordcloudCloud(id).then((res) => {
      writeCache(id, res);
      return res;
    });
    // A failed request must not be cached as a permanent failure — the next
    // mount should be free to try again.
    cloudRequest.catch(() => {
      cloudRequest = null;
    });
  }
  return cloudRequest;
}

// A slim, always-near-the-top affordance pointing at the community word cloud.
// Shows the actual submitted words rotating through; when the cloud is empty it
// invites the visitor to be the first. Hidden entirely when no word cloud is
// configured (VITE_HUB_ONBOARDING_WORDCLOUD_ID) or the fetch fails, so it never
// renders a broken/empty bar.
export default function WordcloudTeaser() {
  const id = hub.onboarding_wordcloud_id;
  const [words, setWords] = useState<string[]>([]);
  const [prompt, setPrompt] = useState<string>("");
  const [hidden, setHidden] = useState(false);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!id) {
      setHidden(true);
      return;
    }
    let cancelled = false;
    loadCloud(id)
      .then((res) => {
        if (cancelled) return;
        const cloud = res.clouds?.[0];
        if (!cloud) {
          setHidden(true);
          return;
        }
        setPrompt(cloud.prompt_text || "");
        const top = [...(cloud.entries || [])]
          .sort((a, b) => b.count - a.count)
          .slice(0, 20)
          .map((e) => e.text);
        setWords(top);
      })
      .catch(() => setHidden(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Rotate the visible word once the cloud has at least two.
  useEffect(() => {
    if (words.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % words.length), 2200);
    return () => clearInterval(t);
  }, [words]);

  if (hidden || !id) return null;

  const hasWords = words.length > 0;
  const current = hasWords ? words[idx % words.length] : "";

  return (
    <Link
      to={`/wordcloud/${id}`}
      className="wc-teaser"
      aria-label="View the community word cloud"
    >
      <span className="wc-teaser-icon" aria-hidden="true">✦</span>
      <span className="wc-teaser-label">Community word cloud</span>
      <span className="wc-teaser-sep" aria-hidden="true">·</span>
      {hasWords ? (
        <span className="wc-teaser-rotator">
          <span key={idx} className="wc-teaser-word">
            {current}
          </span>
        </span>
      ) : (
        <span className="wc-teaser-empty">
          {prompt ? `${prompt} ` : ""}Be the first to add a word
        </span>
      )}
      <span className="wc-teaser-cta" aria-hidden="true">→</span>
    </Link>
  );
}
