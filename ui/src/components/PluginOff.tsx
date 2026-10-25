// What a route of a switched-off plugin renders instead of its page
// (config/plugins.ts whenPlugin).

export function PluginOff() {
  return (
    <main className="page-container" style={{ padding: "48px 16px", textAlign: "center" }}>
      <h1>Page not found</h1>
      <p>This hub does not offer this.</p>
      <p>
        <a href="/">Back to the home page</a>
      </p>
    </main>
  );
}

