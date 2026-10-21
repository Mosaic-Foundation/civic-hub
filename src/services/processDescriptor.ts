// The Civic Process Descriptor of one process (Civic Process Specification
// §12.1; Architecture 2, 2026-10-21; ADR-009): what GET /process/:id answers
// a caller that asks for JSON-LD, and what the `context` IRI on every one of
// its activities dereferences to.
//
// Built from the type's manifest plus this process's own fields, and only
// from what is true of the hub today (Adam, 2026-10-21): no lifecycle
// profile, participation mode, interaction type, disclosure policy or
// aggregation method, which the spec names and the hub does not have yet
// (listed as proposed spec changes in the Architecture-2 report). No results:
// results on the wire wait for the redaction policy (audit A3).
//
// Its `id` and `created_by` are read from the process's own
// civic.process.created activity, serialized for this caller exactly as GET
// /events serves it (ids frozen at creation, ADR-008; the same redaction), so
// the descriptor and the wire cannot disagree about who or where.

import { getProcess, getProcessState, asRead } from "./processService.js";
import { getManifest, residentActionsOf } from "../processes/registry.js";
import { getEventsByProcessId } from "../events/eventStore.js";
import { AS2_CONTEXT, CIVIC_CONTEXT, toActivity } from "../events/activitySerializer.js";
import { officialActorIds, toRedactedActivity, type WireAudience } from "../events/publicRedaction.js";
import { readDeadline } from "./closeEarly.js";
import { getRenderedLinks } from "./processLinks.js";
import { baseUrl, uiBaseUrl } from "../utils/baseUrl.js";

/** The media types a caller asks for the descriptor with. */
export function wantsDescriptor(accept: string | undefined): "ld" | "activity" | null {
  const a = (accept ?? "").toLowerCase();
  if (a.includes("application/ld+json")) return "ld";
  if (a.includes("application/activity+json")) return "activity";
  return null;
}

/** The two links that make a process a follow-up of this one ("Continued by", "Implemented by"). */
const FOLLOW_UP_RELATIONS = new Set(["continues", "implements"]);

/**
 * The descriptor for this caller, or undefined when they may not read the
 * process (the same gate as its page: under review, archived, its plugin
 * off, an unpublished brief).
 */
export async function buildProcessDescriptor(
  id: string,
  caller: { audience: WireAudience; viewerId?: string },
): Promise<Record<string, unknown> | undefined> {
  const page = await getProcessState(id, {
    actor: caller.viewerId,
    audience: caller.audience === "public" ? "public" : "member",
  });
  if (!page) return undefined;
  const stored = await getProcess(id);
  if (!stored) return undefined;
  // Past its deadline and not closed by the job yet, it reads as closed.
  const process = await asRead(stored);
  const type = process.definition.type;
  const manifest = getManifest(type);

  const created = (await getEventsByProcessId(id, ["civic.process.created"])).at(-1);
  const activity = created
    ? caller.audience === "admin"
      ? toActivity(created)
      : toRedactedActivity(created, await officialActorIds([created]), caller.audience)
    : null;
  const contextIri = (activity?.context as { id?: unknown } | undefined)?.id;

  const resident = new Set(residentActionsOf(type));
  const actions = (manifest?.descriptor.actions ?? [])
    .filter((a) => resident.has(a.name))
    .map((a) => ({
      name: a.name,
      ...(a.input_schema ? { input_schema: a.input_schema } : {}),
      emits: a.emits,
    }));

  const deadline = manifest?.descriptor.deadline;
  const links = await getRenderedLinks(id, { viewerId: caller.viewerId ?? null, isAdmin: caller.audience === "admin" });
  const followUps = links.incoming
    .filter((l) => FOLLOW_UP_RELATIONS.has(l.relation) && !l.synthetic && !l.inherited)
    .map((l) => l.peer.id);

  return {
    "@context": [AS2_CONTEXT, CIVIC_CONTEXT],
    // The process IRI its activities carry as `context.id` (minted once,
    // ADR-008); the hub's own address for a process with no created activity.
    id: typeof contextIri === "string" ? contextIri : `${uiBaseUrl()}/process/${id}`,
    type: "civic:Process",
    "civic:processType": type,
    title: process.title,
    description: process.description ?? "",
    jurisdiction: process.jurisdiction,
    ...(activity?.actor !== undefined ? { created_by: activity.actor } : {}),
    status: process.status,
    ends_at: deadline ? await readDeadline(deadline.source, process) : null,
    actions,
    endpoints: {
      view: `${uiBaseUrl()}${manifest ? manifest.detailPath(id) : `/process/${id}`}`,
      action: `${baseUrl()}/process/${id}/action`,
    },
    follow_up_process_ids: followUps,
  };
}
