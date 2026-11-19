import { Link } from "react-router-dom";
import { useApi } from "../../../ui/src/hooks/useApi";
import PatternAvatar from "../../../ui/src/components/PatternAvatar";
import { useAuth } from "../../../ui/src/context/authState";
import { getMemberSummary, type MemberSummary } from "./api";
import { membersPageShown } from "./visibility";

/** The count and faces, read once for Home and the About card (and again on sign-in). */
export function useMemberSummary(): MemberSummary | null {
  const { user } = useAuth();
  // A nicety: a failed read leaves the count out.
  const { data } = useApi<MemberSummary>("members/summary", () => getMemberSummary(), { rereadOn: user?.id });
  return data ?? null;
}

/**
 * "N members" with a small stack of pattern-avatars, on Home, for everyone
 * (members and invites slice, Adam's design 2026-10-10). The count includes
 * members who hid themselves; the stack never shows them. Signed in, the
 * count links to the Members page.
 *
 * Below the plugin's threshold residents get no number from the server, so
 * none is drawn. An admin sees the number then, with a note that residents
 * don't yet. Drawn in Home's row beside "Share this hub", which is the
 * space's own (ui/src/components/HomeShareRow.tsx).
 */
export default function MemberCount() {
  const { user, isAdmin } = useAuth();
  const summary = useMemberSummary();
  const count = summary?.count ?? null;
  if (count === null || count <= 0) return null;

  const joined = !!user?.is_resident;
  const label = `${count.toLocaleString()} ${count === 1 ? "member" : "members"}`;
  // Before the threshold an admin sees the number; residents see nothing.
  const adminOnly = summary!.shown === false;

  return (
    <>
      <div className="member-stack" data-testid="member-stack">
        {summary!.stack.length > 0 && (
          <span className="member-stack-avatars" aria-hidden="true">
            {summary!.stack.map((seed) => (
              <PatternAvatar key={seed} seed={seed} size={28} />
            ))}
          </span>
        )}
        {joined && membersPageShown(isAdmin) ? (
          <Link to="/members" className="member-stack-count">
            {label}
          </Link>
        ) : (
          <span className="member-stack-count">{label}</span>
        )}
      </div>
      {adminOnly && (
        <p className="member-stack-note" data-testid="member-count-admin-only">
          Only admins see this until {(summary!.threshold ?? 0).toLocaleString()} members.{" "}
          <Link to="/admin/settings/plugins#members">Members plugin</Link>
        </p>
      )}
    </>
  );
}

/** The count in the right column's About card, when residents see it (the same rule as Home's). */
export function AboutMemberLine() {
  const summary = useMemberSummary();
  const count = summary?.count ?? null;
  if (count === null || summary?.shown === false) return null;
  return (
    <p className="aside-about-line aside-about-count">
      {count.toLocaleString("en-US")} {count === 1 ? "member" : "members"}
    </p>
  );
}
