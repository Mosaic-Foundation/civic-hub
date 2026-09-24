// Admin Settings — one page, a section list on the left, one section's form
// on the right. Every per-hub value an admin can change lives here, so an
// admin never needs Vercel, the database or the code to run their hub.
//
// Sections are addressed by URL (/admin/settings/<section>) so a link can
// point at one, and the browser's back button moves between them. Switching
// away from a section with unsaved edits asks first.

import { Navigate, useNavigate, useParams, Link } from "react-router-dom";
import AdminTabs from "../components/AdminTabs";
import {
  HubSettingsProvider,
  confirmDiscard,
  useHubSettings,
} from "./settings/HubSettingsContext";
import IdentitySection from "./settings/IdentitySection";
import CopySection from "./settings/CopySection";
import LegalSection from "./settings/LegalSection";
import EmailSection from "./settings/EmailSection";
import LegacySettings from "./settings/LegacySettings";
import "./AdminSettings.css";

interface SectionEntry {
  id: string;
  label: string;
  render?: () => React.ReactNode;
  /** Listed but not yet available. */
  comingNote?: string;
}

const SECTIONS: readonly SectionEntry[] = [
  { id: "identity", label: "Identity", render: () => <IdentitySection /> },
  { id: "copy", label: "Copy & pages", render: () => <CopySection /> },
  { id: "legal", label: "Legal", render: () => <LegalSection /> },
  { id: "email", label: "Email", render: () => <EmailSection /> },
  { id: "other", label: "Other settings", render: () => <LegacySettings /> },
  { id: "plugins", label: "Plugins", comingNote: "Coming next" },
];

const FIRST = SECTIONS[0]!.id;

export default function AdminSettings() {
  return (
    <HubSettingsProvider>
      <SettingsPage />
    </HubSettingsProvider>
  );
}

function SettingsPage() {
  const { section } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const { dirty } = useHubSettings();

  const current = SECTIONS.find((s) => s.id === section && s.render);
  if (!current) return <Navigate to={`/admin/settings/${FIRST}`} replace />;

  function go(e: React.MouseEvent, id: string) {
    e.preventDefault();
    if (id === current!.id) return;
    if (dirty.size > 0 && !confirmDiscard()) return;
    navigate(`/admin/settings/${id}`);
  }

  return (
    <div className="page admin-settings-page">
      <AdminTabs />
      <div className="admin-settings-body">
        <h1>Settings</h1>
        <p className="admin-subtitle">
          Everything about this hub that you can change. Saved changes take
          effect straight away; there is nothing to redeploy.
        </p>

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            <ul role="list">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  {s.render ? (
                    <Link
                      to={`/admin/settings/${s.id}`}
                      data-settings-nav=""
                      className={`settings-nav-link${s.id === current.id ? " is-active" : ""}`}
                      aria-current={s.id === current.id ? "page" : undefined}
                      onClick={(e) => go(e, s.id)}
                    >
                      {s.label}
                      {dirty.has(s.id) && (
                        <span className="settings-nav-dot" aria-label="unsaved changes" />
                      )}
                    </Link>
                  ) : (
                    <span className="settings-nav-link is-disabled" aria-disabled="true">
                      {s.label}
                      {s.comingNote && (
                        <span className="settings-nav-note">{s.comingNote}</span>
                      )}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </nav>

          <div className="settings-content">{current.render!()}</div>
        </div>
      </div>
    </div>
  );
}
