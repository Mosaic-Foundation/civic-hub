/**
 * Test flow script — validates the full civic hub lifecycle:
 *   1. Create a civic.vote process (starts in draft)
 *   2. Activate the vote
 *   3. Submit votes
 *   4. Close the vote
 *   5. Finalize the vote
 *   6. Fetch and verify events against Civic Event Spec v0.1
 *   7. Test proposal lifecycle (draft → proposed → support → threshold → active)
 *   8. Test community input
 *
 * Run: npm run test:flow  (server must be running on port 3000)
 */

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

async function request(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

function log(label: string, obj: unknown) {
  console.log(`\n━━━ ${label} ━━━`);
  console.log(JSON.stringify(obj, null, 2));
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

async function run() {
  console.log("🏛️  Civic Hub — Test Flow\n");
  console.log(`Target: ${BASE}`);

  // 1. Health check
  console.log("\n── Step 1: Health check ──");
  const health = await request("GET", "/health");
  assert(health.status === 200, "Health check returns 200");

  // 2. Create a vote process
  console.log("\n── Step 2: Create civic.vote process ──");
  const createRes = await request("POST", "/process", {
    definition: { type: "civic.vote", version: "0.1" },
    title: "Test Vote: Park Improvements",
    description: "Should we add benches to the park?",
    createdBy: "user:testrunner",
    jurisdiction: "us-va-floyd",
    state: { options: ["yes", "no", "abstain"] },
  });
  assert(createRes.status === 201, "Process created with 201");
  assert(createRes.data.id !== undefined, "Process has an ID");
  assert(createRes.data.status === "draft", "Process status is draft");
  assert(createRes.data.jurisdiction === "us-va-floyd", "Process has jurisdiction");

  const processId = createRes.data.id;
  log("Created Process", createRes.data);

  // 2b. Cannot vote on a draft process
  console.log("\n── Step 2b: Validate draft process guards ──");
  const earlyVote = await request("POST", `/process/${processId}/action`, {
    type: "process.vote",
    actor: "user:alice",
    payload: { option: "yes" },
  });
  assert(earlyVote.status === 400, "Cannot vote on draft process");

  // 3. Activate the vote
  console.log("\n── Step 3: Activate vote ──");
  const activateRes = await request("POST", `/process/${processId}/action`, {
    type: "process.activate",
    actor: "user:testrunner",
    payload: {},
  });
  assert(activateRes.status === 200, "Vote activated");
  assert(activateRes.data.process.status === "active", "Process status is active");

  // 4. Submit votes
  console.log("\n── Step 4: Submit votes ──");
  const votes = [
    { actor: "user:alice", option: "yes" },
    { actor: "user:bob", option: "no" },
    { actor: "user:carol", option: "yes" },
  ];

  for (const v of votes) {
    const voteRes = await request("POST", `/process/${processId}/action`, {
      type: "process.vote",
      actor: v.actor,
      payload: { option: v.option },
    });
    assert(voteRes.status === 200, `${v.actor} voted ${v.option}`);
  }

  // 5. Get process state
  console.log("\n── Step 5: Get process state ──");
  const getRes = await request("GET", `/process/${processId}`);
  assert(getRes.status === 200, "Process retrieved");
  assert(getRes.data.state.type === "civic.vote", "state.type is civic.vote");
  assert(getRes.data.state.status === "active", "state.status is active");
  log("Process State", getRes.data);

  // 6. Close the vote
  console.log("\n── Step 6: Close vote ──");
  const closeRes = await request("POST", `/process/${processId}/action`, {
    type: "process.close",
    actor: "user:testrunner",
    payload: {},
  });
  assert(closeRes.status === 200, "Vote closed");
  assert(closeRes.data.process.status === "closed", "Process status is closed");
  assert(typeof closeRes.data.result.total_votes === "number", "Result uses snake_case total_votes");
  log("Tally", closeRes.data.result);

  // 6b. Validate: cannot vote on closed process
  console.log("\n── Step 6b: Validate closed process guards ──");
  const lateVote = await request("POST", `/process/${processId}/action`, {
    type: "process.vote",
    actor: "user:dave",
    payload: { option: "yes" },
  });
  assert(lateVote.status === 400, "Voting on closed process returns 400");

  const doubleClose = await request("POST", `/process/${processId}/action`, {
    type: "process.close",
    actor: "user:testrunner",
    payload: {},
  });
  assert(doubleClose.status === 400, "Closing already-closed process returns 400");

  // 7. Finalize the vote
  console.log("\n── Step 7: Finalize vote ──");
  const finalizeRes = await request("POST", `/process/${processId}/action`, {
    type: "process.finalize",
    actor: "user:testrunner",
    payload: {},
  });
  assert(finalizeRes.status === 200, "Vote finalized");
  assert(finalizeRes.data.process.status === "finalized", "Process status is finalized");
  assert(typeof finalizeRes.data.result.computed_at === "string", "Result has computed_at");

  // 7b. Cannot act on finalized process
  const postFinalizeVote = await request("POST", `/process/${processId}/action`, {
    type: "process.vote",
    actor: "user:dave",
    payload: { option: "yes" },
  });
  assert(postFinalizeVote.status === 400, "Cannot act on finalized process");

  // 8. Fetch all events
  console.log("\n── Step 8: Fetch all events ──");
  const eventsRes = await request("GET", "/feed");
  assert(eventsRes.status === 200, "Events retrieved");
  assert(eventsRes.data.count >= 7, `Got ${eventsRes.data.count} events (expected ≥7)`);

  // 9. Verify event structure — Civic Event Spec v0.1 compliance
  console.log("\n── Step 9: Verify event structure (Civic Event Spec v0.1) ──");
  const latestEvent = eventsRes.data.events[eventsRes.data.events.length - 1];
  assert(typeof latestEvent.id === "string", "Event has id");
  assert(typeof latestEvent.version === "string", "Event has version");
  assert(latestEvent.version === "1.0", "Event version is 1.0");
  assert(typeof latestEvent.event_type === "string", "Event has event_type");
  assert(typeof latestEvent.timestamp === "string", "Event has timestamp");
  assert(typeof latestEvent.process_id === "string", "Event has process_id");
  assert(typeof latestEvent.actor === "string", "Event has actor (flat string)");
  assert(typeof latestEvent.jurisdiction === "string", "Event has jurisdiction");
  assert(typeof latestEvent.action_url === "string", "Event has action_url");
  assert(typeof latestEvent.source?.hub_id === "string", "Event has source.hub_id");
  assert(typeof latestEvent.source?.hub_url === "string", "Event has source.hub_url");
  assert(typeof latestEvent.data === "object", "Event has data object");
  assert(latestEvent.meta?.visibility === "public", "Event has meta.visibility");

  // 9b. Verify canonical event types
  console.log("\n── Step 9b: Verify canonical event types ──");
  const eventTypes = eventsRes.data.events.map((e: any) => e.event_type);
  assert(eventTypes.includes("civic.process.created"), "Has civic.process.created event");
  assert(eventTypes.includes("civic.process.started"), "Has civic.process.started event");
  assert(eventTypes.includes("civic.process.vote_submitted"), "Has civic.process.vote_submitted event");
  assert(eventTypes.includes("civic.process.ended"), "Has civic.process.ended event");
  assert(eventTypes.includes("civic.process.updated"), "Has civic.process.updated event");
  assert(eventTypes.includes("civic.process.result_published"), "Has civic.process.result_published event");

  // 9c. Verify data payloads follow spec namespacing (filter to our process)
  console.log("\n── Step 9c: Verify data payloads ──");
  const processEvents = eventsRes.data.events.filter((e: any) => e.process_id === processId);
  const createdEvt = processEvents.find((e: any) => e.event_type === "civic.process.created");
  assert(createdEvt.data.process?.type === "civic.vote", "civic.process.created data has process.type");
  assert(typeof createdEvt.data.process?.title === "string", "civic.process.created data has process.title");
  assert(createdEvt.jurisdiction === "us-va-floyd", "civic.process.created has correct jurisdiction");

  const startedEvt = processEvents.find((e: any) => e.event_type === "civic.process.started");
  assert(typeof startedEvt.data.process?.voting_opens_at === "string", "started event has voting_opens_at");
  assert(typeof startedEvt.data.process?.voting_closes_at === "string", "started event has voting_closes_at");

  const submittedEvt = processEvents.find((e: any) => e.event_type === "civic.process.vote_submitted");
  assert(typeof submittedEvt.data.vote?.option === "string", "vote_submitted data has vote.option");
  assert("previous_vote" in submittedEvt.data.vote, "vote_submitted data has vote.previous_vote");

  const endedEvt = processEvents.find((e: any) => e.event_type === "civic.process.ended");
  assert(typeof endedEvt.data.result?.tally === "object", "civic.process.ended data has result.tally");
  assert(typeof endedEvt.data.result?.total_votes === "number", "civic.process.ended data has result.total_votes");

  const publishedEvt = processEvents.find((e: any) => e.event_type === "civic.process.result_published");
  assert(typeof publishedEvt.data.result?.tally === "object", "result_published data has result.tally");
  assert(typeof publishedEvt.data.result?.computed_at === "string", "result_published data has computed_at");

  const updatedEvt = processEvents.find((e: any) => e.event_type === "civic.process.updated");
  assert(updatedEvt !== undefined, "Has civic.process.updated event");

  log("Sample Event (civic.process.created)", createdEvt);
  log("Sample Event (civic.process.started)", startedEvt);
  log("Sample Event (civic.process.vote_submitted)", submittedEvt);

  // 10. Filter events by process
  console.log("\n── Step 10: Filter events by process_id ──");
  const filteredRes = await request("GET", `/feed?process_id=${processId}`);
  assert(filteredRes.status === 200, "Filtered events retrieved");
  assert(filteredRes.data.count >= 7, `Filtered: ${filteredRes.data.count} events for this process`);

  // 10b. Filter events by event_type
  console.log("\n── Step 10b: Filter events by event_type ──");
  const typeFilterRes = await request("GET", "/feed?event_type=civic.process.vote_submitted");
  assert(typeFilterRes.status === 200, "Type-filtered events retrieved");
  assert(typeFilterRes.data.count >= 3, `Got ${typeFilterRes.data.count} vote_submitted events (expected ≥3)`);

  // 10c. Combine filters
  console.log("\n── Step 10c: Combine filters ──");
  const comboRes = await request("GET", `/feed?process_id=${processId}&event_type=civic.process.ended`);
  assert(comboRes.status === 200, "Combined filter works");
  assert(comboRes.data.count === 1, `Got ${comboRes.data.count} ended events for this process (expected 1)`);

  // 11. Discovery manifest
  console.log("\n── Step 11: Discovery manifest ──");
  const manifestRes = await request("GET", "/.well-known/civic.json");
  assert(manifestRes.status === 200, "Manifest retrieved");
  assert(Array.isArray(manifestRes.data.feeds), "Manifest has a feeds array");
  assert(typeof manifestRes.data.space?.id === "string", "Manifest has space.id (the space DID)");

  // ═══ Phase 2: Proposal lifecycle via civic.vote ═══

  console.log("\n\n═══ Phase 2: Proposal lifecycle (civic.vote) ═══");

  // 12. Create a vote with proposal lifecycle
  console.log("\n── Step 12: Create civic.vote with proposal lifecycle ──");
  const proposalCreateRes = await request("POST", "/process", {
    definition: { type: "civic.vote", version: "0.1" },
    title: "Test Proposal: New Dog Park",
    description: "Should we build a dog park?",
    createdBy: "user:testrunner",
    jurisdiction: "us-va-floyd",
    state: {
      options: ["yes", "no"],
      support_threshold: 2,
      activation_mode: "proposal_required",
    },
  });
  assert(proposalCreateRes.status === 201, "Proposal-vote created");
  assert(proposalCreateRes.data.status === "draft", "Starts in draft");
  const proposalId = proposalCreateRes.data.id;

  // 13. Propose it
  console.log("\n── Step 13: Propose ──");
  const proposeRes = await request("POST", `/process/${proposalId}/action`, {
    type: "process.propose",
    actor: "user:testrunner",
    payload: {},
  });
  assert(proposeRes.status === 200, "Proposed successfully");
  assert(proposeRes.data.process.status === "proposed", "Status is proposed");

  // 14. Support it
  console.log("\n── Step 14: Support ──");
  const support1 = await request("POST", `/process/${proposalId}/action`, {
    type: "process.support",
    actor: "user:alice",
    payload: {},
  });
  assert(support1.status === 200, "First supporter added");

  // Can't double-support
  const doubleSup = await request("POST", `/process/${proposalId}/action`, {
    type: "process.support",
    actor: "user:alice",
    payload: {},
  });
  assert(doubleSup.status === 400, "Cannot double-support");

  // Second supporter hits threshold → auto-activates
  const support2 = await request("POST", `/process/${proposalId}/action`, {
    type: "process.support",
    actor: "user:bob",
    payload: {},
  });
  assert(support2.status === 200, "Second supporter → threshold met → auto-activated");
  assert(support2.data.process.status === "active", "Status is active after auto-activation");

  // 15. Vote on the activated process
  console.log("\n── Step 15: Vote on proposal-activated process ──");
  const pVote = await request("POST", `/process/${proposalId}/action`, {
    type: "process.vote",
    actor: "user:carol",
    payload: { option: "yes" },
  });
  assert(pVote.status === 200, "Vote submitted on proposal-activated process");

  // 16. Verify events for proposal lifecycle
  console.log("\n── Step 16: Verify proposal lifecycle events ──");
  const propEvents = await request("GET", `/feed?process_id=${proposalId}`);
  const propEventTypes = propEvents.data.events.map((e: any) => e.event_type);
  assert(propEventTypes.includes("civic.process.created"), "Has created event");
  assert(propEventTypes.includes("civic.process.proposed"), "Has proposed event");
  assert(propEventTypes.includes("civic.process.threshold_met"), "Has threshold_met event");
  assert(propEventTypes.includes("civic.process.started"), "Has started event");
  assert(propEventTypes.includes("civic.process.vote_submitted"), "Has vote_submitted event");

  // ═══ Phase 3: Community input ═══

  console.log("\n\n═══ Phase 3: Community input ═══");

  // 17. Submit community input
  console.log("\n── Step 17: Submit community input ──");
  const inputRes = await request("POST", `/process/${proposalId}/input`, {
    author_id: "user:dave",
    body: "I think a dog park would be amazing for families!",
  });
  assert(inputRes.status === 201, "Input submitted");
  assert(inputRes.data.process_id === proposalId, "Input has correct process_id");
  assert(inputRes.data.author_id === "user:dave", "Input has correct author_id");

  // 18. Get inputs
  console.log("\n── Step 18: Get community inputs ──");
  const inputsRes = await request("GET", `/process/${proposalId}/input`);
  assert(inputsRes.status === 200, "Inputs retrieved");
  assert(inputsRes.data.length === 1, "One input submitted");
  assert(inputsRes.data[0].body === "I think a dog park would be amazing for families!", "Input body preserved");

  // 19. Empty body rejected
  const emptyInput = await request("POST", `/process/${proposalId}/input`, {
    author_id: "user:eve",
    body: "",
  });
  assert(emptyInput.status === 400, "Empty input rejected");

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ All tests passed!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

run().catch((err) => {
  console.error("\n❌ Test flow failed:", err.message);
  process.exit(1);
});
