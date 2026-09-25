import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { pluginEnabled } from "../config/plugins";
import "./ProcessPicker.css";

export type PickerContext = "conversation" | "proposal" | "vote" | "project" | null;

interface Props {
  onDismiss: () => void;
  context?: PickerContext;
}

const ICONS = {
  conversation: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10h0M12 10h0M16 10h0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  proposal: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 21h6M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10" y1="17" x2="10" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="14" y1="17" x2="14" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  vote: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 12.5l2.5 2.5L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  project: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
} as const;

const INTENTS = [
  {
    key: "conversation" as const,
    label: "Start a conversation",
    description:
      "A structured way to gather broad input and see where people stand on a topic.",
    route: "/deliberations/new",
    badge: "When in doubt, start here",
    guidance:
      "Residents share their views; responses cluster into opinion groups, surfacing common ground.",
    guidanceWeight: "light" as const,
  },
  {
    key: "proposal" as const,
    label: "Make a proposal",
    description:
      "Put an idea forward to see who supports it, and gather comments for nuanced feedback — a simple way to gauge interest before deciding what’s next.",
    route: "/propose/new",
    badge: null,
    guidance:
      "For a broad or divisive idea, a conversation first can surface common ground before people take a position.",
    guidanceWeight: "prominent" as const,
  },
  {
    key: "vote" as const,
    label: "Create a vote",
    description: "Put a specific question to the community to decide.",
    route: "/votes/new",
    badge: null,
    guidance:
      "Best for clear, discrete questions. For broad or divisive topics, a conversation first usually surfaces common ground.",
    guidanceWeight: "prominent" as const,
  },
  {
    key: "project" as const,
    label: "Begin a project",
    description: "Convene people to do something together.",
    route: "/projects/new",
    badge: null,
    guidance:
      "Not quite sure what to build yet? Start a conversation first.",
    guidanceWeight: "light" as const,
  },
];

export default function ProcessPicker({ onDismiss, context = null }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();

  // Hidden when the hub switched the plugin off (config/plugins.tsx) — each
  // intent's key doubles as its plugin id.
  const orderedIntents = useMemo(() => {
    const available = INTENTS.filter((i) => pluginEnabled(i.key));
    if (!context) return available;
    const promoted = available.find((i) => i.key === context);
    if (!promoted) return available;
    return [promoted, ...available.filter((i) => i.key !== context)];
  }, [context]);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal();
  }, []);

  function handlePick(route: string) {
    onDismiss();
    navigate(route);
  }

  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) onDismiss();
  }

  return (
    <dialog
      ref={dialogRef}
      className="picker"
      aria-labelledby="picker-title"
      onClick={handleClick}
      onClose={onDismiss}
    >
      <div className="picker-body">
        <div className="picker-header">
          <div>
            <h2 id="picker-title" className="picker-title">
              What would you like to start?
            </h2>
            <p className="picker-subtitle">
              Start your topic with one tool, you can move it to another later.
            </p>
          </div>
          <button
            type="button"
            className="picker-close"
            aria-label="Close"
            onClick={onDismiss}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5L15 15M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="picker-cards">
          {orderedIntents.map((intent) => (
            <button
              key={intent.key}
              type="button"
              className="picker-card"
              onClick={() => handlePick(intent.route)}
            >
              <div className="picker-card-head">
                <span className="picker-card-icon">
                  {ICONS[intent.key]}
                </span>
                <span className="picker-card-label">{intent.label}</span>
                {intent.badge && (
                  <span className="picker-card-badge">{intent.badge}</span>
                )}
              </div>
              <span className="picker-card-desc">{intent.description}</span>
              {intent.guidance && (
                <span
                  className={`picker-card-guidance picker-card-guidance--${intent.guidanceWeight}`}
                >
                  {intent.guidance}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}
