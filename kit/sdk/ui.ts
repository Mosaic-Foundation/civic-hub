// @civic-social/plugin-sdk/ui: the shape of a package's UI module (ui.tsx),
// and the hub's UI kit (engine 2, A7; design pass, 2026-10-29): its buttons,
// labelled fields, inputs, selects, checkboxes, radio cards, chips, the
// date-time control, textareas, a picture upload, cards, stats, tables and
// the drafting shell (DraftShell, whose `phoneTitle` is the slim phone
// header); and the page patterns (Events 3, 2026-11-08): Page, PageHead and
// PageAction, Group, DayGroup and GroupHeading, CardList and ListCard, Chip and
// StatusChip, InlineMeta, EmptyState, FilterBar, ViewToggle, MonthGrid and
// WeekStrip; and an item's page: FactList, Notice, Note, Picture, Fieldset; and
// TimeZoneSelect (Events 0.4.1): seven zones first, then "More time zones…". A package's page is composed of these and looks exactly like the
// hub's own, whatever the hub's theme and layout; its stylesheet sets layout
// spacing only (docs/PLUGIN-STYLE.md; conformance step 22).

export type { ProcessUi, ProcessRoute } from "../../ui/src/processes/types";

export {
  Button,
  Card,
  CardList,
  Checkbox,
  Chip,
  ChipGroup,
  DateTimeInput,
  DayGroup,
  EmptyState,
  FactList,
  Field,
  Fieldset,
  FilterBar,
  Group,
  GroupHeading,
  ImageUpload,
  InlineMeta,
  ListCard,
  MonthGrid,
  Note,
  Notice,
  Page,
  PageAction,
  PageHead,
  Picture,
  RadioCards,
  Select,
  Stat,
  StatGrid,
  StatusChip,
  Table,
  TextArea,
  TextInput,
  TimeZoneSelect,
  ViewToggle,
  WeekStrip,
  type CalendarItem,
  type ListCardProps,
  type StatusTone,
} from "../../ui/src/kit/index";
export { fromLocalInput, toLocalInput } from "../../ui/src/kit/datetime";
// Host-provided, not the portable kit (Events 3): the drafting shell knows the
// hub's sign-in, its assistant and its header, so it comes from the hub's own
// components (tests/unit/kitPortable.test.ts lists it by name).
export { default as DraftShell } from "../../ui/src/components/DraftShell";
// Host-provided too: the hub's clock, the zone every time on a page or a feed
// card is shown in (the setting, else the place's zone, else UTC).
export { hubTimeZone } from "../../ui/src/config/hubClock";
export { dayHeading, dayKey, groupByDay, shiftDay } from "../../ui/src/kit/dates";
