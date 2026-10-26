// An announcement keeps its author's name (2026-10-25). The controller chose
// a name (the author list's, else the poster's account name) and the handler
// dropped it, so no announcement recorded one and no card showed one.

import { describe, expect, it } from "vitest";
import handler from "../../packages/civic.announcement/handler.js";

const base = { title: "Budget hearing", body: "Tuesday at seven.", author_id: "user_1", author_role: "Board member" };

describe("civic.announcement initializeState", () => {
  it("keeps the author's name on the state its events are stamped from", () => {
    const state = handler.initializeState!({ ...base, official_type: "board_of_supervisors", author_display_name: "Jo Board" });
    expect(state.author_display_name).toBe("Jo Board");
    expect(state.official_type).toBe("board_of_supervisors");
  });

  it("no name, or a blank one, is none", () => {
    expect(handler.initializeState!({ ...base }).author_display_name).toBeNull();
    expect(handler.initializeState!({ ...base, author_display_name: "   " }).author_display_name).toBeNull();
    expect(handler.initializeState!({ ...base, author_display_name: 7 }).author_display_name).toBeNull();
  });
});
