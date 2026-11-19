// Briefs' sample content (PluginServer.samples, kernel step 4): a published
// brief of a closed sample vote, seeded through the brief's own approve path.
// The words come from the hub's space type, in its vocabulary.
//
// Nothing leaves the building: delivery goes to a mailer that logs and sends
// nothing (sampleDeliverySuppressed), and the recipient is the space type's
// label with a `.invalid` address.

import {
  hubContext,
  links,
  results,
  sampleDeliverySuppressed,
  type PluginSamples,
  type SampleKit,
  type SampleTemplate,
} from "@civic-social/plugin-sdk";
import { approveBrief, setRecipients, type BriefProcessState } from "./api.js";
import { emitBriefAggregationCompleted } from "./events.js";

/** What a brief sample says: the result of another sample (`source`), written up. */
export interface BriefSample {
  readonly key: string;
  /** One of the kernel's sample people (SampleKit.author). */
  readonly by: string;
  /** Its source closed, days relative to the seed. */
  readonly at: number;
  /** The key of the closed sample this reports. */
  readonly source: string;
  readonly published_at: number;
  readonly headline: string;
  readonly summary: string;
  readonly sections: ReadonlyArray<{ heading: string; body: string }>;
  readonly participation_label: string;
  readonly participation_count: number;
  /** The public "Sent to" label. Delivery is never attempted. */
  readonly sent_to: string;
}

export async function seedBriefSample(template: SampleTemplate, kit: SampleKit): Promise<void> {
  const t = template as unknown as BriefSample;
  const source = await kit.process(t.source);
  if (!source) throw new Error(`sample brief ${t.key}: its source ${t.source} is missing`);
  const team = kit.author(t.by);
  const closedAt = kit.at(t.at);
  const publishedAt = kit.at(t.published_at);
  const record = await kit.create({
    title: source.title,
    description: source.description,
    state: {
      source_process_id: source.id,
      source_process_type: source.definition.type,
      content: {
        title: source.title,
        headline: kit.fill(t.headline),
        summary: kit.fill(t.summary),
        sections: t.sections.map((s) => ({ heading: kit.fill(s.heading), body: kit.fill(s.body) })),
        participation_label: kit.fill(t.participation_label),
        participation_count: t.participation_count,
        comments: [],
        admin_notes: "",
        image_url: null,
        image_alt: null,
      },
    },
  });
  const state = record.state as unknown as BriefProcessState;
  const ctxAt = (iso: string) => ({ process_id: record.id, jurisdiction: record.jurisdiction, emit: kit.emitAt(iso) });
  await emitBriefAggregationCompleted(ctxAt(kit.at(t.at, 1)), "system:brief-spawn", state);
  state.generated_at = closedAt;
  setRecipients(state, [{ email: `governing-body@${kit.hubId}.sample.invalid`, label: kit.fill(t.sent_to) }]);
  await kit.save(record);

  await approveBrief(state, team.id, ctxAt(publishedAt), {
    fallbackRecipients: [],
    hubLabel: kit.fill("{HUB_NAME}"),
    publicBriefUrl: `${hubContext().baseUrl}/brief/${record.id}`,
    sourceProcessIri: (await links.wireIris([state.source_process_id])).get(state.source_process_id) ?? null,
    // Never delivered: sample content (and a .invalid address besides).
    sendEmail: sampleDeliverySuppressed,
    // Its source's result is public, stamped at the brief's publication.
    finalizeSource: (sourceId, _sourceType, by) => results.finalize(sourceId, by, kit.emitAt(publishedAt)),
  });
  record.status = "finalized";
  state.approved_at = publishedAt;
  state.published_at = publishedAt;
  state.delivered_at = publishedAt;
  record.state = state as unknown as Record<string, unknown>;
  await kit.save(record);
}

export const briefSamples: PluginSamples = {
  seed: seedBriefSample,
  title: (t) => (t as unknown as BriefSample).headline,
};
