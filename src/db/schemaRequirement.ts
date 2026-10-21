// One table (and columns) a part of the hub needs, checked at startup and by
// /health (src/db/schemaContract.ts). Its own file, importing nothing, so a
// process manifest can declare its storage without reaching server code
// (Architecture 2).

export interface SchemaRequirement {
  /** Table that must exist. */
  table: string;
  /**
   * Columns whose absence breaks a read or write path. Omit to check that the
   * table merely exists.
   *
   * List the drift-prone ones — anything a migration added after the initial
   * schema, and anything the code writes by name. Do NOT guess at primary
   * keys: `deliberation_submissions` is keyed on (process_id, user_id) and has
   * no `id` column, and an invented column name produces a false alarm that
   * costs more trust than the check earns.
   */
  columns?: string[];
  /**
   * Columns that must NOT exist, with the reason. For invariants the schema
   * enforces by absence: `vote_records` has no `user_id` and
   * `vote_participation` has no `receipt_id`, and that separation IS the
   * anonymous-ballot guarantee (see supabase/README.md "Don'ts"). A migration
   * that adds either one silently converts every past vote into an
   * attributable record, which is precisely the kind of change that should
   * not be discovered later.
   */
  forbiddenColumns?: Array<{ column: string; reason: string }>;
  /** Who needs it. Appears in the log so the owner is obvious at a glance. */
  owner: string;
}
