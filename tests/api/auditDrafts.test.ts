// Audit 3, part two (F1): one drafts system for every kind. For each of the
// four kinds (proposal, vote, project, conversation), through its existing
// URL:
//
//   - create, read, edit and list its own drafts as a resident; another
//     resident cannot read or edit them, and signing out shuts every route;
//   - the Code of Conduct gate is the same one place: Submit checks a
//     never-checked draft, and text edited after a check, and refuses what
//     it flags;
//   - submits at the same moment (a double click, two tabs) create exactly one
//     review: one 201, the rest 409, and one process_reviews row;
//   - a submission that fails releases the draft for another try.
//
// Plus: new project drafts no longer share proposals' id prefix, and the
// database refuses a second review for a draft.
//
// LOCAL ONLY (writes draft rows straight to the local stack to fake a check
// that could not run). Needs a server (CIVIC_API_BASE). Both CI passes.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { call } from "../fixtures/hostCall.js";
import { localRest, mintSession } from "../fixtures/adminSession.js";
import { checkedHashFor, COC_FLAG } from "../fixtures/codeOfConduct.js";

const DB_URL = process.env.CIVIC_TEST_DATABASE_URL?.trim() || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
{
  const host = new URL(DB_URL).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`auditDrafts: refusing ${host}; local stack only.`);
}

const FLOYD = "floyd.civic.social";
const tag = Date.now().toString(36);

interface Kind {
  name: string;
  path: string;
  table: string;
  processType: string;
  /** The fields a submittable draft needs, beyond what the check reads. */
  fields: Record<string, unknown>;
}

const KINDS: Kind[] = [
  { name: "proposal", path: "/proposals/drafts", table: "proposal_drafts", processType: "civic.proposal", fields: {} },
  { name: "vote", path: "/votes/drafts", table: "vote_drafts", processType: "civic.vote", fields: {} },
  { name: "project", path: "/projects/drafts", table: "project_drafts", processType: "civic.project", fields: {} },
  {
    name: "conversation",
    path: "/deliberations/drafts",
    table: "deliberation_drafts",
    processType: "civic.polis_deliberation",
    fields: {},
  },
];

let owner = "";
let other = "";

beforeAll(async () => {
  owner = await mintSession("floyd", `drafts-owner-${tag}@example.test`);
  other = await mintSession("floyd", `drafts-other-${tag}@example.test`);
});

/** A draft whose Code of Conduct check ran on its text and could not run (so it goes to an admin). */
async function checkedDraft(kind: Kind, title: string): Promise<string> {
  const created = await call("POST", kind.path, FLOYD, {}, owner);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  const text = { title, description: `Description of ${title}.` };
  const patched = await call("PATCH", `${kind.path}/${id}`, FLOYD, text, owner);
  expect(patched.status, JSON.stringify(patched.body)).toBe(200);
  await localRest(`${kind.table}?id=eq.${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      last_review_result: [{ severity: "soft", check_unavailable: true, message: "could not run" }],
      draft_modified_since_review: false,
      coc_checked_hash: checkedHashFor(text),
    }),
  });
  return id;
}

describe.each(KINDS)("$name drafts", (kind) => {
  it("are the owner's: create, read, edit, list; nobody else's; not signed out", async () => {
    const created = await call("POST", kind.path, FLOYD, {}, owner);
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body.status).toBe("drafting");
    expect(created.body.links).toEqual([]);

    const edited = await call("PATCH", `${kind.path}/${id}`, FLOYD, { title: "Mine", links: [] }, owner);
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe("Mine");

    expect((await call("GET", `${kind.path}/${id}`, FLOYD, undefined, owner)).body.title).toBe("Mine");
    const listed = await call("GET", kind.path, FLOYD, undefined, owner);
    expect(listed.status).toBe(200);
    expect((listed.body as Array<{ id: string }>).map((d) => d.id)).toContain(id);

    expect((await call("GET", `${kind.path}/${id}`, FLOYD, undefined, other)).status).toBe(403);
    expect((await call("PATCH", `${kind.path}/${id}`, FLOYD, { title: "Theirs" }, other)).status).toBe(403);
    expect((await call("GET", kind.path, FLOYD, undefined, other)).body).not.toContainEqual(
      expect.objectContaining({ id }),
    );
    for (const [method, path] of [
      ["GET", `${kind.path}/${id}`],
      ["PATCH", `${kind.path}/${id}`],
      ["GET", kind.path],
      ["POST", `${kind.path}/${id}/submit`],
    ] as const) {
      expect((await call(method, path, FLOYD, method === "PATCH" ? { title: "x" } : undefined)).status).toBe(401);
    }
  });

  it("go through the one Code of Conduct gate", async () => {
    // Submit runs the check itself (Submit and Save): a never-checked draft
    // is read at Submit, and so is text edited after a check. The hub runs
    // the fake check (CIVIC_COC_FAKE=on), which flags COC_FLAG.
    const created = await call("POST", kind.path, FLOYD, {}, owner);
    const id = created.body.id as string;
    await call("PATCH", `${kind.path}/${id}`, FLOYD, { title: "Never checked", description: `Text. ${COC_FLAG}` }, owner);
    const refused = await call("POST", `${kind.path}/${id}/submit`, FLOYD, {}, owner);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("code_of_conduct_flagged");

    const checked = await checkedDraft(kind, `Changed after ${tag}`);
    const edit = await call("PATCH", `${kind.path}/${checked}`, FLOYD, { description: `New text. ${COC_FLAG}` }, owner);
    expect(edit.body.draft_modified_since_review).toBe(true);
    const stale = await call("POST", `${kind.path}/${checked}/submit`, FLOYD, {}, owner);
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe("code_of_conduct_flagged");
  });

  it("submitted from two tabs at once make one review", async () => {
    const id = await checkedDraft(kind, `Twice ${kind.name} ${tag}`);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call("POST", `${kind.path}/${id}/submit`, FLOYD, {}, owner)),
    );
    const created = results.filter((r) => r.status === 201);
    expect(created, JSON.stringify(results.map((r) => [r.status, r.body]))).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 201)) expect(r.status).toBe(409);
    expect(created[0].body.auto_approved).toBe(false);

    const reviews = (await localRest(`process_reviews?select=id,process_id&draft_id=eq.${id}`)) as Array<{
      process_id: string;
    }>;
    expect(reviews).toHaveLength(1);
    const [proc] = (await localRest(`processes?select=type,status&id=eq.${reviews[0].process_id}`)) as Array<{
      type: string;
      status: string;
    }>;
    expect(proc.type).toBe(kind.processType);
    const [draft] = (await localRest(`${kind.table}?select=status&id=eq.${id}`)) as Array<{ status: string }>;
    expect(draft.status).toBe("submitted");
  });
});

describe("a submission that fails releases its draft", () => {
  it("a conversation whose seed statement fails the word list is refused and stays editable", async () => {
    const kind = KINDS[3];
    const id = await checkedDraft(kind, `Seeds ${tag}`);
    // Seed statements are not in the checked text above, so the check stands.
    await localRest(`${kind.table}?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ seed_statements: "A fine statement\nfuck" }),
    });
    await localRest(`${kind.table}?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ coc_checked_hash: checkedHashFor({ title: `Seeds ${tag}`, description: `Description of Seeds ${tag}.`, seed_statements: "A fine statement\nfuck" }) }),
    });
    const res = await call("POST", `${kind.path}/${id}/submit`, FLOYD, {}, owner);
    expect(res.status).toBe(400);
    const [draft] = (await localRest(`${kind.table}?select=status&id=eq.${id}`)) as Array<{ status: string }>;
    expect(draft.status).toBe("drafting");
  });
});

describe("a failed auto-approval leaves the submission in the queue", () => {
  // 33b65b8: going live at once (an admin's submission) failed after the review
  // existed; the submit reported failure and released the draft, so a second
  // click queued it twice (seen on dev 2026-10-11, a vote whose approval action
  // hit a function dev did not have yet). A trigger on this test's own rows
  // makes the vote's required "propose" step fail the same way.
  const fn = `audit_autofail_${tag}`;
  const marker = `Autofail ${tag}`;
  let db: pg.Client;

  beforeAll(async () => {
    db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    await db.query(`
      CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.title LIKE '${marker}%' AND (NEW.state->>'status') IS DISTINCT FROM (OLD.state->>'status') THEN
          RAISE EXCEPTION 'forced approval failure (test)';
        END IF;
        RETURN NEW;
      END $$`);
    await db.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON public.processes FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);
    // PostgREST reloads its schema on DDL and drops connections in flight;
    // let it settle so no other request meets a 502 (plugin conformance,
    // 2026-10-12: the likely cause of the "ballot gateway flake").
    await new Promise((r) => setTimeout(r, 1_500));
  });

  afterAll(async () => {
    await db.query(`DROP TRIGGER IF EXISTS ${fn} ON public.processes`).catch(() => {});
    await db.query(`DROP FUNCTION IF EXISTS public.${fn}()`).catch(() => {});
    await db.end();
    await new Promise((r) => setTimeout(r, 1_500));
  });

  it("the submit succeeds, one review waits, the draft stays submitted, a second submit is refused", async () => {
    const admin = await mintSession("floyd", "admin@example.test");
    const kind = KINDS[1];
    const created = await call("POST", kind.path, FLOYD, {}, admin);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const text = { title: marker, description: `Description of ${marker}.` };
    expect((await call("PATCH", `${kind.path}/${id}`, FLOYD, text, admin)).status).toBe(200);
    await localRest(`${kind.table}?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ last_review_result: [], draft_modified_since_review: false, coc_checked_hash: checkedHashFor(text) }),
    });

    const first = await call("POST", `${kind.path}/${id}/submit`, FLOYD, {}, admin);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.auto_approved).toBe(false);

    const reviews = (await localRest(`process_reviews?select=id,status,process_id&draft_id=eq.${id}`)) as Array<{
      status: string;
      process_id: string;
    }>;
    expect(reviews).toHaveLength(1);
    expect(reviews[0].status).toBe("pending_review");
    expect(reviews[0].process_id).toBe(first.body.process_id);
    const [proc] = (await localRest(`processes?select=status&id=eq.${reviews[0].process_id}`)) as Array<{ status: string }>;
    expect(proc.status).toBe("pending_review");
    const [draft] = (await localRest(`${kind.table}?select=status&id=eq.${id}`)) as Array<{ status: string }>;
    expect(draft.status).toBe("submitted");

    const second = await call("POST", `${kind.path}/${id}/submit`, FLOYD, {}, admin);
    // Told it was already submitted: a conflict, finished first submit or not (Audit 4).
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("already_submitted");
    expect(second.body.error).toBe("Draft has already been submitted");
    expect((await localRest(`process_reviews?select=id&draft_id=eq.${id}`)) as unknown[]).toHaveLength(1);
  });
});

describe("drift resolved", () => {
  it("new project drafts have their own id prefix", async () => {
    const created = await call("POST", "/projects/drafts", FLOYD, {}, owner);
    expect(created.body.id).toMatch(/^prjdraft_/);
    const proposal = await call("POST", "/proposals/drafts", FLOYD, {}, owner);
    expect(proposal.body.id).toMatch(/^pdraft_/);
  });

  it("the database refuses a second review for one draft", async () => {
    const db = new pg.Client({ connectionString: DB_URL });
    await db.connect();
    try {
      // In a transaction rolled back at the end: nothing is left behind.
      await db.query("BEGIN");
      const proc = `proc_dup_${tag}`;
      await db.query(
        `INSERT INTO processes (id, type, process_version, title, status, state, hub_id)
         VALUES ($1, 'civic.proposal', '0.1', 'Dup', 'archived', '{}'::jsonb, 'floyd')`,
        [proc],
      );
      const insert = (id: string) =>
        db.query(
          `INSERT INTO process_reviews (id, process_id, creator_id, creator_name, creator_email, draft_id, hub_id)
           VALUES ($1, $2, 'user_dup', 'Dup', 'dup@example.test', $3, 'floyd')`,
          [id, proc, `pdraft_dup_${tag}`],
        );
      await insert(`rev_dup1_${tag}`);
      await expect(insert(`rev_dup2_${tag}`)).rejects.toThrow(/process_reviews_one_per_draft/);
    } finally {
      await db.query("ROLLBACK").catch(() => {});
      await db.end();
    }
  });
});
