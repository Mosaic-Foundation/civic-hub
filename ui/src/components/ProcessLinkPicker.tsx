import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLinkCandidates,
  type LinkCandidate,
  type ProposedLink,
  type RelationType,
} from "../services/api";
import "./ProcessLinkPicker.css";

/**
 * Search-as-you-type picker for relating one process to another.
 *
 * Deliberately knows nothing about process types. It searches every process in
 * the hub through one endpoint, so a process type registered later is
 * pickable here the day it exists.
 *
 * Two ways to find something:
 *   - type, and the hub's existing full-text search answers; or
 *   - open it having typed nothing, and the current draft's own title and
 *     description seed the query, putting likely links in front of the author
 *     before they think to look.
 *
 * Nothing here is required. The field starts empty and staying empty is a
 * perfectly good answer.
 */

const RELATION_OPTIONS: Array<{
  value: RelationType;
  label: string;
  hint: string;
}> = [
  { value: "continues", label: "Continues", hint: "Picks up where an earlier process left off" },
  { value: "references", label: "References", hint: "Cites or draws on another process" },
  { value: "implements", label: "Implements", hint: "Carries out what another process decided" },
];

interface Props {
  /** Ids to keep out of the results — the current process and anything
   *  already linked. */
  exclude?: string[];
  /** Seeds the auto-suggested candidates shown before the user types. */
  seedTitle?: string;
  seedDescription?: string;
  onPick: (link: ProposedLink, peer: LinkCandidate) => void;
  onCancel?: () => void;
  busy?: boolean;
}

export default function ProcessLinkPicker({
  exclude = [],
  seedTitle = "",
  seedDescription = "",
  onPick,
  onCancel,
  busy = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [relation, setRelation] = useState<RelationType>("references");
  const [candidates, setCandidates] = useState<LinkCandidate[]>([]);
  const [suggested, setSuggested] = useState(false);
  const [selected, setSelected] = useState<LinkCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  // Guards against an earlier, slower request overwriting a later one's
  // results — the classic typeahead race.
  const requestSeq = useRef(0);

  // Serialize so the effect below doesn't re-fire on every render just
  // because the parent passed a fresh array literal.
  const excludeKey = exclude.join(",");

  const runSearch = useCallback(
    async (q: string) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const res = await getLinkCandidates({
          q: q.trim() || undefined,
          seedTitle: q.trim() ? undefined : seedTitle,
          seedDescription: q.trim() ? undefined : seedDescription,
          exclude: excludeKey ? excludeKey.split(",") : [],
        });
        if (seq !== requestSeq.current) return; // a newer search has landed
        setCandidates(res.candidates);
        setSuggested(res.suggested);
        setActiveIndex(-1);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        setError(err instanceof Error ? err.message : "Search failed");
        setCandidates([]);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [excludeKey, seedTitle, seedDescription],
  );

  // Debounced search. The empty-query case still runs — that is what fetches
  // the auto-suggestions when the picker first opens.
  useEffect(() => {
    const t = setTimeout(() => void runSearch(query), query.trim() ? 250 : 0);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function choose(candidate: LinkCandidate) {
    setSelected(candidate);
    setQuery(candidate.title);
    setCandidates([]);
    setActiveIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
      return;
    }
    if (candidates.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % candidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? candidates.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const picked = candidates[activeIndex];
      if (picked) choose(picked);
    }
  }

  function confirm() {
    if (!selected) return;
    onPick({ to_id: selected.id, relation }, selected);
    setSelected(null);
    setQuery("");
    setCandidates([]);
  }

  const activeHint = RELATION_OPTIONS.find((r) => r.value === relation)?.hint;

  return (
    <div className="link-picker">
      <div className="link-picker__row">
        <label className="link-picker__field">
          <span className="link-picker__label">Find a related process</span>
          <input
            ref={inputRef}
            type="text"
            className="link-picker__input"
            value={query}
            placeholder="Search votes, proposals, projects, conversations…"
            autoComplete="off"
            role="combobox"
            aria-expanded={candidates.length > 0}
            aria-controls="link-picker-results"
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(null);
            }}
            onKeyDown={handleKeyDown}
          />
        </label>

        <label className="link-picker__field link-picker__field--relation">
          <span className="link-picker__label">Relationship</span>
          <select
            className="link-picker__select"
            value={relation}
            onChange={(e) => setRelation(e.target.value as RelationType)}
          >
            {RELATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeHint && <p className="link-picker__hint">{activeHint}</p>}

      {loading && <p className="link-picker__status">Searching…</p>}
      {error && <p className="link-picker__status link-picker__status--error">{error}</p>}

      {!loading && candidates.length > 0 && (
        <>
          {suggested && (
            <p className="link-picker__status">
              Suggested from what you have written — or type to search.
            </p>
          )}
          <ul className="link-picker__results" id="link-picker-results" role="listbox">
            {candidates.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  className={`link-picker__result${i === activeIndex ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => choose(c)}
                >
                  <span className="link-picker__result-title">{c.title}</span>
                  <span className="link-picker__result-meta">
                    {friendlyType(c.type)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {!loading && !selected && candidates.length === 0 && query.trim().length > 0 && (
        <p className="link-picker__status">No matching processes.</p>
      )}

      <div className="link-picker__actions">
        <button
          type="button"
          className="link-picker__confirm"
          disabled={!selected || busy}
          onClick={confirm}
        >
          {busy ? "Linking…" : "Add link"}
        </button>
        {onCancel && (
          <button type="button" className="link-picker__cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Human label for a process type. Falls back to the bare type for anything
 * unrecognized, so a process type added later is merely unpolished here, never
 * broken or invisible.
 */
export function friendlyType(type: string): string {
  const map: Record<string, string> = {
    "civic.vote": "Vote",
    "civic.proposal": "Proposal",
    "civic.project": "Project",
    "civic.polis_deliberation": "Conversation",
    "civic.wordcloud": "Word cloud",
    "civic.announcement": "Announcement",
    "civic.meeting_summary": "Meeting summary",
    "civic.vote_results": "Vote results",
    "civic.brief": "Brief",
  };
  return map[type] ?? type.replace(/^civic\./, "").replace(/_/g, " ");
}
