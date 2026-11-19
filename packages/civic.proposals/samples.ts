// Proposals' sample content (PluginServer.samples, kernel step 4): an open
// proposal with its endorsements and comments, through the proposal's own
// paths. The words come from the hub's space type, in its vocabulary.

import type { GrantedDb, PluginSamples, SampleKit, SampleTemplate } from "@civic-social/plugin-sdk";
import { createProposal, supportProposal } from "./service.js";

/** What a proposal sample says. */
export interface ProposalSample {
  readonly key: string;
  /** One of the kernel's sample people (SampleKit.author). */
  readonly by: string;
  /** Created, days relative to the seed. */
  readonly at: number;
  readonly title: string;
  readonly description: string;
  readonly closes_at: number;
  readonly endorsed_by: readonly string[];
  readonly comments: ReadonlyArray<{ by: string; body: string; at: number }>;
}

/** Stamp a row of its own tables with its planned time. */
async function stamp(db: () => GrantedDb, table: string, match: Record<string, string>, iso: string): Promise<void> {
  let q = db().from(table).update({ created_at: iso });
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  await q;
}

export function proposalSamples(db: () => GrantedDb): PluginSamples {
  return {
    async seed(template: SampleTemplate, kit: SampleKit) {
      const t = template as unknown as ProposalSample;
      const author = kit.author(t.by);
      const title = kit.fill(t.title);
      const description = kit.fill(t.description);
      const at = kit.at(t.at);
      const p = await kit.create({
        title,
        description,
        content: { category: "idea", optional_links: [], assistant_helped: false },
      });
      await createProposal(
        { id: p.id, title, description, submitted_by: author.id, category: "idea", assistant_helped: false, closes_at: kit.at(t.closes_at) },
        kit.emitAt(at),
      );
      await stamp(db, "proposals", { id: p.id }, at);
      let i = 0;
      for (const who of t.endorsed_by) {
        const u = kit.author(who);
        const iso = kit.at(t.at, 30 + i * 90);
        await supportProposal(p.id, u.id, kit.emitAt(iso));
        await stamp(db, "proposal_supports", { proposal_id: p.id, user_id: u.id }, iso);
        i++;
      }
      for (const c of t.comments) await kit.comment(p, c, "comment");
    },
    refresh: {
      // An open proposal is there to be endorsed.
      live: () => true,
      async reason(_t, row, window) {
        if (row.status !== "active") return `no longer open (${row.status})`;
        // A proposal keeps its window in its own table.
        const own = await db().from("proposals").select<{ closes_at: string | null }>("closes_at").eq("id", row.id).maybeSingle();
        return window.near(own?.closes_at ?? null) ? "closes within the refresh window" : null;
      },
    },
  };
}
