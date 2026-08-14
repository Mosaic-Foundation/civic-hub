import type { CreateEventInput } from "../../models/event.js";
import { HUB_ID } from "../../config/hub.js";

export type EmitEventFn = (input: CreateEventInput) => Promise<unknown>;


interface EventContext {
  project_id: string;
  hub_id?: string;
  jurisdiction?: string;
  emit: EmitEventFn;
}

export async function emitProjectCreated(
  ctx: EventContext,
  actor: string,
  data: { title: string },
): Promise<void> {
  await ctx.emit({
    event_type: "civic.project.created",
    actor,
    process_id: ctx.project_id,
    hub_id: ctx.hub_id ?? HUB_ID,
    jurisdiction: ctx.jurisdiction ?? "local",
    processType: "civic.project",
    action_url_path: `/project/${ctx.project_id}`,
    data: { project: data },
  });
}

export async function emitProjectUpdated(
  ctx: EventContext,
  actor: string,
  data: { update_id: string },
): Promise<void> {
  await ctx.emit({
    event_type: "civic.project.updated",
    actor,
    process_id: ctx.project_id,
    hub_id: ctx.hub_id ?? HUB_ID,
    jurisdiction: ctx.jurisdiction ?? "local",
    processType: "civic.project",
    action_url_path: `/project/${ctx.project_id}`,
    data: { project: data },
  });
}

export async function emitProjectCommented(
  ctx: EventContext,
  actor: string,
  data: { comment_id: string },
): Promise<void> {
  await ctx.emit({
    event_type: "civic.project.comment_added",
    actor,
    process_id: ctx.project_id,
    hub_id: ctx.hub_id ?? HUB_ID,
    jurisdiction: ctx.jurisdiction ?? "local",
    processType: "civic.project",
    action_url_path: `/project/${ctx.project_id}`,
    data: { project: data },
  });
}

export async function emitProjectArchived(
  ctx: EventContext,
  actor: string,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.project.archived",
    actor,
    process_id: ctx.project_id,
    hub_id: ctx.hub_id ?? HUB_ID,
    jurisdiction: ctx.jurisdiction ?? "local",
    processType: "civic.project",
    action_url_path: `/project/${ctx.project_id}`,
    data: { project: {} },
  });
}

export async function emitProjectCompleted(
  ctx: EventContext,
  actor: string,
): Promise<void> {
  await ctx.emit({
    event_type: "civic.project.updated",
    actor,
    process_id: ctx.project_id,
    hub_id: ctx.hub_id ?? HUB_ID,
    jurisdiction: ctx.jurisdiction ?? "local",
    processType: "civic.project",
    action_url_path: `/project/${ctx.project_id}`,
    data: { project: { completed: true } },
  });
}

export async function emitProjectSentimentChanged(
  ctx: EventContext,
  actor: string,
  data: { sentiment: string; support_count: number; oppose_count: number },
): Promise<void> {
  await ctx.emit({
    event_type: "civic.project.sentiment_changed",
    actor,
    process_id: ctx.project_id,
    hub_id: ctx.hub_id ?? HUB_ID,
    jurisdiction: ctx.jurisdiction ?? "local",
    processType: "civic.project",
    action_url_path: `/project/${ctx.project_id}`,
    data: { project: data },
  });
}
