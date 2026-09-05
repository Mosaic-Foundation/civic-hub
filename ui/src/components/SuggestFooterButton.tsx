// "Get suggestions" in the sticky form footer.
//
// The assistant affordance (with its own Get suggestions button) sits at the
// TOP of every draft form. On a phone, someone fills the form and scrolls to
// the bottom, where the sticky footer shows only the status line and Submit —
// they never scroll back up to find Get suggestions (Adam, 2026-09-05: "I'm
// afraid they're never gonna see that get suggestions button… include it at
// the bottom somewhere the mobile user will recognize").
//
// So the same action lives in the footer too, right above the status. It is
// fed the SAME gated handler as the top affordance: the page passes
// shellAssistant.onSuggest, which is undefined until the draft has content to
// review, so this button appears only once there is something to suggest on —
// exactly like the top one. Rendered on every width; on desktop it is a quiet
// echo of the top card, on mobile it is the one people will actually reach.

interface Props {
  /** shellAssistant.onSuggest — undefined when there's nothing to review yet
   *  (blank draft) or the type has no assistant, in which case nothing renders. */
  onGetSuggestions?: () => void;
  suggesting?: boolean;
  disabled?: boolean;
}

export default function SuggestFooterButton({
  onGetSuggestions,
  suggesting,
  disabled,
}: Props) {
  if (!onGetSuggestions) return null;
  return (
    <button
      type="button"
      className="draft-suggest-btn"
      onClick={onGetSuggestions}
      disabled={disabled || suggesting}
      title="Review what you've written against the best-practices guide and suggest improvements"
    >
      {suggesting ? "Reviewing…" : "Get suggestions"}
    </button>
  );
}
