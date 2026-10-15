// How residents read a process type: the feed's pill, the icon, and the
// section it has in the hub's navigation (navigation slice, 2026-10-14).
//
// Declared once per type in its descriptor (ProcessTypeDescriptor.display,
// src/processes/descriptor.ts), served in GET /hub-config as `process_types`,
// and read by the UI, so a plugin's type gets its pill and section with no UI
// change. Here, not in the descriptor module, because the UI imports it.
// No place names: a type is the same thing on every hub.

export interface TypeDisplay {
  /** One of them, as the feed's pill says it: "Vote". */
  label: string;
  /** More than one: "Votes". */
  plural: string;
  /**
   * The type's icon in the UI's icon set (ui/src/components/navIcons.tsx).
   * A key the UI doesn't know draws the generic icon.
   */
  icon: string;
  /** A list page of its own in the hub's navigation; absent for types read only in the feed. */
  section?: TypeSection;
}

export interface TypeSection {
  /** Stable id, stored in the hub's section order (`nav.section_order`). */
  id: string;
  /** The section's name in the sidebar, the tabs and the More sheet. */
  label: string;
  /** One word for the phone's bottom bar, where five must fit: "Discuss". Default: label. */
  short?: string;
  /** The UI route of its list. */
  path: string;
  /** Routes of its detail pages: the section stays highlighted on them. */
  detail_paths: readonly string[];
  /** Its place in the default section order (lower first). */
  order: number;
}

/** One type as GET /hub-config serves it: its type, its plugin and its display. */
export interface ProcessTypeDisplay extends TypeDisplay {
  type: string;
  plugin: string;
}
