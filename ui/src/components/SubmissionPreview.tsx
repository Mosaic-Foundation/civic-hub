// SubmissionPreview — everything a creator submitted, rendered the way the
// live page would show it. Used by the creator's My Submissions detail and
// the admin review page, so both see the same complete picture (2026-09-02:
// before this, both showed title + description and hid a project's banner
// and sources, a proposal's links, a vote's options).
//
// The field list comes from the server (`submission` on the review detail,
// computed through the process registry so a type can extend it); when a
// server predates that payload the component computes the generic default
// itself from the same shared module. Nothing here enumerates process types.

import {
  describeSubmissionFields,
  formatDuration,
  type SubmissionField,
} from "../../../src/shared/submissionPreview";
import "./SubmissionPreview.css";

interface Props {
  /** Server-computed fields, when present. */
  fields?: SubmissionField[] | null;
  /** The raw process row — used for the client-side fallback. */
  process?: Record<string, unknown> | null;
  /** Heading above the description ("Your submission" / "Process content"). */
  heading: string;
  /** Show the raw content JSON in a collapsed toggle (admin page). */
  showRaw?: boolean;
}

export default function SubmissionPreview({ fields, process, heading, showRaw }: Props) {
  const proc = process ?? {};
  const resolved: SubmissionField[] =
    fields ??
    describeSubmissionFields({
      type: String(proc.type ?? ""),
      title: String(proc.title ?? ""),
      description: String(proc.description ?? ""),
      content: (proc.content as Record<string, unknown> | null) ?? null,
      state: (proc.state as Record<string, unknown> | null) ?? null,
    });

  const image = resolved.find((f) => f.kind === "image");
  const rest = resolved.filter((f) => f.kind !== "image");
  const flags = rest.filter((f) => f.kind === "flag");
  const body = rest.filter((f) => f.kind !== "flag");

  return (
    <div className="submission-preview">
      <h2 className="submission-preview__heading">{heading}</h2>

      {image && (
        <figure className="submission-preview__banner">
          <img
            src={String((image.value as { url: string }).url)}
            alt={String((image.value as { alt?: string }).alt ?? "")}
          />
        </figure>
      )}

      <p className="submission-preview__description">
        {String(proc.description ?? "") || "No description"}
      </p>

      {body.map((f) => (
        <div className="submission-preview__field" key={f.key}>
          <span className="submission-preview__label">{f.label}</span>
          <FieldValue field={f} />
        </div>
      ))}

      {flags.length > 0 && (
        <p className="submission-preview__flags">
          {flags.map((f) => f.label).join(" · ")}
        </p>
      )}

      {showRaw && !!proc.content && (
        <details className="submission-preview__raw">
          <summary>Structured content</summary>
          <pre>{JSON.stringify(proc.content, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

function FieldValue({ field }: { field: SubmissionField }) {
  switch (field.kind) {
    case "paragraph":
      return <p className="submission-preview__paragraph">{String(field.value)}</p>;
    case "text":
      return <span className="submission-preview__text">{String(field.value)}</span>;
    case "duration":
      return <span className="submission-preview__text">{formatDuration(Number(field.value))}</span>;
    case "number":
      return <span className="submission-preview__text">{String(field.value)}</span>;
    case "links": {
      const links = field.value as Array<{ label: string; url: string }>;
      return (
        <ul className="submission-preview__links">
          {links.map((l, i) => (
            <li key={i}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      );
    }
    case "list":
      return (
        <ul className="submission-preview__list">
          {(field.value as string[]).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
      );
    case "options":
      return (
        <ol className="submission-preview__options">
          {(field.value as string[]).map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      );
    case "sections":
      return (
        <div className="submission-preview__sections">
          {(field.value as Array<{ heading: string; body: string }>).map((s, i) => (
            <div key={i}>
              <strong>{s.heading}</strong>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      );
    case "flag":
      return null;
    case "json":
    default:
      return (
        <pre className="submission-preview__json">{JSON.stringify(field.value, null, 2)}</pre>
      );
  }
}
