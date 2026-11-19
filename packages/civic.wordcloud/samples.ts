// Word clouds' sample content (PluginServer.samples, kernel step 3): the
// first plugin to seed its own samples (every type does since step 4). The hub's space type brings the
// template (the Civic Hub's: a title, a prompt, and each word with how many
// sample answers give it); this seeds it through the type's own paths.

import { generateId, type SampleKit, type SampleTemplate } from "@civic-social/plugin-sdk";
import { activateWordcloud, type WordcloudProcessState } from "./service.js";
import { wordcloudStore } from "./store.js";

/** What a word cloud sample says. */
export interface WordcloudSample {
  title: string;
  description: string;
  prompt: string;
  /** Each word and how many sample answers give it. */
  answers: ReadonlyArray<readonly [word: string, count: number]>;
}

/** Answers spread over the days since `opens`, interleaved so the words do not arrive one kind at a time. Pure. */
export function sampleAnswerTimes(count: number, opens: number, until: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    new Date(opens + ((until - opens) * (((i * 7) % count) + 1)) / (count + 1)).toISOString(),
  );
}

export async function seedWordcloudSample(template: SampleTemplate, kit: SampleKit): Promise<void> {
  const t = template as unknown as WordcloudSample;
  const team = kit.author(template.by ?? "TEAM");
  const p = await kit.create({
    title: kit.fill(t.title),
    description: kit.fill(t.description),
    state: { prompts: [{ id: "p1", text: kit.fill(t.prompt) }], lifecycle_mode: "evergreen" },
  });
  let st = p.state as unknown as WordcloudProcessState;
  const opens = kit.at(template.at ?? 0, 1);
  ({ state: st } = await activateWordcloud(st, team.id, { process_id: p.id, jurisdiction: p.jurisdiction, emit: kit.emitAt(opens) }));
  p.status = st.status;
  p.state = st as unknown as Record<string, unknown>;
  await kit.save(p);

  // Anonymous answers, spread over the days since it opened: rows, not
  // events, like the sample ballots.
  const words = t.answers.flatMap(([word, n]) => Array.from({ length: n }, () => word));
  const times = sampleAnswerTimes(words.length, new Date(opens).getTime(), kit.now.getTime() - 60_000);
  await wordcloudStore.get().insertSamples(
    words.map((body, i) => ({
      id: generateId("wcsub"),
      process_id: p.id,
      prompt_id: "p1",
      author_id: null,
      body,
      device_token: null,
      submitted_at: times[i]!,
    })),
  );

  // The hub's word cloud (the banner, and where a new account lands), when it
  // has none and Word clouds is switched on: a new account would otherwise be
  // sent to a page that answers "not found". Removing the samples clears it.
  await kit.adoptSetting("plugin.wordcloud.onboarding_id", p.id);
}
