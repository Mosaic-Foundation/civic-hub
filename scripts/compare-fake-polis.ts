// Compare the in-memory Polis (src/debug/fakePolis.ts) with a real Polis, by
// hand. Never scheduled; Adam runs it when the fake's fidelity is in doubt
// (Polis upgraded, a conformance result that real Polis contradicts).
//
// It runs the same sequence through the hub's real adapter twice, once
// against the fake and once against the Polis at POLIS_URL with
// POLIS_AUTH_TOKEN, and prints, per Polis endpoint, the response fields one
// side has and the other lacks (shapes only, never values). The sequence
// creates one throwaway conversation on the real Polis, posts a statement and
// a vote from a made-up participant, reads it back and closes it. So it needs
// --create-on-real to run.
//
//   cd civic-hub && POLIS_URL=https://polis.civic.social POLIS_AUTH_TOKEN=… \
//     npx tsx scripts/compare-fake-polis.ts --create-on-real

import { createPolisAdapter } from "../src/shared/polis_deliberation/adapter/polisAdapter.js";
import type { PolisAdapterConfig } from "../src/shared/polis_deliberation/adapter/types.js";
import { FAKE_POLIS_BASE_URL, fakePolisFetch } from "../src/debug/fakePolis.js";

type Fetch = NonNullable<PolisAdapterConfig["fetch"]>;

/** The field paths of a JSON value: "a", "a.b", "a[].c". */
function shape(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.length ? shape(value[0], `${prefix}[]`) : [`${prefix}[]`];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [`${prefix}${prefix ? "." : ""}${k}`, ...shape(v, `${prefix}${prefix ? "." : ""}${k}`)]);
  }
  return [];
}

/** A fetch that records each response's shape by endpoint. */
function recording(inner: Fetch, into: Map<string, Set<string>>): Fetch {
  return async (url, init) => {
    const res = await inner(url, init);
    const text = await res.clone().text();
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    try {
      into.set(key, new Set(shape(JSON.parse(text))));
    } catch {
      into.set(key, new Set([`(not JSON, status ${res.status})`]));
    }
    return res;
  };
}

async function sequence(baseUrl: string, authToken: string, fetch: Fetch): Promise<void> {
  const adapter = createPolisAdapter({ baseUrl, authToken, fetch });
  const xid = `compare-${Date.now().toString(36)}`;
  const { conversation_id } = await adapter.createDeliberation({
    topic: "Fake Polis comparison (throwaway)",
    description: "Created by scripts/compare-fake-polis.ts and closed at once.",
    strict_moderation: false,
  });
  const { statement_id } = await adapter.submitStatement(conversation_id, xid, `A statement ${xid}`);
  await adapter.recordVote(conversation_id, xid, statement_id, "agree");
  await adapter.getNextStatement(conversation_id, xid);
  await adapter.getStatements(conversation_id);
  await adapter.pullClusterState(conversation_id);
  await adapter.closeDeliberation(conversation_id);
}

async function main(): Promise<void> {
  const realUrl = process.env.POLIS_URL?.trim();
  const token = process.env.POLIS_AUTH_TOKEN?.trim();
  if (!process.argv.includes("--create-on-real") || !realUrl || !token) {
    console.error("Needs POLIS_URL, POLIS_AUTH_TOKEN and --create-on-real (it creates and closes one conversation there).");
    process.exit(2);
  }
  const fake = new Map<string, Set<string>>();
  const real = new Map<string, Set<string>>();
  await sequence(FAKE_POLIS_BASE_URL, "fake-polis-service-token", recording(fakePolisFetch, fake));
  await sequence(realUrl, token, recording((url, init) => fetch(url, init), real));

  let differences = 0;
  for (const endpoint of [...new Set([...fake.keys(), ...real.keys()])].sort()) {
    const f = fake.get(endpoint) ?? new Set<string>();
    const r = real.get(endpoint) ?? new Set<string>();
    const onlyReal = [...r].filter((k) => !f.has(k));
    const onlyFake = [...f].filter((k) => !r.has(k));
    if (onlyReal.length === 0 && onlyFake.length === 0) {
      console.log(`same    ${endpoint}`);
      continue;
    }
    differences++;
    console.log(`differs ${endpoint}`);
    if (onlyReal.length) console.log(`   real Polis only: ${onlyReal.join(", ")}`);
    if (onlyFake.length) console.log(`   fake only:       ${onlyFake.join(", ")}`);
  }
  console.log(differences === 0 ? "\nThe fake answers in the same shapes." : `\n${differences} endpoint(s) differ.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
