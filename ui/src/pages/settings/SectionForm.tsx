// One Settings section as one form: the fields, a Save button at the bottom,
// an unsaved-changes guard, and "last changed by X on <date>".
//
// Saving sends ONLY this section's keys, and of those only the ones the admin
// changed — so a key nobody touched keeps its own "last changed" record.
// The server refuses any key outside the section anyway.

import { useEffect, useMemo, useState } from "react";
import {
  PLUGIN_SECTION_ORDER,
  SETTINGS_SECTIONS,
  fieldSpec,
  type SettingsSectionId,
} from "../../../../src/shared/hubSettingsSections";
import { adminGetSettingTemplate, type HubSettings } from "../../services/api";
import { useHubSettings, useUnsavedChangesGuard } from "./HubSettingsContext";
import { HANDOVER_KEYS, SETTING_LABELS } from "../../../../src/shared/settingOwners";

/** Values in the form for keys the hub has not set: what the site uses today. */
const FORM_DEFAULTS: Readonly<Record<string, string>> = {
  // Every plugin is on until a hub switches it off.
  ...Object.fromEntries(PLUGIN_SECTION_ORDER.map((id) => [`plugin.${id}.enabled`, "true"])),
  "plugin.meeting_summary.auto_publish": "false",
  // DEFAULT_DIGEST_SEND_HOUR in src/controllers/digestController.ts.
  "plugin.digest.send_hour": "13",
};

/** What a field component needs from its form. */
export interface FormApi {
  value: (key: string) => string;
  set: (key: string, value: string) => void;
  /** What applies when the field is empty (the deployment's env value). */
  fallback: (key: string) => string | undefined;
  /** The shared default for a document, when it has one and it has loaded. */
  template: (key: string) => string | undefined;
  disabled: boolean;
  data: HubSettings;
}

interface Props {
  section: SettingsSectionId;
  title: string;
  intro?: React.ReactNode;
  /** Said after a successful save. */
  savedMessage?: string;
  /** After a successful save, with what the server stored. */
  onSaved?: (fresh: HubSettings) => void;
  children: (f: FormApi) => React.ReactNode;
}

export default function SectionForm({
  section,
  title,
  intro,
  savedMessage = "Saved. It shows on this page now; visitors see it on their next page load.",
  onSaved,
  children,
}: Props) {
  const { data, error, save, setDirty } = useHubSettings();
  const keys = useMemo(() => SETTINGS_SECTIONS[section].map((f) => f.key), [section]);
  const documentKeys = useMemo(
    () =>
      SETTINGS_SECTIONS[section]
        .filter((f) => f.kind === "document" || f.key === "legal.who_runs_this")
        .map((f) => f.key),
    [section],
  );

  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [initial, setInitial] = useState<Record<string, string> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  // The shared default of every document in this section, once. A document
  // the hub has not rewritten opens WITH its default in the editor, so the
  // admin edits the text residents actually read rather than a blank box.
  useEffect(() => {
    if (!data) return;
    const wanted = documentKeys.filter((k) => data.restorable.includes(k));
    Promise.all(
      wanted.map((k) =>
        adminGetSettingTemplate(k)
          .then((r) => [k, r.template] as const)
          .catch(() => null),
      ),
    ).then((pairs) => {
      const out: Record<string, string> = {};
      for (const p of pairs) if (p) out[p[0]] = p[1];
      setTemplates(out);
    });
    // Only on first load; a save does not change a template.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data === null, documentKeys]);

  const templatesReady =
    !!data && documentKeys.filter((k) => data.restorable.includes(k)).every((k) => k in templates);

  // (Re)build the form from the server's values: on first load, and after a
  // save, so what the form shows is what was stored.
  function fromServer(d: HubSettings): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of keys) {
      const stored = d.values[k] ?? "";
      // A boolean has no "unset" in the form, so an unset one shows what
      // applies today: the deployment's env value where it sets one.
      const envBool =
        fieldSpec(k)?.kind === "boolean" && /^(true|false)$/.test(d.fallbacks[k] ?? "")
          ? d.fallbacks[k]
          : undefined;
      out[k] = stored !== "" ? stored : (templates[k] ?? envBool ?? FORM_DEFAULTS[k] ?? "");
    }
    return out;
  }

  useEffect(() => {
    if (!data || !templatesReady || initial) return;
    const next = fromServer(data);
    setInitial(next);
    setDraft(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, templatesReady]);

  const changedKeys = initial ? keys.filter((k) => draft[k] !== initial[k]) : [];
  const isDirty = changedKeys.length > 0;

  useEffect(() => {
    setDirty(section, isDirty);
  }, [section, isDirty, setDirty]);
  useEffect(() => () => setDirty(section, false), [section, setDirty]);
  useUnsavedChangesGuard(isDirty);

  async function onSave() {
    if (!isDirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const values: Record<string, string> = {};
      for (const k of changedKeys) values[k] = draft[k] ?? "";
      const fresh = await save(section, values);
      const next = fromServer(fresh);
      setInitial(next);
      setDraft(next);
      // A rename says what followed it (review R11).
      setMessage({ text: fresh.follow_on ? `${savedMessage} ${fresh.follow_on}` : savedMessage, error: false });
      onSaved?.(fresh);
    } catch (err) {
      setMessage({
        text: err instanceof Error ? err.message : "Could not save.",
        error: true,
      });
    } finally {
      setSaving(false);
    }
  }

  function onDiscard() {
    if (initial) setDraft(initial);
    setMessage(null);
  }

  if (error) return <p className="form-error">{error}</p>;
  if (!data || !initial) {
    return (
      <section className="settings-section">
        <h2 className="settings-section-title">{title}</h2>
        <p className="form-hint">Loading…</p>
      </section>
    );
  }

  const api: FormApi = {
    value: (k) => draft[k] ?? "",
    set: (k, v) => {
      setDraft((cur) => ({ ...cur, [k]: v }));
      setMessage(null);
    },
    fallback: (k) => data.fallbacks[k],
    template: (k) => templates[k],
    disabled: saving,
    data,
  };

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{title}</h2>
      {intro && <div className="settings-section-intro">{intro}</div>}
      <SharedWithConsole data={data} keys={keys} />

      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
      >
        {children(api)}

        <div className="settings-form-footer">
          <div className="admin-settings-actions">
            <button
              type="submit"
              className="admin-convert-button"
              disabled={!isDirty || saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {isDirty && !saving && (
              <button type="button" className="admin-remove-section" onClick={onDiscard}>
                Discard changes
              </button>
            )}
            {isDirty && !message && (
              <span className="settings-unsaved">Unsaved changes</span>
            )}
            {message && (
              <span
                className={message.error ? "form-error" : "admin-settings-message"}
                role={message.error ? "alert" : "status"}
              >
                {message.text}
              </span>
            )}
          </div>
          <LastChanged data={data} keys={keys} />
        </div>
      </form>
    </section>
  );
}

/** "Last changed by Ada Lovelace on 24 Sep 2026", across the section's keys. */
function LastChanged({ data, keys }: { data: HubSettings; keys: readonly string[] }) {
  let latest: { at: string; by: string | null } | null = null;
  for (const k of keys) {
    const c = data.changed[k];
    if (c && (!latest || c.at > latest.at)) latest = c;
  }
  if (!latest) {
    return <p className="settings-last-changed">Not changed from this page yet.</p>;
  }
  const when = new Date(latest.at).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return (
    <p className="settings-last-changed">
      Last changed {latest.by ? <>by {latest.by} </> : null}on {when}.
    </p>
  );
}

/**
 * While the hub is a demo, the platform operator can also set some of what
 * residents see, from the console's Handover panel (review R10, Adam
 * 2026-10-08). Said on each section that holds one, naming them; once the hub
 * leaves demo they are this hub's admins' alone and the note goes.
 */
function SharedWithConsole({ data, keys }: { data: HubSettings; keys: readonly string[] }) {
  if (!data.console_may_edit) return null;
  const shared = HANDOVER_KEYS.filter((k) => keys.includes(k)).map((k) => SETTING_LABELS[k] ?? k);
  if (shared.length === 0) return null;
  return (
    <p className="form-hint settings-note" data-testid="console-shared-note">
      While this hub is a demo, the platform operator can also set {listOf(shared)}, for example when
      handing the hub over. Once it moves to beta, only this hub's admins can. The line under Save
      says who changed this section last.
    </p>
  );
}

function listOf(items: readonly string[]): string {
  const lower = items.map((s) => (s.startsWith('"') ? s : s.charAt(0).toLowerCase() + s.slice(1)));
  return lower.length <= 1 ? lower.join("") : `${lower.slice(0, -1).join(", ")} and ${lower[lower.length - 1]}`;
}
