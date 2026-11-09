// Archive on every type's detail page, from the framework (Adam, 2026-11-09:
// "All plugins should have that"). Before, each page put its own
// AdminArchiveButton in, so a plugin page that didn't (Events) had none.
//
// Now App wraps every type's detail route (the route its manifest's
// detailPath names) in <ArchiveSlotProvider>. A page that draws its own
// <DetailActions> gets the archive control as that row's last item; a page
// that doesn't (a plugin's own page, which cannot import the hub's
// components) gets the row drawn after it by the host. Either way there is
// exactly one, it shows only to admins (AdminArchiveButton), and a type added
// later has it with nothing to opt into.

import { useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ArchiveSlotContext } from "./archiveSlotContext";
import { useNavigate, useParams } from "react-router-dom";
import AdminArchiveButton from "./AdminArchiveButton";
import { typeDisplay } from "../config/navigation";
import { useAuth } from "../context/authState";

/** The archive control for the page's process, or nothing outside a detail route. */
export function SlotArchiveButton() {
  const slot = useContext(ArchiveSlotContext);
  const navigate = useNavigate();
  if (!slot) return null;
  const shown = typeDisplay(slot.type);
  return (
    <AdminArchiveButton
      processId={slot.id}
      itemLabel={(shown?.label ?? "item").toLowerCase()}
      onArchived={() => navigate(shown?.section?.path ?? "/")}
    />
  );
}

/**
 * Wraps a type's detail page. Draws the page, then, unless the page drew its
 * own DetailActions, a row holding the archive control. `row` is that row
 * (DetailActions, passed in so this file doesn't import it back).
 */
export function ArchiveSlotProvider({
  type,
  children,
  row: Row,
}: {
  type: string;
  children: ReactNode;
  row: (props: { children: ReactNode; host?: true }) => ReactNode;
}) {
  const { id } = useParams();
  const { isAdmin } = useAuth();
  const [claims, setClaims] = useState(0);
  const claim = useCallback(() => {
    setClaims((n) => n + 1);
    return () => setClaims((n) => n - 1);
  }, []);
  const slot = useMemo(() => (id ? { type, id, claim } : null), [type, id, claim]);
  if (!slot) return <>{children}</>;
  return (
    <ArchiveSlotContext.Provider value={slot}>
      {children}
      {/* Only an admin has anything for it; drawn for no one else. */}
      {claims === 0 && isAdmin && (
        <Row host>
          <SlotArchiveButton />
        </Row>
      )}
    </ArchiveSlotContext.Provider>
  );
}
