// Fields a browser or password manager must not fill (pilot readiness 3, Adam
// 2026-11-06). On the create forms an address book's "name", "state" or
// "organization" landed in the place search and the hub's fields. Browsers
// read autocomplete="off" loosely, so the managers' own opt-outs ride along,
// and the fields' names don't read as address-book fields. The one field that
// is an address book's, the contact address, says autocomplete="email".

export const NO_FILL = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

/**
 * A text field's version (Adam, 2026-11-06, after LastPass still offered to
 * fill the place search). LastPass ignores all of the above and puts its
 * offer on the field it thinks most like an address book's ("Name" after
 * "State", then "Web address"). Tried in LastPass on the creation form's own
 * labels: a search field is the one kind it leaves alone, names with
 * "search" in them are not enough. console.css draws it as a plain field.
 */
export const NO_FILL_TEXT = { ...NO_FILL, type: "search" } as const;
