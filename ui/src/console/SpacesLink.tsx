// The breadcrumb's first link: the list of spaces ("Hubs"), named from the
// space-type record (spaceNames.ts).

import { capital, useSpaceNames } from "./spaceNames";

export function SpacesLink({ href }: { href: string }) {
  const names = useSpaceNames();
  return <a href={href}>{capital(names.noun_plural)}</a>;
}
