// /process/:id, the kernel's link to any process (kernel step 3,
// docs/kernel/SURFACE.md "Event: couplings that go"). Every process's
// activities name this path, so an old link has to open whatever plugins the
// hub runs.
//
// A type whose own page lives at /process/:id (a vote, today) registers that
// page here; while its plugin is on, the link is that page, read once, and
// the page sends any other type on to its own page. With no such page on (or
// none installed), the kernel reads the process and sends the link to its
// type's page itself.

import type { ReactElement } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useHub } from "../config/hub";
import { useApi } from "../hooks/useApi";
import { getProcessState, type ProcessState } from "../services/api";
import { detailPathOf, pluginOfType } from "../processes/display";
import { PluginOff } from "../components/PluginOff";
import type { PluginId } from "../../../src/shared/hubSettingsSections";

/** A type's page registered at /process/:id, and the plugin that switches it. */
export interface ProcessLinkPage {
  type: string;
  plugin?: PluginId;
  element: ReactElement;
}

export default function ProcessLink({ pages }: { pages: ProcessLinkPage[] }) {
  const hub = useHub();
  const page = pages.find((p) => !p.plugin || hub.plugins.enabled(p.plugin));
  if (page) return page.element;
  return <SendOn />;
}

function SendOn() {
  const hub = useHub();
  const { id } = useParams<{ id: string }>();
  // Retries: a serverless cold start may need a moment.
  const { data: process, loading, error, reload } = useApi<ProcessState>(
    id ? `process/${id}/state` : null,
    () => getProcessState(id!),
    { retries: 2 },
  );

  if (loading) return <p className="detail-page">Loading...</p>;
  if (error) return (
    <div className="page detail-page">
      <p className="error">Error: {error.message}</p>
      <button className="retry-button" onClick={() => void reload()}>
        Try again
      </button>
    </div>
  );
  if (!process) return (
    <div className="page detail-page">
      <p>Not found.</p>
    </div>
  );

  const path = detailPathOf(process.type, process.id);
  if (path !== `/process/${process.id}`) return <Navigate to={path} replace />;
  // A type whose page is this one, with its plugin off or not installed: what
  // a switched-off plugin's route shows.
  const plugin = pluginOfType(process.type);
  if (!plugin || !hub.plugins.enabled(plugin)) return <PluginOff />;
  return (
    <div className="page detail-page">
      <p>Not found.</p>
    </div>
  );
}
