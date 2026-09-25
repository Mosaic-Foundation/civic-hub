// Meeting-summary diagnostic + manual run.
//
//   npx tsx --env-file=.env scripts/diagnoseMeetingSummary.ts --hub <slug>             # dry run
//   npx tsx --env-file=.env scripts/diagnoseMeetingSummary.ts --hub <slug> --summarize # + Claude
//
// It diagnoses ONE hub, reading that hub's plugin.meeting_summary.* settings
// through the same resolver the cron uses (src/modules/civic.meeting_summary/
// config.ts), so what it reports is what the cron would do for that hub.
//
// WHY THIS EXISTS
// The cron went quiet for weeks in 2026 and nothing said so: the first hub's
// county moved its agendas-and-minutes page to client-side rendering, `fetch()`
// started returning a shell with no meeting links, and "discovery found 0
// meetings" is indistinguishable from "there were no meetings" unless
// something goes looking. This script is that something — it checks the
// configuration, runs discovery for real, and prints WHY the answer is
// what it is, in a form a non-engineer can act on.
//
// Dry run by default: it reads the source and reports what it found without
// calling Claude, touching the database, or creating any process. Pass
// --summarize to additionally summarize the newest discovered meeting
// end-to-end (this DOES spend Anthropic tokens; it still writes nothing).

import {
  AUTO_ORDER,
  CONNECTORS,
  discoverMeetings,
  summarizeMeeting,
  channelFeedUrl,
  isConfigured,
  isValidChannelId,
  resolveMeetingSummaryConfig,
  type MeetingEntry,
} from "../src/modules/civic.meeting_summary/index.js";
import { callClaude, DEFAULT_MODEL } from "../src/utils/anthropic.js";
import { fetchHtml, fetchJson, fetchPdf, fetchXml } from "../src/utils/http.js";
import { fetchYouTubeTranscript } from "../src/utils/youtube.js";
import { getAdminEmailsSync } from "../src/services/hubSettings.js";
import { withScriptHub } from "./lib/hubScope.js";

const ok = (s: string) => console.log(`  ✅ ${s}`);
const warn = (s: string) => console.log(`  ⚠️  ${s}`);
const bad = (s: string) => console.log(`  ❌ ${s}`);

function heading(s: string): void {
  console.log(`\n${s}\n${"─".repeat(s.length)}`);
}

/** Report on one env var without ever printing its value. */
function reportKey(name: string, opts: { required: boolean; hint: string }): boolean {
  const raw = process.env[name]?.trim();
  if (raw) {
    ok(`${name} is set (${raw.length} chars)`);
    return true;
  }
  if (opts.required) bad(`${name} is NOT set — ${opts.hint}`);
  else warn(`${name} is not set — ${opts.hint}`);
  return false;
}

async function diagnose(): Promise<void> {
  const doSummarize = process.argv.includes("--summarize");

  console.log("Meeting-summary pipeline diagnostic");
  console.log(doSummarize ? "Mode: discovery + summarize one meeting" : "Mode: discovery only (dry run)");

  // --- 1. Configuration ----------------------------------------------------
  heading("1. Configuration");

  const resolved = resolveMeetingSummaryConfig(
    process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL,
  );
  if (resolved.status === "skipped") {
    bad(`${resolved.reason} — the cron skips this hub without doing anything`);
    process.exit(1);
  }
  if (resolved.status === "invalid") {
    bad(resolved.reason);
    process.exit(1);
  }
  const { connectorId, cfg } = resolved;
  if (connectorId === "auto") {
    ok(`connector "auto" — tries ${AUTO_ORDER.join(" → ")}, first with meetings wins`);
  } else {
    ok(`connector "${connectorId}" — ${CONNECTORS[connectorId].description}`);
  }

  reportKey("ANTHROPIC_API_KEY", {
    required: true,
    hint: "summarization cannot run without it (console.anthropic.com)",
  });
  reportKey("CRON_SECRET", {
    required: true,
    hint: "Vercel Cron needs it to authenticate against /internal/meeting-summary/run",
  });
  reportKey("SUPADATA_API_KEY", {
    required: false,
    hint: "without it, YouTube transcripts fall back to a path that usually fails on cloud hosts",
  });

  const admins = getAdminEmailsSync();
  if (admins.length > 0) ok(`people.admin_emails has ${admins.length} recipient(s) — failures will be emailed`);
  else bad("people.admin_emails is empty — nobody receives the failure alert. This cron would fail silently.");

  const channelId = cfg.channel_id ?? "";
  if (connectorId === "youtube-channel" || (connectorId === "auto" && channelId)) {
    if (!isValidChannelId(channelId)) {
      bad(`plugin.meeting_summary.youtube_channel_id="${channelId}" is not a UC… channel id (an @handle will not work)`);
      process.exit(1);
    }
    ok(`channel ${channelId}`);
    console.log(`     feed: ${channelFeedUrl(channelId)}`);
    if (cfg.title_filter) ok(`title filter: "${cfg.title_filter}"`);
    else warn("plugin.meeting_summary.title_filter is empty — every video on the channel counts as a meeting");
  }
  if (cfg.source_url) ok(`source page: ${cfg.source_url}`);
  if (cfg.type_exclude) ok(`excluding meeting types matching: "${cfg.type_exclude}"`);

  ok(`model: ${cfg.model}`);

  // --- 2. Discovery --------------------------------------------------------
  heading("2. Discovery");

  const deps = { fetchHtml, fetchXml, fetchJson, callClaude };
  let entries: MeetingEntry[] = [];
  let winner = connectorId;
  const t0 = Date.now();

  const ladder = connectorId === "auto" ? AUTO_ORDER : [connectorId];
  for (const id of ladder) {
    if (connectorId === "auto" && !isConfigured(id, cfg)) {
      console.log(`  ·  ${id}: skipped (not configured)`);
      continue;
    }
    try {
      const found = await discoverMeetings(CONNECTORS[id], cfg, deps);
      if (found.length > 0) {
        ok(`${id}: ${found.length} meeting(s)`);
        entries = found;
        winner = id;
        break;
      }
      warn(`${id}: 0 meetings`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (connectorId === "auto") warn(`${id}: ${msg}`);
      else {
        bad(`discovery threw: ${msg}`);
        console.log("\nThis is a hard failure. The cron would email admins and exit.");
        process.exit(1);
      }
    }
  }
  console.log(`  (${Date.now() - t0}ms)`);

  if (entries.length === 0) {
    bad("discovery returned 0 meetings.");
    console.log("");
    console.log("  This is the failure mode that went unnoticed for weeks. Zero meetings");
    console.log("  and a broken source look identical from the outside. Check, in order:");
    console.log("");
    if (winner === "youtube-channel" || connectorId === "youtube-channel") {
      console.log("    1. Open the feed URL above in a browser. Does it list videos?");
      console.log("    2. If it lists videos but we found no meetings, plugin.meeting_summary.title_filter");
      console.log("       is too narrow — compare it against the actual video titles.");
      console.log("    3. If the channel id is wrong the feed returns an error page, not videos.");
    } else {
      console.log("    1. Fetch the source page and count its links. If a browser shows");
      console.log("       meetings but fetch() finds none, the page is client-rendered and");
      console.log("       this connector cannot read it — that is exactly what a Wix redesign");
      console.log("       did to the first hub's source. Switch to the wix-cms or youtube-channel");
      console.log("       connector, or point plugin.meeting_summary.source_url at a");
      console.log("       server-rendered listing.");
      console.log("    2. Check the page hasn't moved (the county added /archive-agendas-minutes).");
    }
    process.exit(1);
  }

  ok(`discovered ${entries.length} meeting(s) via "${winner}"`);
  const sorted = [...entries].sort((a, b) => b.meeting_date.localeCompare(a.meeting_date));
  console.log("");
  for (const e of sorted.slice(0, 10)) {
    const parts = [
      e.source_minutes_url ? "minutes" : null,
      e.source_agenda_url ? "agenda" : null,
      e.source_video_url ? `video${e.additional_video_urls.length ? ` +${e.additional_video_urls.length}` : ""}` : null,
    ].filter(Boolean).join(", ") || "no sources";
    console.log(`     ${e.meeting_date}  ${e.meeting_title}  [${parts}]`);
  }
  if (sorted.length > 10) console.log(`     … and ${sorted.length - 10} more`);

  const noSource = sorted.filter((e) => !e.source_minutes_url && !e.source_agenda_url && !e.source_video_url);
  if (noSource.length > 0) warn(`${noSource.length} entry/entries have no usable source and would fail`);

  if (!doSummarize) {
    console.log("\nDiscovery is healthy. Re-run with --summarize to test the full pipeline");
    console.log("(fetches the transcript and calls Claude — spends tokens, writes nothing).");
    return;
  }

  // --- 3. Summarize the newest meeting -------------------------------------
  heading("3. Summarize newest meeting");

  const target = sorted[0];
  console.log(`  ${target.meeting_date} — ${target.meeting_title}`);
  if (target.source_video_url) console.log(`  video:   ${target.source_video_url}`);
  if (target.source_minutes_url) console.log(`  minutes: ${target.source_minutes_url}`);
  if (target.source_agenda_url) console.log(`  agenda:  ${target.source_agenda_url}`);
  console.log("");

  const t1 = Date.now();
  try {
    const result = await summarizeMeeting(target, cfg, {
      fetchPdf,
      fetchYouTubeTranscript,
      callClaude,
    });
    ok(`summarized in ${Math.round((Date.now() - t1) / 1000)}s — ${result.blocks.length} block(s), source_type="${result.sourceType}", model=${result.model}`);
    console.log("");
    for (const b of result.blocks) {
      const ts = b.start_time_seconds === null ? "--:--" : formatSeconds(b.start_time_seconds);
      console.log(`  [${ts}] ${b.topic_title}`);
      console.log(`          ${b.topic_summary}`);
      if (b.action_taken) console.log(`          → ${b.action_taken}`);
      console.log("");
    }
    console.log("Pipeline is healthy end to end. Nothing was written to the database.");
  } catch (err) {
    bad(`summarization failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log("\nDiscovery works, so the source is fine — the failure is downstream");
    console.log("(transcript provider, PDF fetch, or the Claude call). The message above says which.");
    process.exit(1);
  }
}

function formatSeconds(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

withScriptHub(diagnose).catch((err) => {
  console.error("\nDiagnostic crashed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
