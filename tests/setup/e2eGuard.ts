/**
 * Local only, unless asked. `.env` points at the hosted dev project, so a
 * bare run with nothing on :3000 used to start `npm run dev` from it and write
 * test data to dev. The pages and the API must be on this machine, and a
 * server Playwright starts itself gets the local stack's database (an
 * environment variable wins over `--env-file`). CIVIC_E2E_REMOTE=yes lifts
 * the check for a deliberate run elsewhere.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
export function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return LOCAL_HOSTS.has(host) || host.endsWith(".localhost");
}
export function refuseRemote(env: NodeJS.ProcessEnv): void {
  if (env.CIVIC_E2E_REMOTE === "yes") return;
  const bases = {
    CIVIC_E2E_BASE_URL: env.CIVIC_E2E_BASE_URL?.trim() || "http://localhost:5173",
    CIVIC_E2E_API_BASE: env.CIVIC_E2E_API_BASE?.trim() || "http://localhost:3000",
    CIVIC_API_BASE: env.CIVIC_API_BASE?.trim() || "http://localhost:3000",
  };
  for (const [name, url] of Object.entries(bases)) {
    if (!isLocal(url)) {
      throw new Error(`Playwright: ${name} is ${url}, not this machine. Set CIVIC_E2E_REMOTE=yes to run against it on purpose.`);
    }
  }
}
/** The Supabase CLI's local stack and its fixed, public service-role key (ci.yml). */
export const LOCAL_STACK = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
};
