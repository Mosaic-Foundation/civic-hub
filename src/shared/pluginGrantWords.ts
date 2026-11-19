// The words the Install confirmation uses for a grant (src/shared/pluginGrant.ts),
// written for the person who installs a plugin on a hub: a clerk or a
// volunteer, not an engineer. Shared with the UI; imports nothing.

/** Each grantable adapter: what having it lets a plugin do, and what lacking it means. */
export const ADAPTER_PLAIN: Readonly<Record<
  "ai" | "mail" | "video" | "deliberation" | "objectStore" | "web",
  { can: string; cannot?: string; outside?: true }
>> = {
  ai: {
    can: "Use the hub's AI service. Each use counts against the hub's daily AI allowance.",
    cannot: "Use AI.",
    outside: true,
  },
  mail: {
    can: "Send email from the hub, following the hub's own rules on who may be emailed, including notices to this hub's admins.",
    cannot: "Send email.",
  },
  video: {
    can: "Fetch the transcripts of public meeting videos.",
    outside: true,
  },
  deliberation: {
    can: "Pass residents' conversation statements and agree/disagree votes to the conversation service the hub uses (Polis), under a reference number rather than a name.",
    outside: true,
  },
  objectStore: {
    can: "Store files on the hub.",
  },
  web: {
    can: "Read the public web pages it is set up to follow, such as the government's meeting calendar and its agendas.",
    outside: true,
  },
};

/**
 * The plain phrase for one event type, completing "when …": the plugin's own
 * words (its manifest's eventWords), else the kernel's for the shared ones.
 */
export function eventPlain(eventType: string, own: Readonly<Record<string, string>> = {}): string {
  return own[eventType] ?? EVENT_PLAIN[eventType] ?? humanize(eventType);
}

/** The shared event types every process may emit; a plugin words its own (eventWords). */
const EVENT_PLAIN: Readonly<Record<string, string>> = {
  "civic.process.proposed": "one is proposed",
  "civic.process.threshold_met": "one has enough support",
  "civic.process.started": "one opens",
  "civic.process.ended": "one closes",
  "civic.process.vote_submitted": "a ballot is cast (never who voted for what)",
  "civic.process.submission_received": "an answer comes in",
  "civic.process.aggregation_completed": "results are counted",
  "civic.process.result_published": "it publishes a result or a post",
  "civic.process.outcome_recorded": "an outcome is recorded",
  "civic.process.action_taken": "someone responds to it",
};

function humanize(eventType: string): string {
  const verb = eventType.split(".").pop() ?? eventType;
  return `it records "${verb.replace(/_/g, " ")}"`;
}
