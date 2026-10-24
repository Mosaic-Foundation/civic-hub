// The /rest/v1 path in front of a bare PostgREST (docs/RUN-ANYWHERE.md).
//
// The hub's database client (supabase-js) addresses PostgREST at
// <SUPABASE_URL>/rest/v1/…, which is where a Supabase project serves it. A
// bare PostgREST serves at its root. This forwards /rest/v1/<rest> to
// <upstream>/<rest>, unchanged otherwise, so the hub runs against plain
// Postgres + PostgREST with no Supabase in between. A self-hoster can do the
// same in nginx or Caddy (a path rewrite) instead.
//
//   node scripts/run-anywhere/rest-proxy.mjs <listen port> <upstream origin>

import http from "node:http";

const [port = "54321", upstream = "http://127.0.0.1:3010"] = process.argv.slice(2);
const target = new URL(upstream);

http
  .createServer((req, res) => {
    const path = req.url ?? "/";
    if (!path.startsWith("/rest/v1")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: `only /rest/v1 is served here, not ${path.split("?")[0]}` }));
      return;
    }
    const forwarded = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        method: req.method,
        path: path.slice("/rest/v1".length) || "/",
        headers: { ...req.headers, host: target.host },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    forwarded.on("error", (err) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: `PostgREST unreachable: ${err.message}` }));
    });
    req.pipe(forwarded);
  })
  .listen(Number(port), () => console.log(`[rest-proxy] :${port}/rest/v1 → ${target.origin}`));
