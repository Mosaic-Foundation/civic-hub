// The types behind one admin queue, grouped by the state field that says a
// record is pending. The manifests declare both (`publication`); the queue
// counts (admin tab badges, the dashboard's "waiting for attention") read
// them from here instead of listing types and fields by hand. Types of one
// queue normally share a field; if they do not, each field is counted on
// its own and the counts are summed.

import { publicationOf, typesPublishedThrough } from "../processes/registry.js";
import type { PublicationQueue } from "../processes/manifest.js";

export interface QueueTypeGroup {
  field: string;
  types: string[];
}

export function queueTypeGroups(queue: PublicationQueue): QueueTypeGroup[] {
  const groups = new Map<string, string[]>();
  for (const type of typesPublishedThrough(queue)) {
    const field = publicationOf(type)?.field;
    if (!field) continue;
    groups.set(field, [...(groups.get(field) ?? []), type]);
  }
  return [...groups].map(([field, types]) => ({ field, types }));
}
