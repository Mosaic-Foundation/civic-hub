import { Link } from "react-router-dom";
import { ListCard } from "../kit";
import { typeDisplay } from "../config/navigation";
import { typeColorSlug } from "./typeColor";
import { friendlyType } from "./processLinkTypes";
import SampleBadge from "./SampleBadge";
import { closesWords } from "./closingSoon";
import type { ClosingSoonRow } from "../services/api";

/**
 * A "closing soon" card in the feed (Events 4, Adam, 2026-11-09): the kit's
 * ListCard in its feed form, like every other card, with the type's chip and
 * colour bar, the title, and when it closes in the hub's zone instead of when
 * it happened. It links to the process.
 */
export default function ClosingSoonPost({ row, now, timeZone }: { row: ClosingSoonRow; now: number; timeZone: string | null }) {
  const label = typeDisplay(row.type)?.label ?? friendlyType(row.type);
  return (
    <ListCard
      pill="meta"
      kind={typeColorSlug(row.type)}
      kindLabel={label}
      title={row.title}
      className="feed-post--closing"
      badges={row.sample ? <SampleBadge /> : undefined}
      meta={[
        <time key="closes" className="feed-post-note feed-post-closes" dateTime={row.closes_at} data-testid="closing-soon">
          {closesWords(row.closes_at, now, timeZone)}
        </time>,
      ]}
      href={row.url}
      linkAs={Link}
    />
  );
}
