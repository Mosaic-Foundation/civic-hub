// Admin settings page — hub-wide configuration.
//
// Holds all admin-editable settings that aren't tied to a single
// proposal or brief review flow. Future additions (theme, jurisdiction,
// email templates, etc.) should land here too.
//
// Section order is deliberate: "Hub identity" is first because it is what
// the public legal pages say about who runs this place, and it is the one
// section a newly created hub must fill in before it has honest terms.

import { useEffect, useState } from "react";
import {
  adminGetSettings,
  adminPatchSettings,
  adminGetHubPeople,
  adminRequestPeopleCode,
  adminSetHubPeople,
  adminRequestModeCode,
  adminSetHubMode,
  type Official,
  type WaitlistEntry,
  type CommentIdentityMode,
} from "../services/api";
import {
  OFFICIAL_TYPES,
  OFFICIAL_TYPE_LABELS,
  type OfficialType,
} from "../../../src/shared/officialTypes";
import AdminTabs from "../components/AdminTabs";
import "./AdminSettings.css";

export default function AdminSettings() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Officials & brief recipients ---
  // One section (Adam, 2026-09-06): the officials ARE the default brief
  // recipients. Each row carries a "sends briefs" flag; the hub-wide
  // recipient list is derived on save as the flagged officials plus any
  // standing addresses without an account (a clerk, a shared inbox). The
  // review page still lets the admin adjust the list per brief.
  type OfficialRow = Official & { sends_briefs: boolean };
  const [officials, setOfficials] = useState<OfficialRow[]>([]);
  const [extraRecipientsText, setExtraRecipientsText] = useState("");
  const [savingOfficials, setSavingOfficials] = useState(false);
  const [officialsMessage, setOfficialsMessage] = useState<string | null>(null);

  // --- Hub identity (what the legal pages say about the operator) ---
  const [hubName, setHubName] = useState("");
  const [registryName, setRegistryName] = useState("");
  const [tagline, setTagline] = useState("");
  const [label, setLabel] = useState("");
  const [operatorName, setOperatorName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [hostname, setHostname] = useState("");
  const [whoRunsThis, setWhoRunsThis] = useState("");
  const [whoRunsThisDefault, setWhoRunsThisDefault] = useState("");
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityMessage, setIdentityMessage] = useState<string | null>(null);

  // --- Hub mode ---
  // The same step-up as the roster, for a related reason: mode decides who
  // may sign in at all. `demo` is deliberately absent from the choices — it
  // is the one mode that turns off email verification, so only the control
  // plane may put a hub into it. A hub that IS a demo can graduate out.
  const [mode, setMode] = useState("");
  const [pendingMode, setPendingMode] = useState("");
  const [modeCode, setModeCode] = useState("");
  const [modeCodeSent, setModeCodeSent] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [modeMessage, setModeMessage] = useState<string | null>(null);

  // --- Admins & board ---
  // A roster change is the one edit on this page that takes a fresh emailed
  // code, so it carries its own little state machine: edit the lists, ask for
  // a code, type it in, save. See src/controllers/adminStepUp.ts.
  const [adminEmails, setAdminEmails] = useState<string[]>([]);
  const [boardEmails, setBoardEmails] = useState<string[]>([]);
  const [adminsFromEnv, setAdminsFromEnv] = useState(false);
  const [peopleCode, setPeopleCode] = useState("");
  const [peopleCodeSent, setPeopleCodeSent] = useState(false);
  const [savingPeople, setSavingPeople] = useState(false);
  const [peopleMessage, setPeopleMessage] = useState<string | null>(null);

  // --- Support threshold ---
  const [threshold, setThreshold] = useState(5);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [thresholdMessage, setThresholdMessage] = useState<string | null>(null);

  // --- Beta allowlist ---
  const [allowlistText, setAllowlistText] = useState("");
  const [savingAllowlist, setSavingAllowlist] = useState(false);
  const [allowlistMessage, setAllowlistMessage] = useState<string | null>(null);

  // --- Waitlist ---
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [copiedWaitlist, setCopiedWaitlist] = useState(false);

  // --- Comment identity ---
  const [identityMode, setIdentityMode] =
    useState<CommentIdentityMode>("anonymous_optional");
  const [savingIdentityMode, setSavingIdentityMode] = useState(false);
  const [identityModeMessage, setIdentityModeMessage] = useState<string | null>(null);

  useEffect(() => {
    adminGetSettings()
      .then((s) => {
        const recipients = new Set(s.brief_recipient_emails.map((e) => e.toLowerCase()));
        const officialEmails = new Set(s.officials.map((o) => o.email.toLowerCase()));
        setOfficials(
          s.officials.map((o) => ({ ...o, sends_briefs: recipients.has(o.email.toLowerCase()) })),
        );
        setExtraRecipientsText(
          s.brief_recipient_emails.filter((e) => !officialEmails.has(e.toLowerCase())).join(", "),
        );
        setHubName(s.name);
        setRegistryName(s.registry_name);
        setTagline(s.tagline);
        setLabel(s.label);
        setOperatorName(s.operator_name);
        setContactEmail(s.contact_email);
        setHostname(s.hostname);
        setWhoRunsThis(s.who_runs_this);
        setWhoRunsThisDefault(s.who_runs_this_default);
        setMode(s.mode);
        setPendingMode(s.mode);
        setThreshold(s.support_threshold);
        setAllowlistText(s.beta_allowlist.join(", "));
        setWaitlist(s.waitlist);
        setIdentityMode(s.comment_identity_mode);
        setLoaded(true);
      })
      .catch((err: Error) => {
        setError(`Could not load settings: ${err.message}`);
      });

    adminGetHubPeople()
      .then((p) => {
        setAdminEmails(p.admin_emails);
        setBoardEmails(p.board_emails);
        setAdminsFromEnv(p.admins_from_env);
      })
      .catch((err: Error) => {
        setPeopleMessage(`Could not load the roster: ${err.message}`);
      });
  }, []);

  function updateOfficial(i: number, patch: Partial<OfficialRow>) {
    setOfficials((cur) => cur.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  function addOfficial() {
    setOfficials((cur) => [
      ...cur,
      {
        email: "",
        name: "",
        official_type: "board_of_supervisors",
        official_title: OFFICIAL_TYPE_LABELS.board_of_supervisors,
        sends_briefs: true,
      },
    ]);
  }

  function removeOfficial(i: number) {
    setOfficials((cur) => cur.filter((_, idx) => idx !== i));
  }

  async function saveIdentity() {
    setSavingIdentity(true);
    setIdentityMessage(null);
    try {
      const saved = await adminPatchSettings({
        name: hubName.trim(),
        tagline: tagline.trim(),
        label: label.trim(),
        operator_name: operatorName.trim(),
        contact_email: contactEmail.trim(),
        who_runs_this: whoRunsThis.trim(),
      });
      setHubName(saved.name);
      setTagline(saved.tagline);
      setLabel(saved.label);
      setOperatorName(saved.operator_name);
      setContactEmail(saved.contact_email);
      setWhoRunsThis(saved.who_runs_this);
      setIdentityMessage(
        "Saved. The Terms, Privacy Policy and Code of Conduct use these now.",
      );
    } catch (err) {
      setIdentityMessage(
        err instanceof Error ? err.message : "Failed to save hub identity",
      );
    } finally {
      setSavingIdentity(false);
    }
  }

  async function requestModeCode() {
    setModeMessage(null);
    try {
      const { message } = await adminRequestModeCode();
      setModeCodeSent(true);
      setModeMessage(message);
    } catch (err) {
      setModeMessage(err instanceof Error ? err.message : "Could not send a code");
    }
  }

  async function saveMode() {
    setSavingMode(true);
    setModeMessage(null);
    try {
      const saved = await adminSetHubMode(pendingMode, modeCode.trim());
      setMode(saved.mode);
      setPendingMode(saved.mode);
      setModeCode("");
      setModeCodeSent(false);
      setModeMessage(
        saved.mode === "beta"
          ? "Saved. Only people on the beta allowlist can sign in now; everyone else is offered the waitlist."
          : "Saved. Anyone can sign in, and the beta banner is gone.",
      );
    } catch (err) {
      setModeMessage(err instanceof Error ? err.message : "Failed to change the mode");
    } finally {
      setSavingMode(false);
    }
  }

  async function requestPeopleCode() {
    setPeopleMessage(null);
    try {
      const { message } = await adminRequestPeopleCode();
      setPeopleCodeSent(true);
      setPeopleMessage(message);
    } catch (err) {
      setPeopleMessage(
        err instanceof Error ? err.message : "Could not send a code",
      );
    }
  }

  async function savePeople() {
    setSavingPeople(true);
    setPeopleMessage(null);
    try {
      const saved = await adminSetHubPeople({
        admin_emails: adminEmails.map((e) => e.trim()).filter(Boolean),
        board_emails: boardEmails.map((e) => e.trim()).filter(Boolean),
        code: peopleCode.trim(),
      });
      setAdminEmails(saved.admin_emails);
      setBoardEmails(saved.board_emails);
      setAdminsFromEnv(saved.admins_from_env);
      setPeopleCode("");
      setPeopleCodeSent(false);
      setPeopleMessage(
        `Saved. ${saved.admin_emails.length} admin${saved.admin_emails.length === 1 ? "" : "s"}, ` +
          `${saved.board_emails.length} board member${saved.board_emails.length === 1 ? "" : "s"}.`,
      );
    } catch (err) {
      setPeopleMessage(
        err instanceof Error ? err.message : "Failed to save the roster",
      );
    } finally {
      setSavingPeople(false);
    }
  }

  async function saveThreshold() {
    setSavingThreshold(true);
    setThresholdMessage(null);
    try {
      const saved = await adminPatchSettings({ support_threshold: threshold });
      setThreshold(saved.support_threshold);
      setThresholdMessage(
        saved.support_threshold === 0
          ? "Saved. New votes skip the support phase and open for ballots as soon as they are approved."
          : `Saved. New votes need ${saved.support_threshold} endorsement${saved.support_threshold !== 1 ? "s" : ""} to open for ballots.`,
      );
    } catch (err) {
      setThresholdMessage(
        err instanceof Error ? err.message : "Failed to save threshold",
      );
    } finally {
      setSavingThreshold(false);
    }
  }

  async function saveAllowlist() {
    setSavingAllowlist(true);
    setAllowlistMessage(null);
    try {
      const input = allowlistText
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const saved = await adminPatchSettings({ beta_allowlist: input });
      setAllowlistText(saved.beta_allowlist.join(", "));
      setAllowlistMessage(
        saved.beta_allowlist.length === 0
          ? "Cleared — no one can sign in during beta (except admins)."
          : `Saved. ${saved.beta_allowlist.length} email(s) on the allowlist.`,
      );
    } catch (err) {
      setAllowlistMessage(
        err instanceof Error ? err.message : "Failed to save allowlist",
      );
    } finally {
      setSavingAllowlist(false);
    }
  }

  async function saveIdentityMode() {
    setSavingIdentityMode(true);
    setIdentityModeMessage(null);
    try {
      const saved = await adminPatchSettings({ comment_identity_mode: identityMode });
      setIdentityMode(saved.comment_identity_mode);
      setIdentityModeMessage("Saved. Applies to new comments immediately.");
    } catch (err) {
      setIdentityModeMessage(
        err instanceof Error ? err.message : "Failed to save comment identity mode",
      );
    } finally {
      setSavingIdentityMode(false);
    }
  }

  function copyWaitlistEmails() {
    const emails = waitlist.map((w) => w.email).join(", ");
    navigator.clipboard.writeText(emails).then(() => {
      setCopiedWaitlist(true);
      setTimeout(() => setCopiedWaitlist(false), 2000);
    });
  }

  async function saveOfficials() {
    setSavingOfficials(true);
    setOfficialsMessage(null);
    try {
      const cleaned: Official[] = [];
      const recipientEmails: string[] = [];
      for (const o of officials) {
        const email = o.email.trim();
        const name = (o.name ?? "").trim();
        const title = o.official_title.trim();
        // A fully blank row is a row the admin added and abandoned —
        // drop it rather than making them delete it to save.
        if (!email && !name && !title) continue;
        if (!email || !title) {
          throw new Error("Each official needs both an email and a title.");
        }
        cleaned.push({
          email,
          name: name || null,
          official_type: o.official_type,
          official_title: title,
        });
        if (o.sends_briefs) recipientEmails.push(email);
      }
      const extras = extraRecipientsText
        .split(/[,\n]/)
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
      const saved = await adminPatchSettings({
        officials: cleaned,
        brief_recipient_emails: [...recipientEmails, ...extras],
      });
      const recipients = new Set(saved.brief_recipient_emails.map((e) => e.toLowerCase()));
      const officialEmails = new Set(saved.officials.map((o) => o.email.toLowerCase()));
      setOfficials(
        saved.officials.map((o) => ({ ...o, sends_briefs: recipients.has(o.email.toLowerCase()) })),
      );
      setExtraRecipientsText(
        saved.brief_recipient_emails.filter((e) => !officialEmails.has(e.toLowerCase())).join(", "),
      );
      const n = saved.brief_recipient_emails.length;
      setOfficialsMessage(
        `Saved. ${saved.officials.length} official(s); briefs go to ${n} recipient${n === 1 ? "" : "s"} by default.`,
      );
    } catch (err) {
      setOfficialsMessage(
        err instanceof Error ? err.message : "Failed to save officials",
      );
    } finally {
      setSavingOfficials(false);
    }
  }

  return (
    <div className="page admin-settings-page">
      <AdminTabs />
      <div className="admin-settings-body">
        <h1>Settings</h1>
        <p className="admin-subtitle">
          Hub-wide configuration. Changes take effect immediately — no redeploy required.
        </p>

        {error && <p className="form-error">{error}</p>}

        {/* --- Hub identity --- */}
        <SettingsSection
          id="identity"
          title="Hub identity"
          defaultOpen={true}
        >
          <p className="form-hint">
            What the <a href="/terms">Terms</a>, <a href="/privacy">Privacy
            Policy</a> and <a href="/code-of-conduct">Code of Conduct</a> say
            about who runs this hub. Those documents are shared templates with
            these values substituted in, so changing them here changes all
            three at once.
          </p>

          <label className="form-label" htmlFor="hub-name">
            Hub name
          </label>
          <p className="form-hint">
            What this hub calls itself, everywhere its name appears — the top
            of every page, the legal documents, the emails it sends. Leave it
            empty to use <strong>{registryName}</strong>.
          </p>
          <input
            id="hub-name"
            className="form-input"
            type="text"
            value={hubName}
            onChange={(e) => setHubName(e.target.value)}
            placeholder={registryName}
            disabled={!loaded || savingIdentity}
            maxLength={80}
            style={{ maxWidth: "420px" }}
          />

          <label
            className="form-label"
            htmlFor="hub-tagline"
            style={{ marginTop: "var(--space-md)" }}
          >
            Tagline
          </label>
          <p className="form-hint">
            The sentence under your hub's name on every page with a header.
            Say what this hub is for, in your own words. Leave it empty for
            the generic wording.
          </p>
          <textarea
            id="hub-tagline"
            className="form-textarea"
            rows={2}
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            placeholder="Stay informed on local government, raise the issues that matter, work on projects together, and see where our community stands."
            disabled={!loaded || savingIdentity}
            maxLength={300}
          />

          <label
            className="form-label"
            htmlFor="hub-label"
            style={{ marginTop: "var(--space-md)" }}
          >
            Label
          </label>
          <p className="form-hint">
            The small line above the tagline — "Civic Hub" by default.
          </p>
          <input
            id="hub-label"
            className="form-input"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Civic Hub"
            disabled={!loaded || savingIdentity}
            maxLength={40}
            style={{ maxWidth: "260px" }}
          />

          <label
            className="form-label"
            htmlFor="operator-name"
            style={{ marginTop: "var(--space-md)" }}
          >
            Operated by
          </label>
          <p className="form-hint">
            A person or a group — whoever is answerable for this hub. Printed
            verbatim, e.g. "Athens Moderator Group" or a named individual.
          </p>
          <input
            id="operator-name"
            className="form-input"
            type="text"
            value={operatorName}
            onChange={(e) => setOperatorName(e.target.value)}
            placeholder="Who runs this hub"
            disabled={!loaded || savingIdentity}
            maxLength={120}
            style={{ maxWidth: "420px" }}
          />

          <label
            className="form-label"
            htmlFor="contact-email"
            style={{ marginTop: "var(--space-md)" }}
          >
            Contact address
          </label>
          <p className="form-hint">
            Where the documents tell residents to write with a question, an
            appeal, or a data request. A shared inbox is fine.
          </p>
          <input
            id="contact-email"
            className="form-input"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="contact@example.com"
            disabled={!loaded || savingIdentity}
            style={{ maxWidth: "420px" }}
          />

          <label
            className="form-label"
            htmlFor="who-runs-this"
            style={{ marginTop: "var(--space-md)" }}
          >
            "Who runs this site"
          </label>
          <p className="form-hint">
            The paragraph that opens the Privacy Policy and the Terms. Leave it
            empty to use the shared default shown below, which fills in your
            hub's own names. Write your own if the default is not true of you —
            in particular, it says the Hub is <em>not</em> run by local
            government, which is wrong for a hub a council runs itself.
            Markdown, and <code>{"{OPERATOR}"}</code>,{" "}
            <code>{"{HUB_NAME}"}</code>, <code>{"{PLACE}"}</code>,{" "}
            <code>{"{GOVERNING_BODY}"}</code> and{" "}
            <code>{"{CONTACT_EMAIL}"}</code> are filled in for you.
          </p>
          <textarea
            id="who-runs-this"
            className="form-textarea"
            rows={5}
            value={whoRunsThis}
            onChange={(e) => setWhoRunsThis(e.target.value)}
            placeholder={whoRunsThisDefault}
            disabled={!loaded || savingIdentity}
          />
          {whoRunsThis.trim() === "" && (
            <p className="form-hint">
              Using the shared default (shown above as placeholder text).
            </p>
          )}

          {hostname && (
            <p className="form-hint" style={{ marginTop: "var(--space-md)" }}>
              The documents also name this hub's address,{" "}
              <strong>{hostname}</strong>, which comes from the hub record and
              is not editable here.
            </p>
          )}

          <div className="admin-settings-actions">
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveIdentity}
              disabled={!loaded || savingIdentity}
            >
              {savingIdentity ? "Saving…" : "Save hub identity"}
            </button>
            {identityMessage && (
              <span className="admin-settings-message">{identityMessage}</span>
            )}
          </div>
        </SettingsSection>

        {/* --- Hub mode --- */}
        <SettingsSection
          id="mode"
          title="Who can sign in"
          defaultOpen={true}
        >
          <p className="form-hint">
            This hub is currently <strong>{mode || "…"}</strong>.
          </p>
          {mode === "demo" ? (
            <p className="form-hint">
              A demo hub accepts any six digits instead of emailing a code, so
              anyone can look around without an inbox — which is why nothing
              here can put a hub back into demo once it leaves. Moving to beta
              or live turns real email verification on for everyone.
            </p>
          ) : (
            <p className="form-hint">
              Beta limits sign-in to the allowlist below and offers everyone
              else the waitlist. Live is open to anyone. Both send a real code
              by email.
            </p>
          )}

          <label className="form-label" htmlFor="hub-mode">
            Mode
          </label>
          <select
            id="hub-mode"
            className="form-input"
            value={pendingMode}
            onChange={(e) => setPendingMode(e.target.value)}
            disabled={!loaded || savingMode || modeCodeSent}
            style={{ maxWidth: "320px" }}
          >
            {mode === "demo" && (
              <option value="demo">Demo — any six digits, no email sent</option>
            )}
            <option value="beta">Beta — allowlist only, waitlist for everyone else</option>
            <option value="live">Live — open to anyone</option>
          </select>

          {pendingMode !== mode && (
            <p className="form-hint" style={{ marginTop: "var(--space-sm)" }}>
              Changing who may sign in takes a code emailed to you now.
              {mode === "demo" && (
                <> This hub cannot be moved back to demo afterwards.</>
              )}
            </p>
          )}

          <div className="admin-settings-actions">
            {pendingMode !== mode && !modeCodeSent && (
              <button
                type="button"
                className="admin-convert-button"
                onClick={requestModeCode}
                disabled={savingMode}
              >
                Email me a code
              </button>
            )}
            {modeCodeSent && (
              <>
                <input
                  className="form-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={modeCode}
                  onChange={(e) => setModeCode(e.target.value)}
                  placeholder="6-digit code"
                  aria-label="Confirmation code"
                  disabled={savingMode}
                  style={{ maxWidth: "160px" }}
                />
                <button
                  type="button"
                  className="admin-convert-button"
                  onClick={saveMode}
                  disabled={savingMode || modeCode.trim().length === 0}
                >
                  {savingMode ? "Saving…" : `Switch to ${pendingMode}`}
                </button>
                <button
                  type="button"
                  className="admin-remove-section"
                  onClick={() => {
                    setModeCodeSent(false);
                    setModeCode("");
                    setPendingMode(mode);
                    setModeMessage(null);
                  }}
                  disabled={savingMode}
                >
                  Cancel
                </button>
              </>
            )}
            {modeMessage && (
              <span className="admin-settings-message">{modeMessage}</span>
            )}
          </div>
        </SettingsSection>

        {/* --- Admins & board --- */}
        <SettingsSection
          id="people"
          title="Admins & board"
          defaultOpen={false}
        >
          <p className="form-hint">
            Admins reach every page under /admin and can post announcements.
            Board members can post announcements and are offered as brief
            recipients; they cannot reach admin pages. Both lists belong to
            this hub — an admin here is not an admin on any other hub.
          </p>
          {adminsFromEnv && (
            <p className="form-hint">
              <strong>This hub has no roster of its own yet</strong>, so the
              admins below come from the deployment's CIVIC_ADMIN_EMAILS.
              Saving writes a roster for this hub and the deployment variable
              stops applying to it.
            </p>
          )}

          <EmailListEditor
            label="Admins"
            addLabel="+ Add admin"
            emails={adminEmails}
            onChange={setAdminEmails}
            disabled={savingPeople}
            minimum={1}
            minimumHint="A hub must keep at least one admin."
          />

          <EmailListEditor
            label="Board members"
            addLabel="+ Add board member"
            emails={boardEmails}
            onChange={setBoardEmails}
            disabled={savingPeople}
          />

          <p className="form-hint" style={{ marginTop: "var(--space-md)" }}>
            Changing who administers a hub takes a code emailed to you now —
            an open admin tab is not enough on its own.
          </p>
          <div className="admin-settings-actions">
            {!peopleCodeSent ? (
              <button
                type="button"
                className="admin-convert-button"
                onClick={requestPeopleCode}
                disabled={savingPeople}
              >
                Email me a code
              </button>
            ) : (
              <>
                <input
                  className="form-input"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={peopleCode}
                  onChange={(e) => setPeopleCode(e.target.value)}
                  placeholder="6-digit code"
                  aria-label="Confirmation code"
                  disabled={savingPeople}
                  style={{ maxWidth: "160px" }}
                />
                <button
                  type="button"
                  className="admin-convert-button"
                  onClick={savePeople}
                  disabled={savingPeople || peopleCode.trim().length === 0}
                >
                  {savingPeople ? "Saving…" : "Save roster"}
                </button>
                <button
                  type="button"
                  className="admin-remove-section"
                  onClick={() => {
                    setPeopleCodeSent(false);
                    setPeopleCode("");
                    setPeopleMessage(null);
                  }}
                  disabled={savingPeople}
                >
                  Cancel
                </button>
              </>
            )}
            {peopleMessage && (
              <span className="admin-settings-message">{peopleMessage}</span>
            )}
          </div>
        </SettingsSection>

        {/* --- Officials & brief recipients --- */}
        <SettingsSection
          id="officials"
          title="Officials & brief recipients"
          defaultOpen={false}
        >
          <p className="form-hint">
            Accounts that hold a public office. The title shows as a pill next
            to their name everywhere they post — announcements, proposals,
            projects, and comments — and they can post announcements and
            respond to briefs. Leave name blank to use the person's own
            account name. Admins can always post and only need to be listed
            here if they also hold an office (they will show both badges).
          </p>
          <p className="form-hint">
            Officials marked <strong>Receives briefs</strong> get an email
            from the hub each time a brief is published. You can add or remove
            recipients for a particular brief while reviewing it.
          </p>

          {officials.length === 0 && (
            <p className="empty-state-inline" style={{ margin: "var(--space-sm) 0" }}>
              No officials configured. Only admins can post announcements.
            </p>
          )}

          {officials.length > 0 && (
            <div className="official-row official-head" aria-hidden="true">
              <span className="official-col-label">Email</span>
              <span className="official-col-label">Name</span>
              <span className="official-col-label">Office</span>
              <span className="official-col-label">
                Title <span className="official-col-note">(public pill)</span>
              </span>
              <span className="official-col-label">Receives briefs</span>
              <span />
            </div>
          )}

          {officials.map((official, i) => (
            <div key={i} className="official-row">
              <input
                className="form-input"
                type="email"
                value={official.email}
                onChange={(e) => updateOfficial(i, { email: e.target.value })}
                placeholder="official@example.com"
                aria-label={`Official ${i + 1} email`}
                disabled={!loaded || savingOfficials}
              />
              <input
                className="form-input"
                type="text"
                value={official.name ?? ""}
                onChange={(e) => updateOfficial(i, { name: e.target.value })}
                placeholder="Name"
                aria-label={`Official ${i + 1} name`}
                disabled={!loaded || savingOfficials}
                maxLength={80}
              />
              <select
                className="form-input"
                value={official.official_type}
                onChange={(e) => {
                  const nextType = e.target.value as OfficialType;
                  // Keep the title in step while it still matches the old
                  // office's default, so switching offices does the
                  // obvious thing — but never clobber a title the admin
                  // has customized ("Supervisor, District 3").
                  const isDefaultTitle = OFFICIAL_TYPES.some(
                    (t) => OFFICIAL_TYPE_LABELS[t] === official.official_title,
                  );
                  updateOfficial(i, {
                    official_type: nextType,
                    ...(isDefaultTitle
                      ? { official_title: OFFICIAL_TYPE_LABELS[nextType] }
                      : {}),
                  });
                }}
                aria-label={`Official ${i + 1} office`}
                disabled={!loaded || savingOfficials}
              >
                {OFFICIAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {OFFICIAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                className="form-input"
                type="text"
                value={official.official_title}
                onChange={(e) =>
                  updateOfficial(i, { official_title: e.target.value })
                }
                placeholder="Town Council"
                aria-label={`Official ${i + 1} title`}
                disabled={!loaded || savingOfficials}
                maxLength={50}
              />
              <label className="official-sends-briefs">
                <input
                  type="checkbox"
                  checked={official.sends_briefs}
                  onChange={(e) => updateOfficial(i, { sends_briefs: e.target.checked })}
                  aria-label={`Official ${i + 1} receives briefs`}
                  disabled={!loaded || savingOfficials}
                />
                <span className="official-sends-briefs-text">Receives briefs</span>
              </label>
              <button
                type="button"
                className="admin-remove-section"
                onClick={() => removeOfficial(i)}
                disabled={savingOfficials}
                aria-label={`Remove official ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            className="admin-add-section"
            onClick={addOfficial}
            disabled={!loaded || savingOfficials}
          >
            + Add official
          </button>

          <div className="official-extra-recipients">
            <label className="form-label" htmlFor="extra-brief-recipients">
              Also send briefs to{" "}
              <span className="official-col-note">
                (standing addresses that aren't a person's office — a clerk, a shared board inbox)
              </span>
            </label>
            <input
              id="extra-brief-recipients"
              className="form-input"
              type="text"
              value={extraRecipientsText}
              onChange={(e) => setExtraRecipientsText(e.target.value)}
              placeholder="clerk@example.gov, board@example.gov"
              disabled={!loaded || savingOfficials}
            />
          </div>

          <div className="admin-settings-actions" style={{ marginTop: "var(--space-md)" }}>
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveOfficials}
              disabled={!loaded || savingOfficials}
            >
              {savingOfficials ? "Saving…" : "Save officials & recipients"}
            </button>
            {officialsMessage && (
              <span className="admin-settings-message">{officialsMessage}</span>
            )}
          </div>
        </SettingsSection>

        {/* --- Support threshold --- */}
        <SettingsSection
          id="threshold"
          title="Proposal endorsement threshold"
          defaultOpen={false}
        >
          <label className="form-label" htmlFor="support-threshold">
            Endorsements needed
          </label>
          <p className="form-hint">
            How many community endorsements a proposed vote needs before it
            opens for ballots. Set it to 0 to skip the support phase: approved
            votes open immediately, with admin review as the only gate.
            Applies to votes submitted from now on — votes already gathering
            support keep their original number.
          </p>
          <input
            id="support-threshold"
            className="form-input"
            type="number"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Math.max(0, parseInt(e.target.value) || 0))}
            disabled={!loaded || savingThreshold}
            style={{ maxWidth: "120px" }}
          />
          <div className="admin-settings-actions">
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveThreshold}
              disabled={!loaded || savingThreshold}
            >
              {savingThreshold ? "Saving…" : "Save threshold"}
            </button>
            {thresholdMessage && (
              <span className="admin-settings-message">{thresholdMessage}</span>
            )}
          </div>
        </SettingsSection>

        {/* --- Comments & anonymity --- */}
        <SettingsSection
          id="comments"
          title="Comments & anonymity"
          defaultOpen={false}
        >
          <p className="form-hint">
            Votes are always anonymous (ballot secrecy) and creating a
            process always carries the creator's real name — those are
            fixed. This setting controls how residents appear on
            community comments.
          </p>
          <label className="form-label" htmlFor="comment-identity-mode">
            Comment identity
          </label>
          <select
            id="comment-identity-mode"
            className="form-input"
            value={identityMode}
            onChange={(e) => setIdentityMode(e.target.value as CommentIdentityMode)}
            disabled={!loaded || savingIdentityMode}
            style={{ maxWidth: "360px" }}
          >
            <option value="real_name">
              Real name required — no anonymous comments
            </option>
            <option value="anonymous_optional">
              Real name by default — residents may opt into anonymity
            </option>
            <option value="anonymous_only">
              Anonymous only — no names shown on comments
            </option>
          </select>
          <p className="form-hint">
            Anonymity is display-level: the author is always recorded
            internally for Code of Conduct moderation.
          </p>
          <div className="admin-settings-actions">
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveIdentityMode}
              disabled={!loaded || savingIdentityMode}
            >
              {savingIdentityMode ? "Saving…" : "Save comment identity"}
            </button>
            {identityModeMessage && (
              <span className="admin-settings-message">{identityModeMessage}</span>
            )}
          </div>
        </SettingsSection>

        {/* --- Beta allowlist --- */}
        <SettingsSection
          id="allowlist"
          title="Beta allowlist"
          defaultOpen={false}
        >
          <label className="form-label" htmlFor="beta-allowlist">
            Allowed emails
          </label>
          <p className="form-hint">
            Comma- or newline-separated list of emails allowed to sign in
            during beta. Admin emails are always allowed regardless of this
            list. Only takes effect when CIVIC_BETA_MODE is enabled.
          </p>
          <textarea
            id="beta-allowlist"
            className="form-textarea"
            rows={3}
            value={allowlistText}
            onChange={(e) => setAllowlistText(e.target.value)}
            disabled={!loaded || savingAllowlist}
            placeholder="friend@example.com, tester@example.com"
          />
          <div className="admin-settings-actions">
            <button
              type="button"
              className="admin-convert-button"
              onClick={saveAllowlist}
              disabled={!loaded || savingAllowlist}
            >
              {savingAllowlist ? "Saving…" : "Save allowlist"}
            </button>
            {allowlistMessage && (
              <span className="admin-settings-message">{allowlistMessage}</span>
            )}
          </div>
        </SettingsSection>

        {/* --- Waitlist --- */}
        <SettingsSection
          id="waitlist"
          title="Waitlist"
          defaultOpen={false}
        >
          <p className="form-hint">
            People who signed up for access on the beta landing page.
          </p>

          {waitlist.length === 0 ? (
            <p className="empty-state-inline" style={{ margin: "var(--space-sm) 0" }}>
              No one on the waitlist yet.
            </p>
          ) : (
            <>
              <p className="form-hint" style={{ margin: "0 0 var(--space-sm)" }}>
                {waitlist.length} {waitlist.length === 1 ? "person" : "people"} on the waitlist.
              </p>
              <div className="admin-waitlist-table-wrap">
                <table className="admin-waitlist-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Signed up</th>
                      <th>Test user</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waitlist.map((w) => (
                      <tr key={w.email}>
                        <td>{w.name ?? "—"}</td>
                        <td>{w.email}</td>
                        <td>{new Date(w.created_at).toLocaleDateString()}</td>
                        <td>{w.wants_test_user ? "Yes" : "—"}</td>
                        <td>{w.notes ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="admin-settings-actions" style={{ marginTop: "var(--space-sm)" }}>
                <button
                  type="button"
                  className="admin-convert-button"
                  onClick={copyWaitlistEmails}
                  disabled={waitlist.length === 0}
                >
                  {copiedWaitlist ? "Copied!" : "Copy all emails"}
                </button>
              </div>
            </>
          )}
        </SettingsSection>
      </div>
    </div>
  );
}
/**
 * A list of email addresses with add and remove. Two of them, so it is a
 * component rather than the same twenty lines written twice.
 *
 * `minimum` guards the last admin in the UI. The server guards it too — this
 * one only saves the admin a round trip and tells them why the button is
 * disabled, which an error after the fact would not.
 */
function EmailListEditor({
  label,
  addLabel,
  emails,
  onChange,
  disabled,
  minimum = 0,
  minimumHint,
}: {
  label: string;
  addLabel: string;
  emails: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  minimum?: number;
  minimumHint?: string;
}) {
  const atMinimum = emails.length <= minimum;
  return (
    <div style={{ marginTop: "var(--space-md)" }}>
      <label className="form-label">{label}</label>
      {emails.length === 0 && (
        <p className="empty-state-inline" style={{ margin: "var(--space-sm) 0" }}>
          None.
        </p>
      )}
      {emails.map((email, i) => (
        <div
          key={i}
          style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-sm)" }}
        >
          <input
            className="form-input"
            type="email"
            value={email}
            onChange={(e) =>
              onChange(emails.map((v, idx) => (idx === i ? e.target.value : v)))
            }
            placeholder="name@example.com"
            aria-label={`${label} ${i + 1}`}
            disabled={disabled}
            style={{ maxWidth: "360px" }}
          />
          <button
            type="button"
            className="admin-remove-section"
            onClick={() => onChange(emails.filter((_, idx) => idx !== i))}
            disabled={disabled || atMinimum}
            aria-label={`Remove ${label} ${i + 1}`}
            title={atMinimum ? minimumHint : undefined}
          >
            ×
          </button>
        </div>
      ))}
      {atMinimum && minimumHint && (
        <p className="form-hint">{minimumHint}</p>
      )}
      <button
        type="button"
        className="admin-add-section"
        onClick={() => onChange([...emails, ""])}
        disabled={disabled}
      >
        {addLabel}
      </button>
    </div>
  );
}

/**
 * One collapsible settings section.
 *
 * The page had eight sections and will keep growing — every new per-hub
 * setting lands here — so it had become a long scroll in which finding
 * anything meant reading everything. Collapsed by default is wrong (an admin
 * arriving to change one thing would have to open every section to find
 * which one holds it), so each section remembers its own state and the two
 * most-used open on a first visit.
 *
 * <details>/<summary> rather than a button and a state hook: it is keyboard
 * accessible, findable by the browser's own find-in-page when open, and
 * needs no JavaScript to toggle.
 */
function SettingsSection({
  id,
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const storageKey = `civic_admin_section_${id}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved !== null) return saved === "true";
    } catch {
      // Private mode, blocked storage — fall through to the default.
    }
    return defaultOpen;
  });

  function toggle(next: boolean) {
    setOpen(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // A remembered section is a convenience, never a requirement.
    }
  }

  return (
    <details
      className="admin-settings-panel admin-settings-section"
      open={open}
      onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="admin-settings-summary">
        <span className="admin-settings-summary-title">{title}</span>
        {subtitle && (
          <span className="admin-settings-summary-sub">{subtitle}</span>
        )}
      </summary>
      <div className="admin-settings-section-body">{children}</div>
    </details>
  );
}
