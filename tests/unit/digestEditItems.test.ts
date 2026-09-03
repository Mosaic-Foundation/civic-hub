import { describe, it, expect } from "vitest";
import { buildEditItems } from "../../src/modules/civic.digest/service.js";
import type { DigestEvent } from "../../src/modules/civic.digest/models.js";

type E = DigestEvent & { actor?: string };
const edit = (id: string, ts: string, actor: string, fields = ["description"]): E => ({
  id: `evt_${ts}`,
  event_type: "civic.process.updated",
  timestamp: ts,
  process_id: id,
  action_url: `https://hub/project/${id}`,
  data: { edit: { changed_fields: fields, previous: {}, current: {}, editor_role: "creator" } },
  actor,
});
const processes = { proc_a: { title: "Skate park", href: "https://hub/project/proc_a" } };

describe("digest: 'a project you support was edited' — one line, supporters only", () => {
  it("collapses several edits of one project into one row for a supporter", () => {
    const items = buildEditItems({
      user_id: "u_supporter",
      events: [edit("proc_a", "2026-09-03T10:00:00Z", "u_creator"), edit("proc_a", "2026-09-03T12:00:00Z", "u_creator")],
      supporters: { proc_a: new Set(["u_supporter"]) },
      processes,
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Skate park");
    expect(items[0].summary).toMatch(/edited 2 times/);
    expect(items[0].action_url).toBe("https://hub/project/proc_a#edits");
    expect(items[0].timestamp).toBe("2026-09-03T12:00:00Z");
    expect(items[0].kind).toBe("project-updated");
  });
  it("says nothing to non-supporters and to the editor", () => {
    const events = [edit("proc_a", "2026-09-03T10:00:00Z", "u_creator")];
    expect(buildEditItems({ user_id: "u_other", events, supporters: { proc_a: ["u_supporter"] }, processes })).toEqual([]);
    expect(buildEditItems({ user_id: "u_creator", events, supporters: { proc_a: ["u_creator", "u_supporter"] }, processes })).toEqual([]);
  });
  it("ignores status-change updates and edits with no changed fields", () => {
    const status: E = { ...edit("proc_a", "2026-09-03T10:00:00Z", "u_creator"), data: { process: { previous_status: "active", status: "closed" } } };
    const empty = edit("proc_a", "2026-09-03T11:00:00Z", "u_creator", []);
    expect(buildEditItems({ user_id: "u_supporter", events: [status, empty], supporters: { proc_a: ["u_supporter"] }, processes })).toEqual([]);
  });
});
