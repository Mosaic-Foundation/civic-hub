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
