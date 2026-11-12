// Running the console Dashboard's sections (the dashboard slice, 2026-10-17),
// shared by both sides of the console split: the hub runs its own sections
// (src/operator/dashboard/registry.ts) and the console (Mosaic-Foundation/mosaic-console) runs
// the ones that read outside services. Pure: no database, no
// settings.
//
// Every loader runs at once, each under its own timeout, so one slow source
// never blanks the page: a section that times out or throws comes back with
// `status` saying so, and the others still render.

export interface SectionContext {
  now: Date;
  /** The manual refresh: skip the one-minute caches. */
  fresh: boolean;
}

export interface DashboardSection {
  /** Stable id; the UI's renderer is keyed by it. */
  readonly id: string;
  /** The heading on the page. */
  readonly name: string;
  readonly load: (ctx: SectionContext) => Promise<unknown>;
  /** Defaults to SECTION_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

/** Long enough for any section's database reads and an outside service's 5 s. */
export const SECTION_TIMEOUT_MS = 8_000;
/** The hubs section: every hub's health, retries included, five at a time. */
export const HUBS_TIMEOUT_MS = 60_000;

export interface SectionResult {
  id: string;
  name: string;
  status: "ok" | "timeout" | "error";
  /** How long the loader took (or the timeout). */
  ms: number;
  data: unknown;
  /** One line when status is not ok. */
  message?: string;
}

export interface DashboardPayload {
  gathered_at: string;
  sections: SectionResult[];
}

class SectionTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SectionTimeout(`took longer than ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export async function runSection(section: DashboardSection, ctx: SectionContext): Promise<SectionResult> {
  const started = Date.now();
  const timeoutMs = section.timeoutMs ?? SECTION_TIMEOUT_MS;
  try {
    const data = await withTimeout(Promise.resolve().then(() => section.load(ctx)), timeoutMs);
    return { id: section.id, name: section.name, status: "ok", ms: Date.now() - started, data };
  } catch (err) {
    const timedOut = err instanceof SectionTimeout;
    if (!timedOut) console.warn(`[dashboard] section ${section.id} failed:`, err);
    return {
      id: section.id,
      name: section.name,
      status: timedOut ? "timeout" : "error",
      ms: Date.now() - started,
      data: null,
      message: timedOut ? `This section ${(err as Error).message}.` : "This section could not be loaded.",
    };
  }
}

export async function runSections(sections: readonly DashboardSection[], ctx: SectionContext): Promise<SectionResult[]> {
  return Promise.all(sections.map((s) => runSection(s, ctx)));
}
