/**
 * Process type → the --type-<slug>-* color token family (theme.css).
 *
 * Read from the type's manifest (ui/src/processes/display.ts): every surface
 * that colors by type but is not a feed card (the feed classifies by activity,
 * in src/shared/feedActivity.ts) takes the manifest's colour, so briefs and
 * vote results take the hub's terracotta and a type registered tomorrow is
 * coloured the moment its manifest exists. An unknown type is "generic".
 */
export { typeColorSlug } from "../processes/display";
