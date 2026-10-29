// @civic-social/plugin-sdk/ui: the shape of a package's UI module (ui.tsx),
// and the hub's UI kit (engine 2, A7; design pass, 2026-10-29): its buttons,
// labelled fields, inputs, selects, checkboxes, radio cards, chips, the
// date-time control, textareas, a picture upload, cards, stats, tables, page
// heads and the drafting shell (DraftShell, whose `phoneTitle` is the slim
// phone header). A package's pages draw with these and look like the hub's
// own, whatever the hub's theme; they run on the React the hub runs, and set
// no colour, font or spacing of their own (docs/PLUGIN-STYLE.md).

export type { ProcessUi, ProcessRoute } from "../../ui/src/processes/types";

export {
  Button,
  Card,
  Checkbox,
  ChipGroup,
  DateTimeInput,
  DraftShell,
  Field,
  ImageUpload,
  PageHead,
  RadioCards,
  Select,
  Stat,
  StatGrid,
  Table,
  TextArea,
  TextInput,
} from "../../ui/src/kit/index";
export { fromLocalInput, toLocalInput } from "../../ui/src/kit/datetime";
