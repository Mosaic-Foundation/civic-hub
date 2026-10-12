// Type-check only (`npm run typecheck`, tsconfig.check.json). The unit tests
// import ui/src/config/hubConfig.ts, which reads Vite's `import.meta.env`; the
// backend config has no vite/client types, so declare the one shape it uses.
interface ImportMeta {
  readonly env: Record<string, string | undefined>;
}
