import { useApi } from "../../../ui/src/hooks/useApi";
import type { FormApi } from "../../../ui/src/pages/settings/pluginFields";
import { BooleanField, NumberField } from "../../../ui/src/pages/settings/fields";
import { MIN_COUNT_KEY, PAGE_BEFORE_THRESHOLD_KEY } from "../rules";
import { getMemberSummary, type MemberSummary } from "./api";

/** The Members plugin's panel on the Plugins page: its threshold, and the page before it. */
export function membersSettingsPanel(f: FormApi) {
  return (
    <>
      <MemberCountLine saved={f.data.values[MIN_COUNT_KEY] ?? ""} />
      <NumberField
        f={f}
        k={MIN_COUNT_KEY}
        label="Show members from"
        unit="members"
        placeholder="0"
        hint="Until the hub has this many members, residents see no member count, no faces and no Members page. Admins always see them. Empty or 0 shows them from the first member."
      />
      <BooleanField
        f={f}
        k={PAGE_BEFORE_THRESHOLD_KEY}
        label="Show the Members page before then"
        hint="The page and its place in the menus appear for members now; the count on the home page still waits."
      />
    </>
  );
}

/**
 * How many members the hub has now, which only admins see before the
 * threshold. Read again when a save changes the threshold (`saved`).
 */
function MemberCountLine({ saved }: { saved: string }) {
  const { data: summary } = useApi<MemberSummary>("members/summary", () => getMemberSummary(), { rereadOn: saved });
  if (!summary || summary.count === null) return null;
  return (
    <p className="form-hint" data-testid="members-now">
      This hub has {summary.count.toLocaleString()} {summary.count === 1 ? "member" : "members"}
      {summary.shown === false ? "; residents don't see the count yet." : "; residents see the count."}
    </p>
  );
}
