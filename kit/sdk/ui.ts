// @civic-social/plugin-sdk/ui: the shape of a package's UI module (ui.tsx),
// and the hub's UI kit (engine 2, A7; design pass, 2026-10-29): its buttons,
// labelled fields, inputs, selects, checkboxes, radio cards, chips, the
// date-time control, textareas, a picture upload, cards, stats, tables and
// the drafting shell (DraftShell, whose `phoneTitle` is the slim phone
// header); and the page patterns (Events 3, 2026-11-08): Page, PageHead and
// PageAction, Group, DayGroup and GroupHeading, CardList and ListCard, Chip and
// StatusChip, InlineMeta, EmptyState, FilterBar, ViewToggle, MonthGrid and
// WeekStrip. A package's page is composed of these and looks exactly like the
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
  DraftShell,
  EmptyState,
  Field,
  FilterBar,
  Group,
  GroupHeading,
  ImageUpload,
  InlineMeta,
  ListCard,
  MonthGrid,
  Page,
  PageAction,
  PageHead,
  RadioCards,
  Select,
  Stat,
  StatGrid,
  StatusChip,
  Table,
  TextArea,
  TextInput,
  ViewToggle,
  WeekStrip,
  type CalendarItem,
  type ListCardProps,
  type StatusTone,
} from "../../ui/src/kit/index";
export { fromLocalInput, toLocalInput } from "../../ui/src/kit/datetime";
export { dayHeading, dayKey, groupByDay, shiftDay } from "../../ui/src/kit/dates";
