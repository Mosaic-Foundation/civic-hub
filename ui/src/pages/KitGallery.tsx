// The kit's gallery (Events 3, 2026-11-08): every page pattern a package draws
// with (@civic-social/plugin-sdk/ui), on one page in the hub's public layout,
// so an admin sees them in this hub's theme, in light and dark, in whichever
// layout the hub uses. Admins only (AdminGuard), linked from nowhere: a
// reference for whoever builds a plugin, and the page the screenshots take.
// Its contents are made up and name no place.

import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CardList,
  Chip,
  DayGroup,
  EmptyState,
  FilterBar,
  Group,
  InlineMeta,
  ListCard,
  MonthGrid,
  Page,
  PageAction,
  PageHead,
  StatusChip,
  ViewToggle,
  WeekStrip,
  type CalendarItem,
} from "../kit";
import { dayKey, shiftDay } from "../kit/dates";
import SampleBadge from "../components/SampleBadge";

export default function KitGallery() {
  const today = dayKey(new Date());
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [day, setDay] = useState(today);
  const items: CalendarItem[] = [
    { id: "a", day: today, label: "6:00 PM Planning meeting", kind: "event" },
    { id: "b", day: shiftDay(today, 2), label: "10:00 AM Clean-up day", kind: "event" },
    { id: "c", day: shiftDay(today, 2), label: "1:00 PM Library talk", kind: "event", cancelled: true },
    { id: "d", day: shiftDay(today, 9), label: "7:00 PM Budget workshop", kind: "event" },
  ];
  const at = (d: string, hour: number) => `${d}T${String(hour).padStart(2, "0")}:00:00`;

  return (
    <Page>
      <PageHead
        title="The kit"
        lede={<>Every pattern a page is made of, in this hub's theme. A plugin's page uses these and nothing of its own.</>}
        action={<PageAction onClick={() => undefined}>Main action</PageAction>}
      />

      <FilterBar
        choices={[
          { key: "all", label: "All" },
          { key: "open", label: "Active" },
          { key: "done", label: "Completed" },
        ]}
        active={filter}
        onChange={setFilter}
        label="FilterBar"
      />

      <Group heading={<>ListCard, <code>pill="top"</code></>} description="A section page's card: the kind's bar and chip, the status on the right, the title, the meta line.">
        <CardList>
          <li>
            <ListCard
              href="/kit"
              linkAs={Link}
              kind="vote"
              kindLabel="Vote"
              title="Which step should come first?"
              status={<StatusChip tone="live">Active</StatusChip>}
              meta={["Nov 2", "30 votes", "closes Nov 16"]}
            />
          </li>
          <li>
            <ListCard
              kind="proposal"
              kindLabel="Proposal"
              title="Longer opening hours on weekday evenings"
              badges={<SampleBadge />}
              status={<StatusChip tone="phase">Gathering support</StatusChip>}
              meta={["Nov 3", "3 of 8 endorsements"]}
            />
          </li>
          <li>
            <ListCard
              kind="event"
              kindLabel="Event"
              title="Clean-up day"
              status={<StatusChip tone="alert">Cancelled</StatusChip>}
              meta={[<strong>Saturday, 10:00 AM – 1:00 PM</strong>, "The park shelter"]}
            />
          </li>
          <li>
            <ListCard
              kind="project"
              kindLabel="Project"
              title="Without a status: the header form"
              summary="A line or two of summary under the title, when the card has one."
              meta={["Oct 18", "50 supporters"]}
            />
          </li>
        </CardList>
      </Group>

      <Group heading={<>ListCard, <code>pill="meta"</code></>} description="The feed's card: the title first, the kind's chip leading the meta line.">
        <CardList>
          <li>
            <ListCard
              pill="meta"
              href="/kit"
              linkAs={Link}
              kind="announcement"
              kindLabel="Announcement"
              title="The road work starts Monday"
              meta={[<span className="feed-post-author">The clerk</span>, <span className="feed-post-time">2 hours ago</span>]}
              summary="Expect one lane open on the main road from Monday to Thursday, 7 AM to 5 PM."
            />
          </li>
        </CardList>
      </Group>

      <Group heading="Chip, StatusChip, InlineMeta">
        <p>
          <Chip kind="vote">Vote</Chip> <Chip kind="event">Event</Chip> <Chip kind="conversation">Conversation</Chip>{" "}
          <Chip>Generic</Chip>
        </p>
        <p>
          <StatusChip tone="live">Active</StatusChip> <StatusChip tone="phase">Gathering support</StatusChip>{" "}
          <StatusChip tone="done">Completed</StatusChip> <StatusChip tone="alert">Cancelled</StatusChip>
        </p>
        <InlineMeta items={["7:00 PM", "Town hall", "12 going"]} />
      </Group>

      <Group heading="EmptyState">
        <EmptyState>Nothing here yet.</EmptyState>
        <EmptyState action={<PageAction onClick={() => undefined}>Add the first</PageAction>}>Nothing is on the calendar yet.</EmptyState>
      </Group>

      <Group heading="ViewToggle, MonthGrid, WeekStrip">
        <ViewToggle
          value={view}
          onChange={setView}
          label="View"
          options={[
            { value: "list", label: "List" },
            { value: "calendar", label: "Calendar" },
          ]}
        />
        <MonthGrid items={items} selected={day} onSelect={setDay} today={today} />
        <WeekStrip items={items} selected={day} onSelect={setDay} today={today} />
      </Group>

      <DayGroup date={at(today, 12)}>
        <EmptyState>DayGroup: a day as its heading, then its list.</EmptyState>
      </DayGroup>

      <Group heading="Group, folded (collapsible)" collapsible>
        <EmptyState>What a folded group holds: past events, say.</EmptyState>
      </Group>
    </Page>
  );
}
