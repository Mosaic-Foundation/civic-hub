// A text field that suggests its value as grey text (2026-10-06). Shared by
// the console's Create hub and the start page (session 4b).

/**
 * A text field that shows a suggestion as grey text while it is empty. Tab
 * or Enter on the empty field accepts it (Tab then stays, so the text can be
 * edited); typing replaces it. The parent submits `value || suggestion`.
 */
export function SuggestInput({
  value,
  suggestion,
  onChange,
  placeholder,
  className,
  ...rest
}: {
  value: string;
  suggestion: string;
  onChange: (v: string) => void;
  placeholder?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const suggesting = value === "" && suggestion !== "";
  return (
    <input
      {...rest}
      value={value}
      placeholder={suggesting ? suggestion : placeholder}
      className={[className, suggesting ? "cx-suggesting" : ""].filter(Boolean).join(" ") || undefined}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (suggesting && (e.key === "Tab" || e.key === "Enter") && !e.shiftKey) {
          e.preventDefault();
          onChange(suggestion);
        }
      }}
    />
  );
}

/** The hint under a field that holds a suggestion. */
export function SuggestNote({ value, suggestion }: { value: string; suggestion: string }) {
  if (value !== "" || suggestion === "") return null;
  return (
    <span className="cx-suggest-note">
      {" "}Suggested: saved as shown if you leave it. Tab makes it text you can edit; typing replaces it.
    </span>
  );
}
