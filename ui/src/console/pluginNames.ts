import { PLUGIN_NAMES as NAMES } from "../../../src/shared/pluginNames";

/** What the console calls each plugin (src/shared/pluginNames.ts; the server sends them too, as plugin_names). */
export const PLUGIN_NAMES: Readonly<Record<string, string>> = NAMES;
