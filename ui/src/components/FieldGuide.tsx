import { FieldFinding } from "./CocFindings";
import type { AssistantFieldGuidance } from "../services/api";

/** Under a field: what the Code of Conduct check flagged in it, if anything,
 *  then the inline hint + example — the same best-practices content the
 *  assistant works from, so manual drafters get the quality lift too. */
export function FieldGuide({
  guidance,
  field,
}: {
  guidance?: AssistantFieldGuidance[];
  field: string;
}) {
  const entry = guidance?.find((g) => g.field === field);
  return (
    <>
      <FieldFinding field={field} />
      {entry && <FieldHint entry={entry} />}
    </>
  );
}

function FieldHint({ entry }: { entry: AssistantFieldGuidance }) {
  return (
    <p className="field-guide">
      {entry.hint}
      {entry.example && (
        <>
          {" "}
          <span className="field-guide-example">Example: “{entry.example}”</span>
        </>
      )}
    </p>
  );
}
