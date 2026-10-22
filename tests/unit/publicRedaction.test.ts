/**
 * Public-wire redaction — resident anonymity on GET /events, GET
 * /activities/:id and GET /api/feed for UNAUTHENTICATED callers.
 *
 * The contract under test:
 *   - a resident actor never reaches the public wire as a raw user id or
 *     a stable global IRI — only as a per-process opaque token that is
 *     UNLINKABLE across processes (the fingerprint guardrail);
 *   - officials, system actors and DIDs pass through unchanged;
 *   - name-shaped payload fields are scrubbed, with announcements
 *     getting the hub's institutional byline;
 *   - the default (member/admin) serialization is byte-identical to the
 *     pre-feature output — enforced by the golden tests next door, and
 *     spot-checked here.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { CivicEvent } from "../../src/models/event.js";
import { toActivity } from "../../src/events/activitySerializer.js";
import {
  anonymousActorToken,
  isParticipantActor,
  participantUserId,
  redactEvent,
  redactEventForPublic,
  scrubAccountIds,
  scrubPayloadForPublic,
  toPublicActivity,
  toRedactedActivity,
} from "../../src/events/publicRedaction.js";

const ENV = {
  BASE_URL: "https://hub.floyd.example",
  CIVIC_UI_BASE_URL: "https://app.floyd.example",
  CIVIC_SPACE_DID: "did:web:hub.floyd.example",
  HUB_NAME: "Floyd Civic Hub",
  CIVIC_JURISDICTION: "us-va-floyd",
  CIVIC_JURISDICTION_NAME: "Floyd County, Virginia",
  CIVIC_ANON_SECRET: "test-secret-not-a-real-one",
};
const SAVED: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    SAVED[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function event(over: Partial<CivicEvent> = {}): CivicEvent {
  return {
    id: "evt_test_1",
    version: "0.1",
    event_type: "civic.process.comment_added",
    timestamp: "2026-08-30T12:00:00Z",
    process_id: "proc_alpha",
    actor: "user_dana",
    jurisdiction: "us-va-floyd",
    action_url: "https://app.floyd.example/process/proc_alpha",
    source: { hub_id: "hub_test", hub_url: "https://hub.floyd.example" },
    data: { comment: { body_preview: "I support this." } },
    meta: { visibility: "public" },
    ...over,
  } as CivicEvent;
}

const NO_OFFICIALS = new Set<string>();

describe("actor classification", () => {
  it("participants are user ids; machinery and DIDs are not", () => {
    expect(isParticipantActor("user_dana")).toBe(true);
    expect(isParticipantActor("user:legacy_1")).toBe(true);
    expect(isParticipantActor("system:brief-spawn")).toBe(false);
    expect(isParticipantActor("system")).toBe(false);
    expect(isParticipantActor("did:web:someone.example")).toBe(false);
    expect(isParticipantActor("anonymous")).toBe(false);
    expect(isParticipantActor("")).toBe(false);
    expect(isParticipantActor(undefined)).toBe(false);
  });

  it("strips the legacy user: prefix", () => {
    expect(participantUserId("user:abc")).toBe("abc");
    expect(participantUserId("user_abc")).toBe("user_abc");
  });
});

describe("anonymousActorToken — per-process, unlinkable, safe degrade", () => {
  it("is stable for the same user within the same process", () => {
    expect(anonymousActorToken("user_dana", "proc_alpha")).toBe(
      anonymousActorToken("user_dana", "proc_alpha"),
    );
  });

  it("differs for the same user across processes (no cross-process link)", () => {
    expect(anonymousActorToken("user_dana", "proc_alpha")).not.toBe(
      anonymousActorToken("user_dana", "proc_beta"),
    );
  });

  it("differs between users within one process", () => {
    expect(anonymousActorToken("user_dana", "proc_alpha")).not.toBe(
      anonymousActorToken("user_bob", "proc_alpha"),
    );
  });

  it("never contains the raw user id", () => {
    expect(anonymousActorToken("user_dana", "proc_alpha")).not.toContain(
      "user_dana",
    );
  });

  it("degrades to the shared token with no secret — never to a derivable digest", () => {
    const saved = process.env.CIVIC_ANON_SECRET;
    delete process.env.CIVIC_ANON_SECRET;
    try {
      expect(anonymousActorToken("user_dana", "proc_alpha")).toBe("anonymous");
    } finally {
      process.env.CIVIC_ANON_SECRET = saved;
    }
  });

  it("degrades to the shared token with no process to scope to", () => {
    expect(anonymousActorToken("user_dana", null)).toBe("anonymous");
  });
});

describe("scrubPayloadForPublic — name-shaped fields", () => {
  it("drops generic name keys at any depth", () => {
    const scrubbed = scrubPayloadForPublic({
      proposal: { title: "Farm stand", author_name: "Dana Reed" },
      creator_name: "Dana Reed",
      nested: { deep: { full_name: "Dana Reed", display_name: "D. Reed" } },
    }) as Record<string, any>;
    expect(JSON.stringify(scrubbed)).not.toContain("Dana Reed");
    expect(JSON.stringify(scrubbed)).not.toContain("D. Reed");
    expect(scrubbed.proposal.title).toBe("Farm stand"); // content untouched
  });

  it("replaces a non-official announcement byline with the Admin role label", () => {
    // Announcement authors are admins or officials by construction, so a
    // non-official author IS an admin — role acknowledged, name withheld.
    const scrubbed = scrubPayloadForPublic({
      announcement: {
        title: "Road closure",
        official_type: null,
        author_display_name: "Adam Lake",
      },
    }) as Record<string, any>;
    expect(scrubbed.announcement.author_display_name).toBe("Admin");
  });

  it("keeps an OFFICIAL announcement byline (public record)", () => {
    const scrubbed = scrubPayloadForPublic({
      announcement: {
        official_type: "board_of_supervisors",
        author_display_name: "Sup. Jane Doe",
      },
    }) as Record<string, any>;
    expect(scrubbed.announcement.author_display_name).toBe("Sup. Jane Doe");
  });

  it("keeps responder_name (brief responders are officials by construction)", () => {
    const scrubbed = scrubPayloadForPublic({
      response: { responder_name: "Sup. Jane Doe" },
    }) as Record<string, any>;
    expect(scrubbed.response.responder_name).toBe("Sup. Jane Doe");
  });
});

describe("redactEventForPublic — the feed path", () => {
  it("tokenizes a resident actor and scrubs the payload", () => {
    const redacted = redactEventForPublic(
      event({ data: { comment: { body_preview: "hi" }, author_name: "Dana" } }),
      NO_OFFICIALS,
    );
    expect(redacted.actor).toBe(anonymousActorToken("user_dana", "proc_alpha"));
    expect(redacted.actor).not.toContain("user_dana");
    expect(JSON.stringify(redacted.data)).not.toContain("Dana");
  });

  it("exempts officials", () => {
    const redacted = redactEventForPublic(
      event(),
      new Set(["user_dana"]),
    );
    expect(redacted.actor).toBe("user_dana");
  });

  it("passes system actors through", () => {
    const redacted = redactEventForPublic(
      event({ actor: "system:brief-spawn" }),
      NO_OFFICIALS,
    );
    expect(redacted.actor).toBe("system:brief-spawn");
  });

  it("does not mutate the stored event", () => {
    const original = event();
    redactEventForPublic(original, NO_OFFICIALS);
    expect(original.actor).toBe("user_dana");
  });
});

describe("toPublicActivity — the AS2 path", () => {
  it("emits a process-scoped participant IRI, not /users/<raw id>", () => {
    const activity = toPublicActivity(event(), NO_OFFICIALS);
    const actor = activity.actor as string;
    expect(actor).toMatch(
      /^https:\/\/app\.floyd\.example\/process\/proc_alpha\/participants\/anon-[0-9a-f]{16}$/,
    );
    expect(JSON.stringify(activity)).not.toContain("user_dana");
  });

  it("the IRI is unlinkable across processes for the same user", () => {
    const a = toPublicActivity(event(), NO_OFFICIALS).actor as string;
    const b = toPublicActivity(
      event({ id: "evt_test_2", process_id: "proc_beta" }),
      NO_OFFICIALS,
    ).actor as string;
    expect(a.split("/participants/")[1]).not.toBe(
      b.split("/participants/")[1],
    );
  });

  it("an official keeps the canonical serialization, byte-identical", () => {
    const e = event();
    expect(toPublicActivity(e, new Set(["user_dana"]))).toEqual(toActivity(e));
  });

  it("the admin path (plain toActivity) is unchanged: raw-id IRI", () => {
    expect(toActivity(event()).actor).toBe(
      "https://app.floyd.example/users/user_dana",
    );
  });
});

// Audit C2 (Adam, 2026-10-11): account ids are hidden from everyone but hub
// admins. A signed-in resident keeps names (said publicly, public within the
// hub) but never sees a raw user id, in the actor or anywhere in the payload.
describe("account ids are hidden from signed-in non-admins", () => {
  const withIds = () =>
    event({
      data: {
        proposal: { title: "Benches", submitted_by: "user_dana", author_name: "Dana" },
        created_by: "user:dev-resident-1",
        supporters: ["user_dana", "user_erin"],
        process_id: "proc_alpha",
      },
    });

  it("member: actor and payload ids become the per-process token; names stay", () => {
    const redacted = redactEvent(withIds(), NO_OFFICIALS, "member");
    const wire = JSON.stringify(redacted);
    expect(redacted.actor).toBe(anonymousActorToken("user_dana", "proc_alpha"));
    expect(wire).not.toContain("user_dana");
    expect(wire).not.toContain("user_erin");
    expect(wire).not.toContain("dev-resident-1");
    expect(wire).toContain("Dana");
    // The same person is the same token across actor and payload, in one process.
    const data = redacted.data as { proposal: { submitted_by: string } };
    expect(data.proposal.submitted_by).toBe(redacted.actor);
    // Non-account strings are untouched.
    expect((redacted.data as { process_id: string }).process_id).toBe("proc_alpha");
  });

  it("public: the same ids hidden, and names scrubbed too", () => {
    const wire = JSON.stringify(redactEvent(withIds(), NO_OFFICIALS, "public"));
    expect(wire).not.toContain("user_dana");
    expect(wire).not.toContain("Dana");
  });

  it("an official's id stays, in the actor and the payload", () => {
    const officials = new Set(["user_dana"]);
    const redacted = redactEvent(withIds(), officials, "member");
    expect(redacted.actor).toBe("user_dana");
    expect(JSON.stringify(redacted.data)).toContain("user_dana");
    expect(JSON.stringify(redacted.data)).not.toContain("user_erin");
  });

  it("the AS2 path for a member carries no raw-id IRI", () => {
    const activity = toRedactedActivity(withIds(), NO_OFFICIALS, "member");
    expect(JSON.stringify(activity)).not.toContain("user_dana");
    expect(activity.actor as string).toMatch(/\/process\/proc_alpha\/participants\/anon-/);
  });

  it("scrubAccountIds finds ids under any key, at any depth", () => {
    const out = scrubAccountIds({ a: { b: [{ whoever: "user_0123456789abcdef" }] } }, "proc_alpha", NO_OFFICIALS);
    expect(JSON.stringify(out)).not.toContain("user_0123456789abcdef");
  });
});

describe("redaction by declared disclosure policy (Architecture 3, Q6)", () => {
  // A payload with a name field, on a process of each policy's type.
  const named = (type: string) =>
    event({
      event_type: "civic.process.updated",
      data: {
        process: { type },
        meeting_summary: { author_name: "Dana Resident", note: "kept" },
      },
    });
  const names = (e: CivicEvent, audience: "member" | "public") =>
    JSON.stringify(redactEvent(e, NO_OFFICIALS, audience).data);

  it("anonymous (a vote): names scrubbed for members and the public alike", () => {
    for (const audience of ["member", "public"] as const) {
      const out = names(named("civic.vote"), audience);
      expect(out).not.toContain("Dana Resident");
      expect(out).toContain("kept");
    }
  });

  it("members (a proposal): names to members, scrubbed for the public — as before the policy", () => {
    expect(names(named("civic.proposal"), "member")).toContain("Dana Resident");
    expect(names(named("civic.proposal"), "public")).not.toContain("Dana Resident");
  });

  it("public (a meeting summary): names to every reader — the public record", () => {
    expect(names(named("civic.meeting_summary"), "member")).toContain("Dana Resident");
    expect(names(named("civic.meeting_summary"), "public")).toContain("Dana Resident");
  });

  it("an unknown type defaults to members — exactly the pre-policy behaviour", () => {
    expect(names(named("civic.someday"), "member")).toContain("Dana Resident");
    expect(names(named("civic.someday"), "public")).not.toContain("Dana Resident");
  });

  it("account ids never serve below admin, whatever the policy", () => {
    for (const type of ["civic.vote", "civic.proposal", "civic.meeting_summary"]) {
      for (const audience of ["member", "public"] as const) {
        const e = event({
          event_type: "civic.process.updated",
          data: { process: { type }, submitted_by: "user_0123456789abcdef" },
        });
        expect(JSON.stringify(redactEvent(e, NO_OFFICIALS, audience).data)).not.toContain(
          "user_0123456789abcdef",
        );
      }
    }
  });

  it("a per-process override is honoured only where the type allows one", () => {
    // No type declares disclosureOverridable today, so an override is inert.
    const e = named("civic.vote");
    expect(JSON.stringify(redactEvent(e, NO_OFFICIALS, "member", "public").data)).not.toContain(
      "Dana Resident",
    );
  });
});
