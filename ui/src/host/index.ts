// The kernel's UI surface for a package's pages (kernel step 1,
// docs/kernel/SURFACE.md, "The UI side"): what every space's pages share and a
// package's page may use, beyond the portable kit (ui/src/kit). The SDK's UI
// entry (kit/sdk/ui.ts) re-exports this file, and reaches the hub's app only
// through it and the two pieces tests/unit/kitPortable.test.ts names.
//
// Named one by one, never `export *`: a name joins when a package's page needs
// it and it means the same in any space type. Narrow where the hub's own is
// wide: a page reads the viewer through useViewer(), not the hub's whole
// sign-in state, and the space through useSpace(), not the hub's config.

import { useAuth } from "../context/authState";
import { useHub } from "../config/hub";
import { theName } from "../../../src/shared/hubCopy";

// --- Calling the kernel's API: the session, errors as ApiError, the read cache ----------
export { request as apiRequest } from "../services/http";
export { ApiError } from "../utils/httpError";
export { useApi, type ApiState, type UseApiOptions } from "../hooks/useApi";
export { useAction, type ActionRunner } from "../hooks/useAction";

// --- Signing in before acting ------------------------------------------------------------
export { useRequireAuth } from "../hooks/useRequireAuth";
export { default as AuthModal } from "../components/AuthModal";

/** Who is reading the page, as a package's page may know it. */
export interface Viewer {
  /** True until the session has been read. */
  loading: boolean;
  /** The viewer's actor id, or null when signed out. */
  actorId: string | null;
  /** Signed in and able to take part (a member of the space). */
  canParticipate: boolean;
  /** One of the space's admins. */
  isAdmin: boolean;
}

export function useViewer(): Viewer {
  const { loading, actorId, canParticipate, isAdmin } = useAuth();
  return { loading, actorId, canParticipate, isAdmin };
}

/** The space the page is in, as a package's page may know it. */
export interface SpaceView {
  /** What the space calls itself. */
  name: string;
  /** Its name in running text: "the Floyd Civic Hub", or a name that needs no article as it is. */
  theName: (capital?: boolean) => string;
  /**
   * What the space serves, in running text ("what you love about …"): its
   * place where it has one ("Floyd County" on a Civic Hub), else its name, else
   * "where you live". The UI side of the kernel's spacePlace().
   */
  place: string;
}

export function useSpace(): SpaceView {
  const hub = useHub();
  const name = hub.name;
  return { name, theName: (capital = false) => theName(name, capital), place: hub.place };
}

// --- The parts every process page shares ---------------------------------------------------
export { default as ProcessHeader } from "../components/ProcessHeader";
export { statusDisplay, type StatusDisplay } from "../components/statusDisplay";
export { default as AdminArchiveButton } from "../components/AdminArchiveButton";
export { formatDate } from "../utils/dates";
export { formatCount } from "../processes/feedText";
export { safeReturnPath } from "../config/pluginRules";

// --- A plugin's settings panel: the settings page's own fields ----------------------------
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
  type FormApi,
} from "../pages/settings/pluginFields";
