// Regenerate a brief, for Conversations while it is still on SDK version 0
// (its older "make the summary again" link). Briefs owns the code
// (packages/civic.brief/regenerate.ts); this forwards to it, loaded on first
// use, never as the engine starts (ADR-017). It goes when Conversations moves
// onto version 1 (docs/kernel/SURFACE.md, "Event: couplings that go").

export const regenerateBrief: typeof import("../../packages/civic.brief/regenerate.js").regenerateBrief = async (...a) =>
  (await import("../../packages/civic.brief/regenerate.js")).regenerateBrief(...a);
