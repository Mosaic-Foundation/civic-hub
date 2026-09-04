import { type ReactNode, useState, useRef, useEffect } from "react";
import SuggestionCard from "./SuggestionCard";
import type { DraftSuggestion } from "../services/api";
import "./AssistantPanel.css";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  suggestions?: DraftSuggestion[];
}

interface Props {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  onApplySuggestion?: (suggestion: DraftSuggestion) => void;
  /** Gates the Apply button per card — a suggestion for a field this
   *  form doesn't have must not offer a silent no-op Apply. */
  canApplySuggestion?: (suggestion: DraftSuggestion) => boolean;
  onDismissSuggestion?: (index: number) => void;
  /** Keys (`<messageIndex>:<suggestionIndex>`) already applied, and the
   *  reporter for a new one. Held above this component so the answer
   *  survives the panel being unmounted by the form/assistant switch. */
  appliedSuggestions?: ReadonlySet<string>;
  onSuggestionApplied?: (key: string) => void;
  loading: boolean;
  phase?: "brainstorm" | "free_form" | "review";
  /** Label shown next to the loading dots — lets pages distinguish an
   *  ordinary assistant reply from the Code of Conduct check. */
  loadingLabel?: string;
  /** Renders a close (collapse) button in the panel header. */
  onClose?: () => void;
  /** Replaces the default "Drafting assistant ×" header — the phone layout
   *  puts the form/assistant switcher here so the two views share one
   *  control. */
  header?: ReactNode;
  /** Free-form input placeholder; names the thing being drafted. */
  placeholder?: string;
  /** "Done — back to the form". Applying a card or reading a reply leaves
   *  you at a dead end otherwise: the switcher is at the top of a scrolled
   *  conversation, so there is nothing to press where you actually are
   *  (Adam, 2026-09-04). Same handler as the panel's close. */
  onDone?: () => void;
  doneLabel?: string;
}

export default function AssistantPanel({
  messages,
  onSendMessage,
  onApplySuggestion,
  canApplySuggestion,
  onDismissSuggestion,
  appliedSuggestions,
  onSuggestionApplied,
  loading,
  phase,
  loadingLabel = "Thinking",
  onClose,
  header,
  placeholder,
  onDone,
  doneLabel,
}: Props) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    onSendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="assistant-panel">
      {header ?? (
        <div className="assistant-header assistant-header-row">
          <h3 className="assistant-title">Drafting assistant</h3>
          {onClose && (
            <button
              type="button"
              className="assistant-close-btn"
              onClick={onClose}
              aria-label="Close assistant"
            >
              &times;
            </button>
          )}
        </div>
      )}

      <div className="assistant-messages">
        {messages.length === 0 && (
          <div className="assistant-empty">
            <p>This is your drafting assistant. Ask it to help write, research sources, improve your proposal, or check it before submitting.</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`assistant-msg ${msg.role === "user" ? "msg-user" : "msg-assistant"}`}
          >
            <div className="msg-content">{msg.content}</div>
            {msg.suggestions && msg.suggestions.length > 0 && (
              <div className="msg-suggestions">
                {msg.suggestions.map((s, si) => {
                  const key = `${i}:${si}`;
                  return (
                    <SuggestionCard
                      key={si}
                      suggestion={s}
                      applied={appliedSuggestions?.has(key)}
                      onApply={
                        s.suggested_revision &&
                        onApplySuggestion &&
                        (canApplySuggestion ? canApplySuggestion(s) : true)
                          ? () => {
                              onApplySuggestion(s);
                              onSuggestionApplied?.(key);
                            }
                          : undefined
                      }
                      onDismiss={
                        onDismissSuggestion
                          ? () => onDismissSuggestion(si)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="assistant-msg msg-assistant">
            <div className="msg-content msg-loading">
              <span className="thinking-label">{loadingLabel}</span>
              <span className="thinking-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="assistant-footer">
        <div className="assistant-input-row">
          <textarea
            ref={inputRef}
            className="assistant-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={phase === "brainstorm" ? "Type your answer here..." : (placeholder ?? "Ask for help with your draft...")}
            rows={phase === "brainstorm" ? 3 : 1}
            disabled={loading}
          />
          <button
            type="button"
            className="assistant-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || loading}
          >
            Send
          </button>
        </div>
        {onDone && (
          <button type="button" className="assistant-done-btn" onClick={onDone}>
            {doneLabel ?? "Done — back to the form"}
          </button>
        )}
      </div>
    </div>
  );
}
