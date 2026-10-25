import { useContext } from "react";
import { CocFindingsContext, sameField } from "./cocFindingsState";
import "./CocFindings.css";

/** The check's findings on one field, under that field. */
export function FieldFinding({ field }: { field: string }) {
  const findings = useContext(CocFindingsContext).filter((f) => sameField(f.field, field));
  if (findings.length === 0) return null;
  return (
    <div className="field-finding" role="alert">
      {findings.map((f, i) => (
        <p key={i} className="field-finding-text">
          <strong>Code of Conduct:</strong> {f.message}
          {f.quoted_text && (
            <>
              {" "}
              <span className="field-finding-quote">“{f.quoted_text}”</span>
            </>
          )}
        </p>
      ))}
    </div>
  );
}
