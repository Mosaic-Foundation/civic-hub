// The pieces of the Plugins page that more than one panel uses, kept here so a
// process type's module (src/processes/*.tsx) can build its plugin's panel
// without importing PluginsSection, which imports the modules (a cycle).

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { adminGetSettings, type CommentIdentityMode } from "../../services/api";

export type { FormApi } from "./SectionForm";
export {
  BooleanField,
  ChoiceField,
  DateField,
  EmailField,
  HourField,
  NumberField,
  ProcessField,
  TextAreaField,
  TextField,
  UrlField,
} from "./fields";

const IDENTITY_MODE_LABELS: Record<CommentIdentityMode, string> = {
  real_name: "Real names on every comment",
  anonymous_optional: "Residents may choose to comment anonymously",
  anonymous_only: "Every comment is anonymous",
};

/**
 * The support threshold and comment anonymity, read-only, from their one
 * writer (Participation). Loaded once per page; a failed read says so rather
 * than showing a guess.
 */
let participationCache: Promise<{ threshold: number; mode: CommentIdentityMode }> | null = null;

export function ParticipationValues({ show }: { show: "threshold" | "anonymity" }) {
  const [values, setValues] = useState<{ threshold: number; mode: CommentIdentityMode } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    participationCache ??= adminGetSettings().then((s) => ({
      threshold: s.support_threshold,
      mode: s.comment_identity_mode,
    }));
    participationCache.then(setValues).catch(() => {
      participationCache = null;
      setFailed(true);
    });
  }, []);

  const label = show === "threshold" ? "Endorsements before a vote opens" : "Comment anonymity";
  const value = failed
    ? "Could not load"
    : !values
      ? "…"
      : show === "threshold"
        ? values.threshold === 0
          ? "None — approved votes open directly"
          : String(values.threshold)
        : IDENTITY_MODE_LABELS[values.mode] ?? values.mode;

  return (
    <div className="settings-field">
      <span className="form-label settings-field-label">{label}</span>
      <p className="settings-readonly">
        {value}{" "}
        <Link to="/admin/settings/participation" className="plugin-change-link">
          Change in Participation
        </Link>
      </p>
      {show === "anonymity" && (
        <p className="form-hint">Applies to comments everywhere on the hub, not only here.</p>
      )}
    </div>
  );
}
