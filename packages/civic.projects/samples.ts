// Projects' sample content (PluginServer.samples, kernel step 4): a project
// with its supporters, comments and updates, through the project's own
// paths. The words come from the hub's space type, in its vocabulary.

import type { GrantedDb, PluginSamples, SampleKit, SampleTemplate } from "@civic-social/plugin-sdk";
import { createProject, setProjectSentiment } from "./service.js";
import { emitProjectUpdated } from "./events.js";

/** What a project sample says. */
export interface ProjectSample {
  readonly key: string;
  /** One of the kernel's sample people (SampleKit.author). */
  readonly by: string;
  /** Created, days relative to the seed. */
  readonly at: number;
  readonly title: string;
  readonly description: string;
  readonly supported_by: readonly string[];
  readonly updates: ReadonlyArray<{ body: string; at: number }>;
  readonly comments: ReadonlyArray<{ by: string; body: string; at: number }>;
}

/** Stamp a row of its own tables with its planned time. */
async function stamp(db: () => GrantedDb, table: string, match: Record<string, string>, iso: string): Promise<void> {
  let q = db().from(table).update({ created_at: iso });
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  await q;
}

export function projectSamples(db: () => GrantedDb): PluginSamples {
  return {
    async seed(template: SampleTemplate, kit: SampleKit) {
      const t = template as unknown as ProjectSample;
      const author = kit.author(t.by);
      const title = kit.fill(t.title);
      const description = kit.fill(t.description);
      const at = kit.at(t.at);
      const p = await kit.create({ title, description, content: { sources: [], assistant_helped: false } });
      await createProject({ id: p.id, title, description, user_id: author.id }, kit.emitAt(at));
      await stamp(db, "projects", { id: p.id }, at);
      let i = 0;
      for (const who of t.supported_by) {
        const u = kit.author(who);
        const iso = kit.at(t.at + 1 + i);
        await setProjectSentiment(p.id, u.id, "support", kit.emitAt(iso));
        await stamp(db, "project_sentiments", { project_id: p.id, user_id: u.id }, iso);
        i++;
      }
      for (const c of t.comments) await kit.comment(p, c, "comment");
      for (const u of t.updates) {
        const iso = kit.at(u.at);
        const updateId = await kit.comment(p, { by: t.by, body: u.body, at: u.at }, "update");
        await emitProjectUpdated({ project_id: p.id, emit: kit.emitAt(iso) }, author.id, { update_id: updateId });
      }
    },
  };
}
