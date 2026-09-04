// useDraftFlow — the shared brain of every process-creation page.
//
// One hook, all types: lazy draft creation (no row until the user actually
// does something), an edit buffer for signed-out visitors (their text
// survives the sign-in gate), the collapsed-assistant open flow, the
// always-on Code of Conduct check, and Apply-suggestion semantics that mark
// assistant_helped ONLY when assistant-produced text lands in the form.
//
// Pages supply their type's API calls; everything else is identical across
// proposal / vote / project — and any future plugin type.

import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useRequireAuth } from "./useRequireAuth";
import {
  getAssistantUiConfig,
  sendAssistantMessage,
  reviewDraftCoC,
  type AssistantUiConfig,
  type AssistantResponse,
  type DraftPhase,
  type DraftSuggestion,
} from "../services/api";
import type { ChatMessage } from "../components/AssistantPanel";
import type { DraftShellAssistant } from "../components/DraftShell";

export interface BaseDraft {
  id: string;
  title: string;
  description: string;
  /** Not every type has a sources field (conversations don't). */
  sources?: string;
  conversation_history: Array<{ role: "user" | "assistant"; content: string }>;
  last_review_result: DraftSuggestion[] | null;
}

interface PatchOptions {
  skipModifiedFlag?: boolean;
  assistantApplied?: boolean;
}

interface EditBuffer {
  fields: Record<string, unknown>;
  skip: boolean;
  assistantApplied: boolean;
}

interface Options<D extends BaseDraft> {
  /** Full registry type, e.g. "civic.proposal". */
  processType: string;
  createDraft: () => Promise<D>;
  updateDraft: (id: string, patch: Record<string, unknown>) => Promise<D>;
  /**
   * Revision: load THIS draft instead of creating one. The page passes it
   * when it arrives with `?draft=` (from "Edit & resubmit"); the form waits
   * on `resuming` so its fields initialize from the loaded values.
   */
  resumeDraft?: () => Promise<D>;
  /** Fields Apply-suggestion may write (the fields this type's form renders). */
  applyFields: string[];
}

function friendlyError(msg: string): string {
  if (msg.includes("rate_limit") || msg.includes("429"))
    return "The assistant is getting too many requests right now. Wait a moment and try again.";
  if (msg.includes("ANTHROPIC_API_KEY"))
    return "The assistant isn't configured yet. Please contact the hub admin.";
  if (msg.includes("timeout") || msg.includes("aborted"))
    return "The assistant took too long to respond. Try again with a shorter message.";
  return "Something went wrong with the assistant. Try again in a moment.";
}

export function useDraftFlow<D extends BaseDraft>({
  processType,
  createDraft,
  updateDraft,
  resumeDraft,
  applyFields,
}: Options<D>) {
  const { canParticipate } = useAuth();
  const { requireAuth, showAuthModal, closeAuthModal, handleAuthComplete } =
    useRequireAuth();

  const [draft, setDraft] = useState<D | null>(null);
  const [config, setConfig] = useState<AssistantUiConfig | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<DraftPhase>("brainstorm");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantOpening, setAssistantOpening] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewFailed, setReviewFailed] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Reactive mirror of buffered (pre-draft) edits, so the form's status
   *  bar sees a signed-out visitor's typing. */
  const [pendingFields, setPendingFields] = useState<Record<string, unknown>>({});
  /** True while a resumed draft is being fetched (revision flow). */
  const [resuming, setResuming] = useState(!!resumeDraft);

  const draftRef = useRef<D | null>(null);
  const draftPromise = useRef<Promise<D> | null>(null);
  const buffer = useRef<EditBuffer>({ fields: {}, skip: true, assistantApplied: false });
  const assistantSeeded = useRef(false);

  const commitDraft = useCallback((d: D) => {
    draftRef.current = d;
    setDraft(d);
  }, []);

  // Revision flow: the draft already exists — load it up front so the form
  // renders the submitted values, and make ensureDraft reuse it.
  useEffect(() => {
    if (!resumeDraft) return;
    let cancelled = false;
    const p = resumeDraft();
    draftPromise.current = p;
    p.then((d) => {
      if (cancelled) return;
      commitDraft(d);
    })
      .catch((err) => {
        if (cancelled) return;
        draftPromise.current = null;
        setError(err instanceof Error ? err.message : "Could not load your draft");
      })
      .finally(() => {
        if (!cancelled) setResuming(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which types have an assistant (and their copy) is the backend
  // registry's call — the UI just asks.
  useEffect(() => {
    let cancelled = false;
    getAssistantUiConfig(processType)
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        if (!cancelled) setConfig({ available: false, field_guidance: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [processType]);

  function takeBuffer(): EditBuffer | null {
    const buf = buffer.current;
    if (Object.keys(buf.fields).length === 0) return null;
    buffer.current = { fields: {}, skip: true, assistantApplied: false };
    setPendingFields({});
    return buf;
  }

  function bufferPayload(buf: EditBuffer): Record<string, unknown> {
    return {
      ...buf.fields,
      ...(buf.skip ? { skip_modified_flag: true } : {}),
      ...(buf.assistantApplied ? { assistant_applied: true } : {}),
    };
  }

  /**
   * Create the draft row exactly once (single-flight), flushing any edits
   * buffered before it existed. Callers must already be past the auth gate.
   */
  const ensureDraft = useCallback((): Promise<D> => {
    if (draftPromise.current) return draftPromise.current;
    const p = (async () => {
      let d = await createDraft();
      const buf = takeBuffer();
      if (buf) d = await updateDraft(d.id, bufferPayload(buf));
      commitDraft(d);
      return d;
    })();
    draftPromise.current = p;
    p.catch(() => {
      draftPromise.current = null;
    });
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createDraft, updateDraft, commitDraft]);

  /**
   * Persist a form edit. Signed-in: creates the draft on the first edit,
   * then PATCHes. Signed-out: buffers silently — no auth modal for mere
   * typing — and the buffer flushes when the first gated action (check,
   * submit, assistant) gets them signed in.
   */
  const queuePatch = useCallback(
    async (fields: Record<string, unknown>, opts?: PatchOptions): Promise<void> => {
      const buf = buffer.current;
      Object.assign(buf.fields, fields);
      buf.skip = buf.skip && opts?.skipModifiedFlag === true;
      buf.assistantApplied = buf.assistantApplied || opts?.assistantApplied === true;
      setPendingFields({ ...buf.fields });

      if (!draftRef.current && !canParticipate) return;
      try {
        const d = await ensureDraft();
        const flush = takeBuffer();
        if (flush) {
          const updated = await updateDraft(d.id, bufferPayload(flush));
          commitDraft(updated);
        }
      } catch {
        // best-effort — the edit stays in the form and in the buffer
      }
    },
    [canParticipate, ensureDraft, updateDraft, commitDraft],
  );

  const pushAssistantResponse = useCallback((response: AssistantResponse) => {
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant" as const,
        content: response.message,
        suggestions: response.suggestions.length > 0 ? response.suggestions : undefined,
      },
    ]);
  }, []);

  const handleSendMessage = useCallback(
    async (text: string) => {
      const d = draftRef.current;
      if (!d) return;
      setAssistantLoading(true);
      setError(null);
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      try {
        const result = await sendAssistantMessage<D>(processType, d.id, phase, text);
        commitDraft(result.draft);
        pushAssistantResponse(result.response);
        if (result.response.draft_proposal) {
          setPhase("free_form");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: friendlyError(msg) },
        ]);
      } finally {
        setAssistantLoading(false);
      }
    },
    [processType, phase, commitDraft, pushAssistantResponse],
  );

  /**
   * First open of the assistant panel (auth already satisfied): make sure
   * the draft exists, then seed the conversation. Empty draft → brainstorm
   * greeting + hidden kickoff; existing content or history → free-form,
   * nothing sent until the user speaks.
   */
  const openAssistantAuthed = useCallback(async () => {
    if (!config?.available) return;
    setAssistantOpening(true);
    setError(null);
    try {
      const d = await ensureDraft();
      if (!assistantSeeded.current) {
        assistantSeeded.current = true;
        const history = d.conversation_history ?? [];
        const hasContent = Boolean(d.title.trim() || d.description.trim());
        if (history.length > 0) {
          setMessages(history.map((m) => ({ role: m.role, content: m.content })));
          setPhase("free_form");
          setAssistantOpen(true);
        } else if (hasContent) {
          setMessages([
            { role: "assistant", content: config.returning_greeting ?? config.greeting ?? "" },
          ]);
          setPhase("free_form");
          setAssistantOpen(true);
        } else {
          setMessages([{ role: "assistant", content: config.greeting ?? "" }]);
          setPhase("brainstorm");
          setAssistantOpen(true);
          setAssistantLoading(true);
          try {
            const result = await sendAssistantMessage<D>(
              processType,
              d.id,
              "brainstorm",
              config.kickoff_message ?? "I want to get started.",
            );
            commitDraft(result.draft);
            pushAssistantResponse(result.response);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: friendlyError(msg) },
            ]);
          } finally {
            setAssistantLoading(false);
          }
        }
      } else {
        setAssistantOpen(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start a draft");
    } finally {
      setAssistantOpening(false);
    }
  }, [config, ensureDraft, processType, commitDraft, pushAssistantResponse]);

  const requestAssistantOpen = useCallback(() => {
    requireAuth(() => {
      void openAssistantAuthed();
    });
  }, [requireAuth, openAssistantAuthed]);

  /** The always-on automated Code of Conduct check. */
  const handleReview = useCallback(() => {
    requireAuth(async () => {
      setAssistantLoading(true);
      setReviewing(true);
      setReviewFailed(false);
      setReviewNotice(null);
      setError(null);
      try {
        const d = await ensureDraft();
        const result = await reviewDraftCoC<D>(processType, d.id);
        commitDraft(result.draft);
        setReviewNotice(result.review_unavailable ? result.response.message : null);
        pushAssistantResponse(result.response);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setReviewFailed(true);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: friendlyError(msg) },
        ]);
      } finally {
        setAssistantLoading(false);
        setReviewing(false);
      }
    });
  }, [requireAuth, ensureDraft, processType, commitDraft, pushAssistantResponse]);

  /**
   * Whether a suggestion can actually land in this type's form. Cards
   * that fail this must not render an Apply button — a silent no-op
   * Apply is worse than none.
   */
  const canApplySuggestion = useCallback(
    (suggestion: DraftSuggestion): boolean =>
      Boolean(
        suggestion.field &&
          suggestion.suggested_revision &&
          applyFields.includes(suggestion.field),
      ),
    [applyFields],
  );

  /**
   * Apply assistant-produced text into a form field. This — and only
   * this — marks the draft assistant_helped (assistant_applied flag).
   */
  const handleApplySuggestion = useCallback(
    async (suggestion: DraftSuggestion) => {
      const d = draftRef.current;
      if (!d || !suggestion.field || !suggestion.suggested_revision) return;
      if (!applyFields.includes(suggestion.field)) return;

      const current = String((d as Record<string, unknown>)[suggestion.field] ?? "");
      let newValue: string;
      if (suggestion.quoted_text && current.includes(suggestion.quoted_text)) {
        newValue = current.replace(suggestion.quoted_text, suggestion.suggested_revision);
      } else if (current.trim()) {
        newValue = current.trim() + "\n\n" + suggestion.suggested_revision;
      } else {
        newValue = suggestion.suggested_revision;
      }

      await queuePatch(
        { [suggestion.field]: newValue },
        { skipModifiedFlag: true, assistantApplied: true },
      );

      const el = document.getElementById(`draft-${suggestion.field}`) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      if (el) el.value = newValue;
    },
    [applyFields, queuePatch],
  );

  // The auth modal was dismissed without signing in: allow a later retry
  // to create the draft (the single-flight promise would otherwise be a
  // resolved-never promise only when creation itself failed — this is just
  // belt-and-braces for the abandoned-auth path).
  const closeAuthModalAndReset = useCallback(() => {
    closeAuthModal();
    if (!draftRef.current) draftPromise.current = null;
  }, [closeAuthModal]);

  const shellAssistant: DraftShellAssistant | null = config?.available
    ? {
        open: assistantOpen,
        opening: assistantOpening,
        messages,
        loading: assistantLoading,
        phase: phase as "brainstorm" | "free_form" | "review",
        loadingLabel: reviewing ? "Running Code of Conduct check" : "Thinking",
        onOpenRequest: requestAssistantOpen,
        onClose: () => setAssistantOpen(false),
        onSendMessage: handleSendMessage,
      }
    : null;

  return {
    draft,
    resuming,
    config,
    pendingFields,
    error,
    setError,
    reviewNotice,
    reviewing,
    reviewFailed,
    assistantOpen,
    shellAssistant,
    queuePatch,
    ensureDraft,
    handleReview,
    handleApplySuggestion,
    canApplySuggestion,
    // auth modal wiring for the page
    requireAuth,
    showAuthModal,
    closeAuthModal: closeAuthModalAndReset,
    handleAuthComplete,
  };
}
