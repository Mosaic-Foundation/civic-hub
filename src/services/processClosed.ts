// The kernel's "process closed" event (kernel step 3, docs/kernel/SURFACE.md,
// "Event: couplings that go"): when a process of any type enters a closed
// status, the kernel tells every mounted package that listens
// (PluginServer.on.processClosed) and whose plugin is on for the hub in scope.
// The kernel names no package: Briefs makes its brief by listening, where the
// kernel used to call the brief spawner itself.
//
// What the process came to (`result()`) is asked of its own type once, and
// only when a listener asks for it: its handler's process.result, with the
// kernel's own closed-early line and its district and demographic tables
// (frozen when the result is made).

import type { Process } from "../models/process.js";
import type { BriefContent } from "../processes/contracts/briefContent.js";
import type { ClosedProcess } from "../plugins/package.js";
import { getProcessHandler } from "../processes/registry.js";
import { loadedPackages } from "../plugins/loader.js";
import { isPackageMounted } from "../plugins/mountedState.js";
import { isPluginEnabledSync } from "./hubSettings.js";
import { closedEarlyView } from "./closeEarly.js";
import { breakdownAsText, breakdownsForClosed } from "./breakdowns.js";

/** What a closed process came to, as `ClosedProcess.result()` gives it. Null when its type says nothing. */
export async function closedResult(source: Process): Promise<BriefContent | null> {
  const handler = getProcessHandler(source.definition.type);
  if (!handler?.generateBrief) return null;
  const content = await handler.generateBrief(source);
  if (!content) return null;
  // Closed early: every result carries the line and the admin's note,
  // whatever its type (src/services/closeEarly.ts).
  const early = closedEarlyView(source.state);
  if (early) content.closed_early = { line: early.line, note: early.note };
  // Districts and demographics (2026-11-16): the same tables the process's
  // page shows, as the result's own sections (one per group the hub asks
  // about, every group under 5 hidden). Never stops a result: a failed read
  // leaves them out.
  try {
    const tables = await breakdownsForClosed(source);
    for (const t of tables) content.sections.push({ heading: t.title, body: breakdownAsText(t) });
  } catch (err) {
    console.warn(`[closed] breakdowns for ${source.id} left out: ${err instanceof Error ? err.message : "unknown error"}`);
  }
  return content;
}

/** Whether any mounted package on the hub in scope listens for a closed process. */
export function anyoneListensForClosed(): boolean {
  return listeners().length > 0;
}

function listeners(): Array<{ name: string; fn: (c: ClosedProcess) => Promise<void> }> {
  return loadedPackages().flatMap((p) => {
    const fn = p.server.on?.processClosed;
    return fn && isPackageMounted(p.pkg.name) && isPluginEnabledSync(p.plugin) ? [{ name: p.pkg.name, fn }] : [];
  });
}

/**
 * Tell the listeners that a process closed (processService, after the close
 * and its after-commit work). Each in turn; a failure is logged and the next
 * still hears it. Never throws.
 */
export async function announceClosed(process: Process, actor: string): Promise<void> {
  let made: Promise<BriefContent | null> | null = null;
  // Each listener gets its own copy: one finishing the result must not change another's.
  const result = async () => {
    const r = await (made ??= closedResult(process));
    return r ? structuredClone(r) : null;
  };
  for (const l of listeners()) {
    try {
      await l.fn({ process, actor, result });
    } catch (err) {
      console.warn(`[closed] ${l.name} on the close of ${process.id} failed (the close stands):`, err instanceof Error ? err.message : err);
    }
  }
}
