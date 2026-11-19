// Conversations' sample content (PluginServer.samples, kernel step 4): an
// active conversation, without Polis. The conversation is served by the
// `seed-` mock layer (./mocks.ts) under `seed-sample-<key>`, which reads the
// same template: its statements and its participation picture. The words
// come from the hub's space type, in its vocabulary.

import { samples, settingsOf, type PluginSamples, type SampleKit, type SampleTemplate } from "@civic-social/plugin-sdk";
import { conversationHost } from "./host.js";

/** The prefix the mock layer serves a sample conversation under. */
export const SAMPLE_CONVERSATION_PREFIX = "seed-sample-";

/** What a conversation sample says. */
export interface ConversationSample {
  readonly key: string;
  /** One of the kernel's sample people (SampleKit.author). */
  readonly by: string;
  /** Started, days relative to the seed. */
  readonly at: number;
  readonly topic: string;
  readonly framing: string;
  readonly closes_at: number;
  /** Shown through the seed- mock layer; nothing is sent to Polis. */
  readonly statements: readonly string[];
  /**
   * The participation picture the mock layer serves. Statement references are
   * indexes into `statements`.
   */
  readonly picture: {
    readonly participants: number;
    readonly groups: ReadonlyArray<{ size: number; agree: readonly number[]; disagree: readonly number[] }>;
    readonly consensus: ReadonlyArray<{ statement: number; agree_rate: number; votes: number }>;
  };
}

const TYPE = "civic.polis_deliberation";
const DAY = 24 * 60 * 60 * 1000;

/** The conversation sample with this key, as written, or null (the mock layer). */
export function conversationSample(key: string): ConversationSample | null {
  const t = samples.template(key);
  return t && t.type === TYPE ? (t as unknown as ConversationSample) : null;
}

export async function seedConversationSample(template: SampleTemplate, kit: SampleKit): Promise<void> {
  const t = template as unknown as ConversationSample;
  const author = kit.author(t.by);
  const topic = kit.fill(t.topic);
  const framing = kit.fill(t.framing);
  const p = await kit.create({
    version: "1.0",
    title: topic,
    description: framing,
    state: {
      topic,
      framing,
      seed_statements: t.statements.map((s) => kit.fill(s)),
      duration_ms: (t.closes_at - t.at) * DAY,
    },
  });
  // What the start action does, minus Polis: the mock layer serves it.
  const conversationId = `${SAMPLE_CONVERSATION_PREFIX}${t.key}`;
  const polisUrl = conversationHost.get().adapter("deliberation").baseUrl(settingsOf("conversation").get("polis_url")).replace(/\/+$/, "");
  const st = p.state as Record<string, unknown>;
  st.polis_conversation_id = conversationId;
  st.polis_base_url = `${polisUrl}/${conversationId}`;
  st.deadline = kit.at(t.closes_at);
  p.status = "active";
  await kit.save(p);
  await kit.emitAt(kit.at(t.at, 1))({
    event_type: "civic.process.started",
    actor: author.id,
    process_id: p.id,
    jurisdiction: p.jurisdiction,
    processType: TYPE,
    data: { process_id: p.id, process_type: TYPE, polis_conversation_id: conversationId, topic },
  });
}

export const conversationSamples: PluginSamples = {
  seed: seedConversationSample,
  title: (t) => (t as unknown as ConversationSample).topic,
  refresh: {
    // An active conversation is there to take part in.
    live: () => true,
    async reason(_t, row, window) {
      if (row.status !== "active") return `no longer active (${row.status})`;
      return window.near(row.state?.deadline) ? "ends within the refresh window" : null;
    },
  },
};
