// @civic-social/plugin-sdk/ui: the shape of a package's UI module (ui.tsx),
// and the hub's UI kit (engine 2, A7): its buttons, labelled fields, inputs,
// selects, the date-time control, textareas and the drafting shell (DraftShell,
// whose `phoneTitle` is the slim phone header). A package's pages draw with
// these and look like the hub's own; they run on the React the hub runs.

export type { ProcessUi, ProcessRoute } from "../../ui/src/processes/types";

export {
  Button,
  DateTimeInput,
  DraftShell,
  Field,
  Select,
  TextArea,
  TextInput,
} from "../../ui/src/kit/index";
export { fromLocalInput, toLocalInput } from "../../ui/src/kit/datetime";
