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
import { getManifest, getProcessHandler, residentActionsOf } from "../processes/registry.js";
import { getEventsByProcessId } from "../events/eventStore.js";
import { AS2_CONTEXT, CIVIC_CONTEXT, toActivity } from "../events/activitySerializer.js";
import { officialActorIds, toRedactedActivity, type WireAudience } from "../events/publicRedaction.js";
import { disclosureOfEvent } from "../events/publicPayload.js";
import { readDeadline } from "./closeEarly.js";
import { getBriefLinks, getRenderedLinks, processWireIris } from "./processLinks.js";
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
  // Follow-ups (process spec §11.3): processes that continue or implement this
  // one, plus its published brief — the result process, reachable from its
  // source (Adam, 2026-10-21, Architecture 3). The brief pair is synthetic
  // (derived from the brief's own source_process_id), so it is taken from
  // getBriefLinks rather than the stored edges. Served as IRIs, each minted on
  // the hostname the follow-up's row froze (ADR-008).
  const viewer = { viewerId: caller.viewerId ?? null, isAdmin: caller.audience === "admin" };
  const [links, briefLinks] = await Promise.all([
    getRenderedLinks(id, viewer),
    getBriefLinks(id, viewer),
  ]);
  const followUpIds = [
    ...links.incoming
      .filter((l) => FOLLOW_UP_RELATIONS.has(l.relation) && !l.synthetic && !l.inherited)
      .map((l) => l.peer.id),
    ...briefLinks.incoming.map((l) => l.peer.id),
  ];
  const followUpIris = await processWireIris(followUpIds);
  const followUps = followUpIds.map(
    (fid) => followUpIris.get(fid) ?? `${uiBaseUrl()}/process/${fid}`,
  );

  // Aggregate participation: a count and nothing else, live while the
  // process runs, final at close, so turnout is public while every ballot
  // and submission stays restricted (Architecture 3, ADR-010; Adam,
  // 2026-10-21, Q4). Types without the hook carry no participation block.
  const count = await getProcessHandler(type)?.participationCount?.(process);

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
    // The declared disclosure policy (§12.1; spec §5.3 wants it declared
    // before participation begins): the type's default, or this process's
    // own where the type allows an override (Architecture 3, ADR-010).
    disclosure_policy: disclosureOfEvent(
      { data: { process: { type } } },
      typeof process.state?.disclosure_policy === "string" ? process.state.disclosure_policy : null,
    ),
    ...(typeof count === "number" ? { participation: { count } } : {}),
    actions,
    endpoints: {
      view: `${uiBaseUrl()}${manifest ? manifest.detailPath(id) : `/process/${id}`}`,
      action: `${baseUrl()}/process/${id}/action`,
    },
    follow_up_process_ids: followUps,
  };
}
