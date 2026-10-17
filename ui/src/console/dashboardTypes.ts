// What GET /control/dashboard answers (src/control/dashboard/). The console
// imports nothing from the server's src/control, so the shapes are restated
// here; the Playwright suite (tests/e2e/dashboard.spec.ts) reads the page the
// server fills, so a drift shows there.

export interface SectionResult<T = unknown> {
  id: string;
  name: string;
  status: "ok" | "timeout" | "error";
  ms: number;
  data: T | null;
  message?: string;
}

export interface DashboardPayload {
  gathered_at: string;
  sections: SectionResult[];
}

export type OutsideResult<T> =
  | { state: "connected"; data: T }
  | { state: "not_connected"; setup: string }
  | { state: "error"; message: string };

export type HubGroup = "live" | "beta" | "demo" | "archived";

export interface HubHealth {
  state: "up" | "degraded" | "down";
  http_status: number | null;
  commit: string | null;
  gaps: string[];
  reason: string | null;
  ms: number;
}

export interface HubRow {
  id: string;
  name: string;
  hostname: string;
  mode: string | null;
  group: HubGroup;
  status: string;
  health: HubHealth | null;
  commit: string | null;
  commit_matches: boolean | null;
  members: number | null;
  last_activity_at: string | null;
  days_since_activity: number | null;
}

export interface HubsData {
  console_commit: string;
  hubs: HubRow[];
}

export interface JobRow {
  id: string;
  description: string;
  schedule: string;
  scope: "hub" | "platform";
  last: {
    started_at: string;
    finished_at: string;
    status: "ok" | "failed";
    duration_ms: number;
    hubs_run: number;
    hubs_failed: number;
    error: string | null;
  } | null;
  next_run_at: string | null;
  late: boolean;
  attention: boolean;
}

export interface BackupStatus {
  status: string;
  last_ping: string | null;
  next_ping: string | null;
}

export interface JobsData {
  jobs: JobRow[];
  backup: OutsideResult<BackupStatus>;
}

export interface UptimeStatus {
  up: number;
  total: number;
  monitors: Array<{ name: string; status: string; last_checked_at: string | null }>;
}

export interface ErrorsStatus {
  events: number;
  issues: number;
  top: Array<{ title: string; count: number; level: string; last_seen: string | null; link: string | null }>;
}

export interface OutsideData {
  uptime: OutsideResult<UptimeStatus>;
  errors: OutsideResult<ErrorsStatus>;
}

export const ATTENTION_QUEUES = ["reviews", "briefs", "meeting_summaries", "feedback", "waitlist", "flagged"] as const;
export type AttentionQueue = (typeof ATTENTION_QUEUES)[number];

export interface AttentionRow {
  id: string;
  name: string;
  mode: string | null;
  group: HubGroup;
  counts: Record<AttentionQueue, number | null>;
  links: Record<AttentionQueue, string>;
  total: number;
  error?: string;
}

export interface AttentionData {
  feedback_days: number;
  hubs: AttentionRow[];
}
