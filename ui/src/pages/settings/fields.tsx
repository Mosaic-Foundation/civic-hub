// The field kinds a Settings section is built from. Each one takes the form
// (FormApi) and a key, and reads and writes only that key — so a section is a
// list of fields, not a state machine.
//
// Kinds mirror src/shared/hubSettingsSections.ts; the server validates the
// same limits, so these are a courtesy, not the rule.

import { useId } from "react";
import MarkdownTextarea from "../../components/MarkdownTextarea";
import PostImagePicker from "../../components/PostImagePicker";
import { fieldSpec, DOCUMENT_PLACEHOLDERS } from "../../../../src/shared/hubSettingsSections";
import { uploadHubImage } from "../../services/api";
import type { FormApi } from "./SectionForm";

interface Common {
  f: FormApi;
  k: string;
  label: string;
  hint?: React.ReactNode;
  placeholder?: string;
}

function Label({ id, label, hint }: { id: string; label: string; hint?: React.ReactNode }) {
  return (
    <>
      <label className="form-label settings-field-label" htmlFor={id}>
        {label}
      </label>
      {hint && <p className="form-hint">{hint}</p>}
    </>
  );
}

function maxLengthOf(k: string): number | undefined {
  return fieldSpec(k)?.maxLength;
}

/** The deployment's value, or the caller's, as a greyed-out example. */
function placeholderFor(f: FormApi, k: string, given?: string): string | undefined {
  return f.fallback(k) ?? given;
}

export function TextField({ f, k, label, hint, placeholder, width = 420 }: Common & { width?: number }) {
  const id = useId();
  return (
    <div className="settings-field">
      <Label id={id} label={label} hint={hint} />
      <input
        id={id}
        className="form-input"
        type="text"
        value={f.value(k)}
        onChange={(e) => f.set(k, e.target.value)}
        placeholder={placeholderFor(f, k, placeholder)}
        maxLength={maxLengthOf(k)}
        disabled={f.disabled}
        style={{ maxWidth: `${width}px` }}
      />
    </div>
  );
}

export function EmailField({ f, k, label, hint, placeholder }: Common) {
  const id = useId();
  return (
    <div className="settings-field">
      <Label id={id} label={label} hint={hint} />
      <input
        id={id}
        className="form-input"
        type="email"
        value={f.value(k)}
        onChange={(e) => f.set(k, e.target.value)}
        placeholder={placeholderFor(f, k, placeholder)}
        disabled={f.disabled}
        style={{ maxWidth: "420px" }}
      />
    </div>
  );
}

export function TextAreaField({ f, k, label, hint, placeholder, rows = 3 }: Common & { rows?: number }) {
  const id = useId();
  return (
    <div className="settings-field">
      <Label id={id} label={label} hint={hint} />
      <textarea
        id={id}
        className="form-textarea"
        rows={rows}
        value={f.value(k)}
        onChange={(e) => f.set(k, e.target.value)}
        placeholder={placeholderFor(f, k, placeholder)}
        maxLength={maxLengthOf(k)}
        disabled={f.disabled}
      />
    </div>
  );
}

/** Short markdown with the same toolbar and Preview the description fields use. */
export function MarkdownField({ f, k, label, hint, placeholder, rows = 5 }: Common & { rows?: number }) {
  const id = useId();
  return (
    <div className="settings-field">
      <Label id={id} label={label} hint={hint} />
      <MarkdownTextarea
        id={id}
        className="form-textarea"
        rows={rows}
        value={f.value(k)}
        onChange={(e) => f.set(k, e.target.value)}
        placeholder={placeholderFor(f, k, placeholder)}
        maxLength={maxLengthOf(k)}
        disabled={f.disabled}
      />
    </div>
  );
}

/**
 * A whole page: the markdown editor, the placeholders it may use, and — where
 * there is a shared default — whether the hub is using it, and a button to go
 * back to it.
 */
export function DocumentField({
  f,
  k,
  label,
  hint,
  emptyNote,
  rows = 16,
}: Common & { rows?: number; emptyNote?: string }) {
  const id = useId();
  const template = f.template(k);
  const value = f.value(k);
  const usingDefault = template !== undefined && value.trim() === template.trim();

  return (
    <div className="settings-field settings-document">
      <Label id={id} label={label} hint={hint} />
      <MarkdownTextarea
        id={id}
        className="form-textarea settings-document-editor"
        rows={rows}
        value={value}
        onChange={(e) => f.set(k, e.target.value)}
        disabled={f.disabled}
      />
      <div className="settings-document-meta">
        <p className="form-hint settings-placeholders">
          Filled in for you when the page is shown:{" "}
          {DOCUMENT_PLACEHOLDERS.map((p, i) => (
            <span key={p}>
              {i > 0 && " "}
              <code>{p}</code>
            </span>
          ))}
        </p>
        {template !== undefined ? (
          <div className="settings-document-status">
            <span className="form-hint">
              {usingDefault
                ? "Using the shared default. It stays in step when the shared text is updated."
                : "This hub's own version."}
            </span>
            {!usingDefault && (
              <button
                type="button"
                className="admin-remove-section"
                onClick={() => f.set(k, template)}
                disabled={f.disabled}
              >
                Restore default
              </button>
            )}
          </div>
        ) : (
          value.trim() === "" &&
          emptyNote && <p className="form-hint">{emptyNote}</p>
        )}
      </div>
    </div>
  );
}

/**
 * An uploaded image, stored under this hub's prefix. `altKey`, when given,
 * is the setting that holds its alt text; without one there is no alt field
 * (a logo sits beside the hub's name, which is its text).
 */
export function ImageField({
  f,
  k,
  label,
  hint,
  kind,
  altKey,
  addLabel,
  formatHint,
}: Common & {
  kind: "banner" | "logo";
  altKey?: string;
  addLabel: string;
  formatHint?: string;
}) {
  const url = f.value(k);
  return (
    <div className="settings-field">
      <span className="form-label settings-field-label">{label}</span>
      {hint && <p className="form-hint">{hint}</p>}
      <div className={`settings-image settings-image--${kind}`}>
        <PostImagePicker
          imageUrl={url || null}
          imageAlt={altKey ? f.value(altKey) || null : null}
          onChange={({ image_url, image_alt }) => {
            f.set(k, image_url ?? "");
            if (altKey) f.set(altKey, image_alt ?? "");
          }}
          uploadFn={(blob) => uploadHubImage(kind, blob)}
          hideAlt={!altKey}
          addLabel={addLabel}
          disabled={f.disabled}
          // A logo stays a PNG, so its transparent background survives; it is
          // shown at most at icon size, so 512 px is plenty.
          format={kind === "logo" ? "png" : "webp"}
          maxLongEdge={kind === "logo" ? 512 : undefined}
          formatHint={formatHint}
        />
      </div>
    </div>
  );
}

export function BooleanField({ f, k, label, hint }: Common) {
  const id = useId();
  return (
    <div className="settings-field settings-boolean">
      <label className="settings-boolean-row" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={f.value(k) === "true"}
          onChange={(e) => f.set(k, e.target.checked ? "true" : "false")}
          disabled={f.disabled}
        />
        <span className="settings-boolean-label">{label}</span>
      </label>
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

/** An hour stored in UTC, shown alongside the admin's own clock. */
export function HourField({ f, k, label, hint }: Common) {
  const id = useId();
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <div className="settings-field">
      <Label id={id} label={label} hint={hint} />
      <select
        id={id}
        className="form-input"
        value={f.value(k)}
        onChange={(e) => f.set(k, e.target.value)}
        disabled={f.disabled}
        style={{ maxWidth: "320px" }}
      >
        {hours.map((h) => (
          <option key={h} value={String(h)}>
            {`${String(h).padStart(2, "0")}:00 UTC — ${localTimeOf(h)} your time`}
          </option>
        ))}
      </select>
    </div>
  );
}

function localTimeOf(utcHour: number): string {
  const d = new Date();
  d.setUTCHours(utcHour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A value the platform sets: shown, never editable here. */
export function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: React.ReactNode }) {
  return (
    <div className="settings-field">
      <span className="form-label settings-field-label">{label}</span>
      <p className="settings-readonly">{value || "Not set"}</p>
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}
