// What a scheduled job returns for one hub. `status` is the HTTP status the
// hub's run would have had on its own; the route reports the worst of them,
// so one failing hub still fails the cron and Vercel still alerts.

export interface JobOutcome {
  status: number;
  body: Record<string, unknown>;
}

/** Parsed by the route; a runner never sees the request. */
export interface JobRunInput {
  /** The clock the run judges "due" against. Injected so tests can fix it. */
  now: Date;
  /**
   * A manual run's `?force=true`: skip the job's own schedule check (the
   * digest's send hour). Never skips `plugin.<id>.enabled`, the cron secret,
   * HUB_CRON_ENABLED or the mail guard.
   */
  force: boolean;
}

export type JobRunner = (input: JobRunInput) => Promise<JobOutcome>;
