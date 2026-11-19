// Announcements' sample content (PluginServer.samples, kernel step 4): a
// published announcement, the hand-authored path without its publication
// receipt (there is no human author to warn). The words come from the hub's
// space type, in its vocabulary.

import type { PluginSamples, SampleKit, SampleTemplate } from "@civic-social/plugin-sdk";
import type { AnnouncementProcessState } from "./models.js";
import { emitAnnouncementResultPublished } from "./events.js";

/** What an announcement sample says. */
export interface AnnouncementSample {
  readonly key: string;
  /** One of the kernel's sample people (SampleKit.author). */
  readonly by: string;
  /** Published, days relative to the seed. */
  readonly at: number;
  readonly title: string;
  readonly body: string;
}

export async function seedAnnouncementSample(template: SampleTemplate, kit: SampleKit): Promise<void> {
  const t = template as unknown as AnnouncementSample;
  const author = kit.author(t.by);
  const title = kit.fill(t.title);
  const body = kit.fill(t.body);
  const record = await kit.create({
    title,
    description: body,
    state: {
      title,
      body,
      author_id: author.id,
      author_role: "Admin",
      official_type: null,
      author_display_name: author.name,
      links: [],
      image_url: null,
      image_alt: null,
    },
  });
  const state = record.state as unknown as AnnouncementProcessState;
  await emitAnnouncementResultPublished(
    { process_id: record.id, jurisdiction: record.jurisdiction, emit: kit.emitAt(kit.at(t.at, 1)) },
    author.id,
    state,
    { timestamp: kit.at(t.at, 1) },
  );
  record.status = "finalized";
  await kit.save(record);
}

export const announcementSamples: PluginSamples = { seed: seedAnnouncementSample };
