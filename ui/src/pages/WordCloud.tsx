import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import {
  getWordcloud,
  submitWordcloudResponse,
  getWordcloudCloud,
  getWordcloudResponses,
  type WordcloudState,
  type WordcloudPromptCloud,
  type WordcloudCloudEntry,
  type WordcloudResponse,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import AuthModal from "../components/AuthModal";
import { useRequireAuth } from "../hooks/useRequireAuth";
import "./WordCloud.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const COLORS = ["#1e3a5f", "#2a7d4f", "#5c6bc0", "#00897b", "#37474f", "#4a148c"];
const FONT_SIZES = [14, 18, 24, 32, 42, 56];

interface PlacedWord {
  text: string;
  count: number;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  rotate: boolean;
}

function getFontSize(count: number, maxCount: number): number {
  if (maxCount <= 1) return FONT_SIZES[2];
  const ratio = count / maxCount;
  if (ratio > 0.8) return FONT_SIZES[5];
  if (ratio > 0.6) return FONT_SIZES[4];
  if (ratio > 0.4) return FONT_SIZES[3];
  if (ratio > 0.25) return FONT_SIZES[2];
  if (ratio > 0.1) return FONT_SIZES[1];
  return FONT_SIZES[0];
}

function measureWord(text: string, fontSize: number, rotate: boolean): { w: number; h: number } {
  const charW = fontSize * 0.58;
  const textW = text.length * charW;
  const textH = fontSize * 1.2;
  if (rotate) return { w: textH, h: textW };
  return { w: textW, h: textH };
}

function layoutWords(entries: WordcloudCloudEntry[], width: number, height: number): PlacedWord[] {
  if (entries.length === 0) return [];

  const maxCount = entries[0]?.count ?? 1;
  const placed: PlacedWord[] = [];
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
  const cx = width / 2;
  const cy = height / 2;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const fontSize = getFontSize(entry.count, maxCount);
    const color = COLORS[i % COLORS.length];
    const rotate = i >= 2 && (hashCode(entry.text) % 10) < 3;
    const { w: wordW, h: wordH } = measureWord(entry.text, fontSize, rotate);

    let bestX = cx;
    let bestY = cy;
    let found = false;

    for (let t = 0; t < 2500 && !found; t++) {
      const angle = t * 0.1;
      const radius = 1 + t * 0.35;
      const tx = cx + radius * Math.cos(angle) - wordW / 2;
      const ty = cy + radius * Math.sin(angle) - wordH / 2;

      if (tx < 0 || ty < 0 || tx + wordW > width || ty + wordH > height) continue;

      let collides = false;
      const pad = 3;
      for (const box of occupied) {
        if (
          tx < box.x + box.w + pad &&
          tx + wordW + pad > box.x &&
          ty < box.y + box.h + pad &&
          ty + wordH + pad > box.y
        ) {
          collides = true;
          break;
        }
      }

      if (!collides) {
        bestX = tx;
        bestY = ty;
        found = true;
      }
    }

    if (found) {
      occupied.push({ x: bestX, y: bestY, w: wordW, h: wordH });
      placed.push({
        text: entry.text,
        count: entry.count,
        x: bestX + wordW / 2,
        y: bestY + wordH / 2,
        fontSize,
        color,
        rotate,
      });
    }
  }

  return placed;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function CloudViz({ entries }: { entries: WordcloudCloudEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width } = entry.contentRect;
      if (width > 0) {
        setDims({ width, height: Math.max(300, Math.min(width * 0.65, 500)) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const placed = useMemo(
    () => dims ? layoutWords(entries, dims.width, dims.height) : [],
    [entries, dims],
  );

  if (entries.length === 0) {
    return (
      <div className="wordcloud-cloud" ref={containerRef}>
        <span className="wordcloud-cloud-empty">
          No submissions yet — be the first to contribute!
        </span>
      </div>
    );
  }

  return (
    <div className="wordcloud-cloud" ref={containerRef} role="img" aria-label="Word cloud visualization">
      {dims && (
        <svg
          width={dims.width}
          height={dims.height}
          viewBox={`0 0 ${dims.width} ${dims.height}`}
          className="wordcloud-svg"
        >
          {placed.map((w) => (
            <text
              key={w.text}
              x={w.x}
              y={w.y}
              fontSize={w.fontSize}
              fill={w.color}
              textAnchor="middle"
              dominantBaseline="central"
              fontWeight={w.fontSize >= 32 ? 700 : w.fontSize >= 24 ? 600 : 400}
              fontFamily="'Inter', 'Segoe UI', system-ui, sans-serif"
              transform={w.rotate ? `rotate(90, ${w.x}, ${w.y})` : undefined}
            >
              <title>{`${w.text} — ${w.count} ${w.count === 1 ? "mention" : "mentions"}`}</title>
              {w.text}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}

function RankedList({ entries }: { entries: WordcloudCloudEntry[] }) {
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="wordcloud-accordion">
      <button
        className="wordcloud-accordion-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>Word rank</span>
        <span className={`wordcloud-accordion-chevron${open ? " open" : ""}`} />
      </button>
      {open && (
        <ol className="wordcloud-ranked-list" aria-label="Ranked word list">
          {entries.map((entry) => (
            <li key={entry.text} className="wordcloud-ranked-item">
              <span className="wordcloud-ranked-word">{entry.text}</span>
              <span className="wordcloud-ranked-count">
                {entry.count} {entry.count === 1 ? "mention" : "mentions"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SubmitForm({
  processId,
  promptId,
  maxLength,
  onSubmitted,
  onRevealed,
}: {
  processId: string;
  promptId: string;
  maxLength: number;
  onSubmitted: () => void;
  onRevealed: () => void;
}) {
  const { actorId } = useAuth();
  const { showAuthModal, closeAuthModal, handleAuthComplete, requireAuth } =
    useRequireAuth();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;

    if (!actorId) {
      requireAuth(() => {});
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await submitWordcloudResponse(processId, promptId, text.trim());
      setSubmitted(true);
      setText("");
      onSubmitted();
      onRevealed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="wordcloud-form">
        <p className="wordcloud-form-success">
          Thanks for contributing! Your response has been added to the cloud.
        </p>
      </div>
    );
  }

  const remaining = maxLength - text.length;

  return (
    <form className="wordcloud-form" onSubmit={handleSubmit}>
      {showAuthModal && (
        <AuthModal onComplete={handleAuthComplete} onDismiss={closeAuthModal} />
      )}
      <label className="wordcloud-form-label" htmlFor={`wc-input-${promptId}`}>
        Add your response
      </label>
      <div className="wordcloud-form-row">
        <input
          id={`wc-input-${promptId}`}
          className="wordcloud-form-input"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="In a few words..."
          maxLength={maxLength}
          disabled={submitting}
        />
        <button
          type="submit"
          className="wordcloud-submit-btn"
          disabled={submitting || !text.trim() || text.length > maxLength}
        >
          {submitting ? "..." : "Submit"}
        </button>
      </div>
      <div
        className={`wordcloud-form-char-count${remaining < 20 ? " over-limit" : ""}`}
      >
        {remaining} characters remaining
      </div>
      {error && <p className="wordcloud-form-error">{error}</p>}
    </form>
  );
}

function ResponsesList({
  processId,
  promptId,
  refreshKey,
}: {
  processId: string;
  promptId: string;
  refreshKey: number;
}) {
  const [open, setOpen] = useState(false);
  const [responses, setResponses] = useState<WordcloudResponse[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoaded(false);
    getWordcloudResponses(processId, promptId)
      .then((data) => {
        setResponses(data.responses);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [open, processId, promptId, refreshKey]);

  return (
    <div className="wordcloud-accordion">
      <button
        className="wordcloud-accordion-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>All responses</span>
        <span className={`wordcloud-accordion-chevron${open ? " open" : ""}`} />
      </button>
      {open && (
        <ul className="wordcloud-responses-list" aria-label="Community responses">
          {!loaded && <li className="wordcloud-response-item">Loading...</li>}
          {loaded && responses.length === 0 && (
            <li className="wordcloud-response-item wordcloud-response-empty">No responses yet.</li>
          )}
          {responses.map((r) => (
            <li key={r.id} className="wordcloud-response-item">
              <span className="wordcloud-response-body">{r.body}</span>
              <span className="wordcloud-response-date">
                {formatDate(r.submitted_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PromptSection({
  processId,
  prompt,
  cloud,
  isActive,
  isOnboarding,
  hasSubmitted,
  maxLength,
  onSubmitted,
  refreshKey,
}: {
  processId: string;
  prompt: { id: string; text: string; max_length?: number };
  cloud: WordcloudPromptCloud | undefined;
  isActive: boolean;
  /** The cloud is only held back during onboarding — see `revealed` below. */
  isOnboarding: boolean;
  hasSubmitted: boolean;
  maxLength: number;
  onSubmitted: () => void;
  refreshKey: number;
}) {
  // The "add yours to reveal" trade is an ONBOARDING device: a new arrival is
  // asked for their word before they see everyone else's, so their answer is
  // their own. Every other visit shows the cloud straight away — people who
  // came to look should not be made to pay for it — and the form stays on
  // offer underneath until they contribute their one response.
  const [revealed, setRevealed] = useState(
    !isActive || hasSubmitted || !isOnboarding,
  );

  useEffect(() => {
    if (hasSubmitted) setRevealed(true);
  }, [hasSubmitted]);
  const entries = cloud?.entries ?? [];
  const effectiveMax = prompt.max_length ?? maxLength;
  const totalSubmissions = cloud?.total_submissions ?? 0;

  return (
    <section className="wordcloud-prompt-section">
      <h2 className="wordcloud-prompt-text">{prompt.text}</h2>

      {isActive && !hasSubmitted && (
        <SubmitForm
          processId={processId}
          promptId={prompt.id}
          maxLength={effectiveMax}
          onSubmitted={onSubmitted}
          onRevealed={() => setRevealed(true)}
        />
      )}

      {isActive && hasSubmitted && (
        <p className="wordcloud-form-done">
          Thanks for contributing — you have added your response to this prompt.
        </p>
      )}

      <div className={`wordcloud-cloud-wrapper${revealed ? " wordcloud-cloud-revealed" : ""}`}>
        <CloudViz entries={entries} />
        {!revealed && (
          <div className="wordcloud-cloud-overlay">
            <p className="wordcloud-cloud-overlay-cta">
              Add yours to reveal the cloud
            </p>
            {totalSubmissions > 0 && (
              <p className="wordcloud-cloud-overlay-count">
                {totalSubmissions} {totalSubmissions === 1 ? "person has" : "people have"} shared so far
              </p>
            )}
          </div>
        )}
      </div>

      {revealed && cloud && (
        <p className="wordcloud-submission-count">
          {cloud.total_submissions}{" "}
          {cloud.total_submissions === 1 ? "response" : "responses"}
        </p>
      )}

      {revealed && (
        <ResponsesList
          processId={processId}
          promptId={prompt.id}
          refreshKey={refreshKey}
        />
      )}

      {revealed && <RankedList entries={entries} />}
    </section>
  );
}

export default function WordCloud() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { actorId, loading: authLoading } = useAuth();
  const isOnboarding = searchParams.get("onboarding") === "1";
  const [wc, setWc] = useState<WordcloudState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchData = useCallback(async () => {
    if (!id || authLoading) return;
    try {
      const data = await getWordcloud(id);
      setWc(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id, actorId, authLoading]);

  const refreshCloud = useCallback(async () => {
    if (!id) return;
    setRefreshKey((k) => k + 1);
    setWc((prev) => prev ? { ...prev, has_submitted: true } : prev);
    try {
      const data = await getWordcloudCloud(id);
      setWc((prev) =>
        prev
          ? {
              ...prev,
              clouds: data.clouds,
              submission_count: data.submission_count,
            }
          : prev,
      );
    } catch {
      // Silently fail on refresh — stale cloud is fine
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <p className="wordcloud-page">Loading...</p>;
  if (error)
    return (
      <div className="wordcloud-page">
        <p className="error">Error: {error}</p>
      </div>
    );
  if (!wc) return (
    <div className="page wordcloud-page">
      <p>Not found.</p>
    </div>
  );

  const isActive = wc.status === "active";

  return (
    <div className="wordcloud-page">
      {isOnboarding && (
        <button
          className="wordcloud-skip-btn"
          onClick={() => navigate("/")}
        >
          Skip &rarr;
        </button>
      )}

      {isOnboarding && !wc.has_submitted && (
        <div className="wordcloud-onboarding-banner">
          <h2>One quick thing before you dive in</h2>
          <p>
            This is optional — tell us in a few words what you love about
            Floyd, or skip straight to the feed.
          </p>
        </div>
      )}

      <div className="wordcloud-header">
        <h1>
          {wc.title}
          <span className={`wordcloud-status status-${wc.status}`}>
            {wc.status}
          </span>
        </h1>
        {wc.description && (
          <p className="wordcloud-description">{wc.description}</p>
        )}
        <div className="wordcloud-meta">
          <span>Created {formatDate(wc.created_at)}</span>
          <span>
            {wc.submission_count}{" "}
            {wc.submission_count === 1 ? "response" : "responses"} total
          </span>
        </div>
      </div>

      {wc.prompts.map((prompt) => {
        const cloud = wc.clouds.find((c) => c.prompt_id === prompt.id);
        return (
          <PromptSection
            key={prompt.id}
            processId={wc.id}
            prompt={prompt}
            cloud={cloud}
            isActive={isActive}
            isOnboarding={isOnboarding}
            hasSubmitted={wc.has_submitted}
            maxLength={wc.config.max_submission_length}
            onSubmitted={refreshCloud}
            refreshKey={refreshKey}
          />
        );
      })}
    </div>
  );
}
