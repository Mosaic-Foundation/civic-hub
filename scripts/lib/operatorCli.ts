// The operator command (scripts/operator.ts): what the console does for a
// hub deployment, for a self-hoster who runs the hub without it.
//
// Since the console split (2026-11-11) Civic.Social's console is its own
// private deployment (Mosaic-Foundation/mosaic-console). It reaches hubs only
// through the operator API (src/operator/api.ts), POST /operator/rpc/<method>
// with CIVIC_OPERATOR_TOKEN as a bearer. This command is a second client of
// the same door: it makes, changes and puts away hubs, and approves plugin
// catalog entries signed with the self-hoster's own catalog key (ADR-015).
//
// It holds no hub rule of its own: every check is the hub's, and a refusal
// comes back as the hub's sentence. What the console adds about the operator
// (sign-in, fresh codes, its audit log) is replaced here by possession of the
// token and a yes at the prompt. The hub still records who acted
// (--as, CIVIC_OPERATOR_NAME, or this computer's user name).
//
// Imports only src/shared/ (the signature): the command runs on the
// self-hoster's computer, not inside the hub.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { userInfo } from "node:os";
import { parseSigningKey, signRow, type Signature, type SigningKey } from "../../src/shared/catalogSignature.js";

export const USAGE = `npm run operator -- <command> [options]

Settings (environment, or --env-file <path>):
  CIVIC_OPERATOR_URL              the hub deployment, e.g. https://hubs.example.org
  CIVIC_OPERATOR_TOKEN            the deployment's CIVIC_OPERATOR_TOKEN
  CIVIC_CATALOG_SIGNING_KEY_FILE  your catalog key (made by "key new"); approving plugins needs it
  CIVIC_OPERATOR_NAME             who you are in the hub's records (default: your user name)

Your catalog key:
  key new <file>                  make a key; prints the public half for the hub's CIVIC_CATALOG_PUBLIC_KEY
  key show                        the key's id and public half
  check                           reach the hub; does it trust your key?

Hubs:
  hubs                            every hub on the deployment
  hub <hub>                       one hub: settings, admins, plugins
  create key=value ...            make a hub (slug, name, hostname, admin_email, mode, ...)
  config <hub> key=value ...      change a hub's settings (shows the change first)
  admins <hub> [email ...]        list a hub's admins, or set them (new ones are invited)
  sign-in-link <hub>              where a hub's admins sign in
  export <hub>                    a download link for everything the hub holds
  archive <hub> | unarchive <hub>

Plugin catalog:
  catalog                         every entry: status, signed, required
  approve <entry> [--notes text]  approve an entry, signed with your key
  withdraw <entry> [--notes text] stop mounting an approved entry
  require <entry> on|off          move every hub to this version, or stop
  sign-approved                   sign approved entries your key has not signed (after "key new")

Anything else the operator API offers:
  call <method> [json-arg ...]    e.g. call dashboard '{"fresh":true,"now":"2026-11-12T00:00:00Z"}'

Options: --json (print the hub's answer as JSON), --yes (skip the prompt), --as <name>
An <entry> may be the start of its id, if no other entry starts the same way.
Commands that change something ask first; "hubs", "hub", "catalog", "check", "key show" only read.`;

export interface OperatorResponse {
  status: number;
  /** The result on 200; { error, code } otherwise. */
  body: any;
}

/** How a call reaches the hub. */
export type Transport = (method: string, args: unknown[]) => Promise<OperatorResponse>;

export interface CliIO {
  out(line: string): void;
  err(line: string): void;
  /** Ask a yes/no question; false when nobody can answer (not a terminal). */
  confirm(question: string): Promise<boolean>;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  io: CliIO;
  /** Overrides the HTTP transport (tests). */
  transport?: Transport;
  fetchImpl?: typeof fetch;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

/** A refused call, with the hub's sentence. */
export class HubRefused extends CliError {
  constructor(
    readonly method: string,
    readonly status: number,
    readonly body: any,
  ) {
    const msg = body && typeof body === "object" && typeof body.error === "string" ? body.error : JSON.stringify(body);
    super(`The hub refused (${status}${body?.code ? `, ${body.code}` : ""}): ${msg}`);
  }
}

export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/** The deployment's base URL, checked: https, or http only on this computer (the token opens every hub's data). */
export function hubBase(raw: string | undefined): URL {
  if (!raw?.trim()) throw new CliError("Set CIVIC_OPERATOR_URL to your hub deployment's address (https://...).", 2);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CliError(`CIVIC_OPERATOR_URL is not an address: ${raw}`, 2);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHost(url.hostname))) {
    throw new CliError("CIVIC_OPERATOR_URL must be https:// (http:// only for localhost): the operator token must not cross the network in the clear.", 2);
  }
  return url;
}

export function httpTransport(base: URL, token: string, fetchImpl: typeof fetch = fetch): Transport {
  return async (method, args) => {
    const url = new URL(`operator/rpc/${encodeURIComponent(method)}`, base.href.endsWith("/") ? base : new URL(`${base.href}/`));
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ args }),
      });
    } catch (err) {
      throw new CliError(`Could not reach ${base.origin}: ${(err as Error).message}`);
    }
    const raw = await res.text();
    let parsed: any;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { error: raw.slice(0, 300) };
    }
    if (res.status === 404 && parsed?.error === "not_found") {
      return { status: 404, body: { error: "This deployment has no operator API (its CIVIC_OPERATOR_TOKEN is unset), or the method does not exist.", code: "not_found" } };
    }
    return { status: res.status, body: res.status === 200 && parsed && "result" in parsed ? parsed.result : parsed };
  };
}

// --- Arguments ---

interface Parsed {
  positional: string[];
  json: boolean;
  yes: boolean;
  as: string | null;
  notes: string | null;
  envFile: string | null;
}

export function parseArgs(argv: readonly string[]): Parsed {
  const p: Parsed = { positional: [], json: false, yes: false, as: null, notes: null, envFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new CliError(`${a} needs a value.`, 2);
      return v;
    };
    if (a === "--json") p.json = true;
    else if (a === "--yes" || a === "-y") p.yes = true;
    else if (a === "--as") p.as = value();
    else if (a === "--notes") p.notes = value();
    else if (a === "--env-file") p.envFile = value();
    else if (a === "--help" || a === "-h") p.positional.unshift("help");
    else if (a.startsWith("--")) throw new CliError(`Unknown option ${a}.`, 2);
    else p.positional.push(a);
  }
  return p;
}

/** key=value pairs; true/false/null and JSON arrays/objects are read as JSON. */
export function parsePairs(pairs: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const at = pair.indexOf("=");
    if (at <= 0) throw new CliError(`"${pair}" is not key=value.`, 2);
    const key = pair.slice(0, at).trim();
    const raw = pair.slice(at + 1);
    let value: unknown = raw;
    if (raw === "true" || raw === "false" || raw === "null" || /^[[{]/.test(raw.trim())) {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new CliError(`The value of ${key} is not valid JSON: ${raw}`, 2);
      }
    }
    out[key] = value;
  }
  return out;
}

// --- The catalog key ---

/** The signing key from CIVIC_CATALOG_SIGNING_KEY_FILE (or CIVIC_CATALOG_SIGNING_KEY), or null when neither is set. */
export function loadSigningKey(env: CliDeps["env"], production: boolean): SigningKey | null {
  const file = env.CIVIC_CATALOG_SIGNING_KEY_FILE?.trim();
  let value = env.CIVIC_CATALOG_SIGNING_KEY?.trim() || null;
  if (file) {
    if (!existsSync(file)) throw new CliError(`CIVIC_CATALOG_SIGNING_KEY_FILE names ${file}, which does not exist.`, 2);
    value = readFileSync(file, "utf8");
  }
  if (!value) return null;
  try {
    return parseSigningKey(value, production);
  } catch (err) {
    throw new CliError((err as Error).message, 2);
  }
}

/** Make a new key into `file` (owner-only, never over an existing file). */
export function newKeyFile(file: string): SigningKey {
  if (existsSync(file)) throw new CliError(`${file} already exists. A key is never overwritten: choose another file.`, 2);
  const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(file, pem, { mode: 0o600, flag: "wx" });
  return parseSigningKey(pem, false);
}

// --- Output ---

function table(rows: string[][]): string[] {
  if (rows.length === 0) return [];
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]))).join("  ").trimEnd());
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(none)";
  return typeof v === "string" ? v : JSON.stringify(v);
}

// --- Commands ---

interface Ctx {
  args: Parsed;
  io: CliIO;
  env: CliDeps["env"];
  actor: string;
  call<T = any>(method: string, ...args: unknown[]): Promise<T>;
  /** The URL is not this computer: a deployment, where the committed test key is refused. */
  remote: boolean;
  print(result: unknown, human: () => void): void;
  confirm(question: string): Promise<void>;
}

function need(value: string | undefined, what: string): string {
  if (!value) throw new CliError(`Name the ${what}. See: npm run operator -- help`, 2);
  return value;
}

async function findEntry(ctx: Ctx, ref: string): Promise<{ view: any; entry: any }> {
  const view = await ctx.call("catalog");
  const exact = view.entries.find((e: any) => e.id === ref);
  if (exact) return { view, entry: exact };
  const matches = view.entries.filter((e: any) => String(e.id).startsWith(ref));
  if (matches.length === 1) return { view, entry: matches[0] };
  if (matches.length === 0) throw new CliError(`No catalog entry's id starts with "${ref}". See: npm run operator -- catalog`);
  throw new CliError(`${matches.length} entries' ids start with "${ref}": give more of it.`);
}

function signFor(ctx: Ctx, entry: any, view: any): Signature | null {
  const key = loadSigningKey(ctx.env, ctx.remote);
  if (!key) {
    if (view.signing?.mode === "required") {
      throw new CliError("This deployment requires signed approvals: set CIVIC_CATALOG_SIGNING_KEY_FILE to your catalog key (npm run operator -- key new <file>).", 2);
    }
    ctx.io.err("No catalog key set: approving unsigned (this deployment does not require signatures).");
    return null;
  }
  if (view.signing?.key && view.signing.key.id !== key.id) {
    throw new CliError(
      `The hub trusts key ${view.signing.key.id}, not yours (${key.id}). Set the deployment's CIVIC_CATALOG_PUBLIC_KEY to ${key.publicKey} and redeploy.`,
    );
  }
  return signRow(entry, key);
}

function entryLine(e: any): string[] {
  return [
    String(e.id).slice(0, 8),
    `${e.package}@${e.version}`,
    e.status,
    e.signed ? "signed" : "unsigned",
    e.required ? "required" : "",
    e.matches_deployment ? "this deployment" : "",
  ];
}

const COMMANDS: Record<string, (ctx: Ctx, rest: string[]) => Promise<void>> = {
  async check(ctx) {
    const view = await ctx.call("catalog");
    const hubs = await ctx.call<any[]>("listHubs");
    const key = loadSigningKey(ctx.env, ctx.remote);
    const trusted = view.signing?.key ?? null;
    ctx.print({ hubs: hubs.length, signing: view.signing, your_key: key ? { id: key.id, public_key: key.publicKey } : null }, () => {
      ctx.io.out(`Reached the operator API: ${hubs.length} hub${hubs.length === 1 ? "" : "s"}.`);
      ctx.io.out(`Plugin signatures: ${view.signing?.mode ?? "unknown"}.`);
      ctx.io.out(`The hub trusts key: ${trusted ? trusted.id : "(none set)"}.`);
      if (view.signing?.problem) ctx.io.out(`The hub's key setting has a problem: ${view.signing.problem}`);
      if (!key) ctx.io.out("Your key: none set (CIVIC_CATALOG_SIGNING_KEY_FILE). Approving plugins needs one.");
      else if (trusted?.id === key.id) ctx.io.out(`Your key ${key.id} is the one the hub trusts.`);
      else ctx.io.out(`Your key ${key.id} is NOT trusted. Set the deployment's CIVIC_CATALOG_PUBLIC_KEY to ${key.publicKey} and redeploy.`);
      if (view.signing?.unsigned) ctx.io.out(`${view.signing.unsigned} approved entr${view.signing.unsigned === 1 ? "y is" : "ies are"} not signed by the trusted key${key && trusted?.id === key.id ? ": run sign-approved" : ""}.`);
    });
  },

  async hubs(ctx) {
    const hubs = await ctx.call<any[]>("listHubs");
    ctx.print(hubs, () => {
      if (hubs.length === 0) return ctx.io.out("No hubs yet. Make one: npm run operator -- create ...");
      for (const line of table([["ID", "NAME", "ADDRESS", "MODE", ""], ...hubs.map((h) => [h.id, h.name, h.hostname, show(h.mode), h.archived_at ? "archived" : ""])])) {
        ctx.io.out(line);
      }
    });
  },

  async hub(ctx, [id]) {
    const d = await ctx.call("hubDetail", need(id, "hub"));
    if (!d) throw new CliError(`No hub "${id}".`);
    ctx.print(d, () => {
      ctx.io.out(`${d.hub.name} (${d.hub.id})${d.hub.archived_at ? `, archived ${d.hub.archived_at}` : ""}`);
      for (const [k, v] of Object.entries(d.config)) ctx.io.out(`  ${k}: ${show(v)}`);
      ctx.io.out(`  admins: ${d.admins.join(", ") || "(none)"}`);
      ctx.io.out(`  plugins: ${d.plugins.map((p: any) => `${p.name} ${p.enabled ? "on" : "off"}`).join(", ")}`);
    });
  },

  async create(ctx, rest) {
    const form = parsePairs(rest);
    const input = await ctx.call("parseCreate", form);
    if (input.mode === "demo") ctx.io.err("Note: a demo hub turns off email verification for sign-in. Use mode=beta or mode=live for a real community.");
    ctx.io.out(`Create ${input.mode} hub "${input.name}" (${input.slug}) at ${input.hostname}, admins ${input.admins.join(", ")}.`);
    await ctx.confirm("Create it?");
    const made = await ctx.call("createHub", input, { allowedModes: ["demo", "beta", "live"], updatedBy: `console:${ctx.actor}` });
    const hubId = made.hub.id as string;
    const sample = input.sampleContent ? await ctx.call("seedSamples", hubId).catch((e: Error) => ({ error: e.message })) : null;
    const starter = await ctx.call("addStarterWordcloud", hubId, `console:${ctx.actor}`);
    const invites = await ctx.call("inviteAdmins", hubId, input.admins);
    ctx.print({ hub: made.hub, settings: made.settings, sample_content: sample, starter_wordcloud: starter, invites }, () => {
      ctx.io.out(`Made ${hubId}.`);
      if (sample && "error" in sample) ctx.io.out(`Sample content was not added: ${sample.error}`);
      if (starter && "error" in starter) ctx.io.out(`The starter word cloud was not added: ${starter.error}`);
      if (invites.message) ctx.io.out(invites.message);
      if (made.settings && Object.keys(made.settings).length) {
        ctx.io.out("Set on the deployment for this hub:");
        for (const [k, v] of Object.entries(made.settings)) ctx.io.out(`  ${k}=${v}`);
      }
    });
  },

  async config(ctx, [id, ...rest]) {
    const hubId = need(id, "hub");
    if (rest.length === 0) throw new CliError("Give the settings to change as key=value.", 2);
    const plan = await ctx.call("planConfig", hubId, parsePairs(rest));
    const keys = Object.keys(plan.changes);
    if (keys.length === 0) {
      ctx.print({ changes: {} }, () => ctx.io.out("Nothing to change."));
      return;
    }
    for (const k of keys) ctx.io.out(`  ${k}: ${show(plan.before[k])} -> ${show(plan.changes[k])}`);
    await ctx.confirm(plan.needs_step_up ? "This change is one the console asks a fresh code for. Apply it?" : "Apply?");
    const applied = await ctx.call("applyConfig", hubId, plan.changes, ctx.actor);
    ctx.print(applied, () => {
      ctx.io.out("Changed.");
      if (applied.message) ctx.io.out(applied.message);
    });
  },

  async admins(ctx, [id, ...emails]) {
    const hubId = need(id, "hub");
    if (emails.length === 0) {
      const d = await ctx.call("hubDetail", hubId);
      if (!d) throw new CliError(`No hub "${hubId}".`);
      ctx.print(d.admins, () => d.admins.forEach((a: string) => ctx.io.out(a)));
      return;
    }
    const plan = await ctx.call("planAdmins", hubId, { admins: emails });
    const added = plan.next.filter((e: string) => !plan.before.includes(e));
    const removed = plan.before.filter((e: string) => !plan.next.includes(e));
    if (added.length === 0 && removed.length === 0) {
      ctx.print({ admins: plan.next }, () => ctx.io.out("Nothing to change."));
      return;
    }
    if (added.length) ctx.io.out(`Add: ${added.join(", ")} (each is invited by email)`);
    if (removed.length) ctx.io.out(`Remove: ${removed.join(", ")}`);
    await ctx.confirm("Set these admins?");
    await ctx.call("setAdmins", hubId, plan.next, ctx.actor);
    const invites = added.length ? await ctx.call("inviteAdmins", hubId, added) : null;
    ctx.print({ admins: plan.next, invites }, () => {
      ctx.io.out(`Admins: ${plan.next.join(", ")}`);
      if (invites?.message) ctx.io.out(invites.message);
    });
  },

  async "sign-in-link"(ctx, [id]) {
    const url = await ctx.call<string>("hubSignInUrl", need(id, "hub"));
    ctx.print(url, () => ctx.io.out(url));
  },

  async export(ctx, [id]) {
    const hubId = need(id, "hub");
    await ctx.confirm(`Pack everything ${hubId} holds into a download (the link works for ten minutes)?`);
    const r = await ctx.call("exportHub", hubId, ctx.actor);
    ctx.print(r, () => {
      ctx.io.out(`${r.file_name}: ${r.rows} rows, ${r.images} images, ${r.size} bytes, fingerprint ${r.fingerprint}`);
      ctx.io.out(`Download until ${r.expires_at}:`);
      ctx.io.out(r.url);
    });
  },

  async archive(ctx, [id]) {
    const hubId = need(id, "hub");
    await ctx.confirm(`Archive ${hubId}? Its residents lose it until it is unarchived.`);
    await ctx.call("archive", hubId);
    ctx.print({ archived: hubId }, () => ctx.io.out(`Archived ${hubId}.`));
  },

  async unarchive(ctx, [id]) {
    const hubId = need(id, "hub");
    await ctx.confirm(`Unarchive ${hubId}?`);
    await ctx.call("unarchive", hubId);
    ctx.print({ unarchived: hubId }, () => ctx.io.out(`Unarchived ${hubId}.`));
  },

  async catalog(ctx) {
    const view = await ctx.call("catalog");
    ctx.print(view, () => {
      ctx.io.out(`Signatures ${view.signing.mode}; the hub trusts ${view.signing.key ? view.signing.key.id : "no key"}.`);
      if (view.entries.length === 0) return ctx.io.out("The catalog is empty.");
      for (const line of table([["ID", "PACKAGE", "STATUS", "SIGNED", "", ""], ...view.entries.map(entryLine)])) ctx.io.out(line);
    });
  },

  async approve(ctx, [ref]) {
    const { view, entry } = await findEntry(ctx, need(ref, "catalog entry"));
    if (entry.status === "approved") throw new CliError("This entry is already approved.");
    const signature = signFor(ctx, entry, view);
    ctx.io.out(`${entry.display_name} (${entry.package}@${entry.version}), fingerprint ${entry.hash}`);
    if (!entry.matches_deployment) ctx.io.out("  Note: this deployment does not run these exact files; approving changes nothing until it does.");
    for (const c of entry.grant?.can ?? []) ctx.io.out(`  can: ${c}`);
    for (const c of entry.grant?.cannot ?? []) ctx.io.out(`  cannot: ${c}`);
    await ctx.confirm("Approve it? Every hub on this deployment may then install it.");
    const r = await ctx.call("approveEntry", entry.id, ctx.actor, ctx.args.notes, signature);
    ctx.print(r.after, () => ctx.io.out(`Approved ${entry.package}@${entry.version}${signature ? `, signed with ${signature.signature_key}` : ", unsigned"}.`));
  },

  async withdraw(ctx, [ref]) {
    const { entry } = await findEntry(ctx, need(ref, "catalog entry"));
    await ctx.confirm(`Withdraw ${entry.package}@${entry.version}? This deployment stops mounting it.`);
    const r = await ctx.call("withdrawEntry", entry.id, ctx.actor, ctx.args.notes);
    ctx.print(r.after, () => ctx.io.out(`Withdrew ${entry.package}@${entry.version}.`));
  },

  async require(ctx, [ref, onOff]) {
    const { entry } = await findEntry(ctx, need(ref, "catalog entry"));
    if (onOff !== "on" && onOff !== "off") throw new CliError("Say on or off: require <entry> on|off", 2);
    await ctx.confirm(
      onOff === "on" ? `Require ${entry.package}@${entry.version}? Every hub on an older version is moved to it, without asking its admins.` : `Stop requiring ${entry.package}@${entry.version}?`,
    );
    const r = await ctx.call("setRequired", entry.id, onOff === "on");
    ctx.print(r, () => ctx.io.out(`${entry.package}@${entry.version} is ${onOff === "on" ? "required" : "no longer required"}${r.moved ? `; ${r.moved} hub${r.moved === 1 ? "" : "s"} moved` : ""}.`));
  },

  async "sign-approved"(ctx) {
    const view = await ctx.call("catalog");
    const key = loadSigningKey(ctx.env, ctx.remote);
    if (!key) throw new CliError("Set CIVIC_CATALOG_SIGNING_KEY_FILE to your catalog key.", 2);
    if (view.signing?.key?.id !== key.id) {
      throw new CliError(`The hub trusts ${view.signing?.key?.id ?? "no key"}, not yours (${key.id}). Set its CIVIC_CATALOG_PUBLIC_KEY to ${key.publicKey} and redeploy first.`);
    }
    const todo = view.entries.filter((e: any) => e.status === "approved" && (!e.signed || e.signature_key !== key.id));
    if (todo.length === 0) {
      ctx.print([], () => ctx.io.out("Every approved entry is signed by your key."));
      return;
    }
    for (const e of todo) ctx.io.out(`  ${e.package}@${e.version}`);
    await ctx.confirm(`Sign ${todo.length} approved entr${todo.length === 1 ? "y" : "ies"} with ${key.id}?`);
    const stored = await ctx.call<any[]>("storeSignatures", todo.map((e: any) => ({ id: e.id, ...signRow(e, key) })));
    ctx.print(stored, () => ctx.io.out(`Signed ${stored.length} of ${todo.length}.${stored.length < todo.length ? " The rest changed meanwhile: run it again." : ""}`));
  },

  async call(ctx, [method, ...raw]) {
    const name = need(method, "operator method");
    const args = raw.map((a) => {
      try {
        return JSON.parse(a);
      } catch {
        return a;
      }
    });
    const result = await ctx.call(name, ...args);
    ctx.io.out(JSON.stringify(result, null, 2));
  },
};

/** Run the command; answers the exit code. */
export async function runOperatorCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const { io } = deps;
  try {
    const args = parseArgs(argv);
    const [command, ...rest] = args.positional;
    if (!command || command === "help") {
      io.out(USAGE);
      return command ? 0 : 2;
    }
    const env = deps.env;

    if (command === "key") {
      const [sub, file] = rest;
      if (sub === "new") {
        const key = newKeyFile(need(file, "file to write the key to"));
        io.out(`Made catalog key ${key.id} in ${file} (only you can read it; keep a copy somewhere safe).`);
        io.out("Set this on the hub deployment, then redeploy:");
        io.out(`  CIVIC_CATALOG_PUBLIC_KEY=${key.publicKey}`);
        io.out("And here, for this command:");
        io.out(`  CIVIC_CATALOG_SIGNING_KEY_FILE=${file}`);
        return 0;
      }
      if (sub === "show") {
        const key = loadSigningKey(env, false);
        if (!key) throw new CliError("Set CIVIC_CATALOG_SIGNING_KEY_FILE to your catalog key.", 2);
        if (args.json) io.out(JSON.stringify({ id: key.id, public_key: key.publicKey }));
        else io.out(`${key.id}\nCIVIC_CATALOG_PUBLIC_KEY=${key.publicKey}`);
        return 0;
      }
      throw new CliError("key new <file> | key show", 2);
    }

    const run = COMMANDS[command];
    if (!run) throw new CliError(`No command "${command}". See: npm run operator -- help`, 2);

    const base = hubBase(env.CIVIC_OPERATOR_URL);
    const token = env.CIVIC_OPERATOR_TOKEN?.trim();
    if (!deps.transport && !token) throw new CliError("Set CIVIC_OPERATOR_TOKEN to the deployment's operator token.", 2);
    const transport = deps.transport ?? httpTransport(base, token!, deps.fetchImpl);
    const actor = args.as ?? env.CIVIC_OPERATOR_NAME?.trim() ?? safeUser();
    const ctx: Ctx = {
      args,
      io,
      env,
      actor,
      remote: !isLocalHost(base.hostname),
      async call(method, ...callArgs) {
        const res = await transport(method, callArgs);
        if (res.status !== 200) throw new HubRefused(method, res.status, res.body);
        return res.body;
      },
      print(result, human) {
        if (args.json) io.out(JSON.stringify(result, null, 2));
        else human();
      },
      async confirm(question) {
        if (args.yes) return;
        if (!(await io.confirm(question))) throw new CliError("Nothing changed.", 1);
      },
    };
    await run(ctx, rest);
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      io.err(err.message);
      return err.exitCode;
    }
    io.err(`Unexpected: ${(err as Error).stack ?? String(err)}`);
    return 1;
  }
}

function safeUser(): string {
  try {
    return `${userInfo().username || "operator"} (operator command)`;
  } catch {
    return "operator";
  }
}
