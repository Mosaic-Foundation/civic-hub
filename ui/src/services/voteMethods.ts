/**
 * Which extra assistant fields each voting method needs, beyond the shared
 * title / description / sources. Mirrors VOTE_METHOD_EXTRA_FIELDS in
 * src/processes/voteAssistantConfig.ts (the ui and the server are separate
 * builds; keep the two in step). Drives which help chips a vote shows and
 * which suggestion fields can be applied. A method added later declares its
 * own line here and on the server, and is handled everywhere.
 */
export const VOTE_METHOD_EXTRA_FIELDS: Record<string, string[]> = {
  yes_no_unsure: [],
  approval: ["options"],
};

export const VOTE_SHARED_FIELDS = ["title", "description", "sources"];

/** The assistant fields that apply to a vote with this method. */
export function voteAssistantFields(method: string): string[] {
  return [...VOTE_SHARED_FIELDS, ...(VOTE_METHOD_EXTRA_FIELDS[method] ?? [])];
}

/** custom_options ⇄ the one-per-line "options" text the assistant uses. */
export function optionsToText(options: string[] | null | undefined): string {
  return (options ?? []).map((o) => o.trim()).filter(Boolean).join("\n");
}
export function textToOptions(text: string): string[] {
  return text.split("\n").map((o) => o.trim()).filter(Boolean);
}
