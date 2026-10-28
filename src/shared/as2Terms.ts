// The ActivityStreams 2.0 vocabulary's terms (https://www.w3.org/TR/activitystreams-vocabulary/,
// §4 Properties), plus the JSON-LD keywords a document carries. What a wire
// object may use without declaring a context of its own (Events 2, E4):
// conformance step 8 holds every other term on a type's wire object to a
// context the document declares.

export const AS2_TERMS: ReadonlySet<string> = new Set([
  "@context", "id", "type",
  "actor", "attachment", "attributedTo", "audience", "bcc", "bto", "cc", "context", "current", "first",
  "generator", "icon", "image", "inReplyTo", "instrument", "last", "location", "items", "oneOf", "anyOf",
  "closed", "origin", "next", "object", "prev", "preview", "result", "replies", "tag", "target", "to", "url",
  "accuracy", "altitude", "content", "contentMap", "name", "nameMap", "duration", "height", "href", "hreflang",
  "partOf", "latitude", "longitude", "mediaType", "endTime", "published", "startTime", "radius", "rel",
  "startIndex", "summary", "summaryMap", "totalItems", "units", "updated", "width", "subject", "relationship",
  "describes", "formerType", "deleted",
]);
