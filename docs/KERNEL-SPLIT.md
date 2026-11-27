# Civic Hub on the split kernel

Civic Hub now runs on the Mosaic Space Kernel from its own repository,
[Mosaic-Foundation/mosaic-kernel](https://github.com/Mosaic-Foundation/mosaic-kernel). This is step 4 of the split
trial (the kernel repository's docs/SPLIT-TRIAL.md).

## How it works

`kernel.json` pins one kernel commit. `scripts/kernel-sync.mjs` lays the kernel's files at that commit into this
working tree, in the same places they always lived (`src/`, `ui/`, `kit/`, `packages/`, `features/`, `tests/`,
`supabase/migrations/`, `package.json` and the rest). Those files are git-ignored here. So every path, import, test
and plugin fingerprint is exactly what it was, and the kernel code has one home.

It runs before `npm ci` everywhere: in each CI job, in the Smoke workflow, and in Vercel's install command
(`vercel.json`). On a laptop, after cloning or after moving the pin:

```
node scripts/kernel-sync.mjs
npm ci
```

To work against a local kernel clone instead of downloading the pinned commit:

```
KERNEL_DIR=~/Developer/mosaic-kernel node scripts/kernel-sync.mjs
```

To check the tree still matches the pin (for example before a release):

```
node scripts/kernel-sync.mjs --check
```

## What this repository owns

The deployment slots in `kernel.json`. The kernel reads or imports them at fixed paths, and the sync never
overwrites them:

| Slot | What it is | Who reads it |
| --- | --- | --- |
| `config/` | The generated plugin, space type and palette files, the hubs, jurisdictions, legal pages | the kernel's `src/shared/*`, `src/plugins/*`, `ui/src/*` by relative path |
| `spaces/civic/` | The Civic Hub space type | `config/` and the seeds |
| `src/hosting/` | The outside services' implementations (Anthropic, Resend, Sentry, Supabase Storage, Polis...) | the kernel's `src/app.ts` (`installHosting`) and the operator's hub export |
| `api/`, `vercel.json` | The Vercel functions and routes | Vercel; `plugins:sync` writes the share-card routes into `vercel.json` |
| `supabase/config.toml` | The local Supabase stack's settings | CI and the local stack |
| `.github/` | This hub's CI, E2E and Smoke workflows | GitHub |

Plus everything only this repository has: the runbooks, the release and Vercel scripts, `HANDOFF.md`, and
`tests/unit/releaseCatalogGuard.test.ts`.

## Changing kernel code

Make the change in `mosaic-kernel`, merge it there, then move `commit` in `kernel.json` here and run the sync. An edit
to a laid-down file in this tree is overwritten by the next sync.

## Still to do (after the trial)

- The slots are a convention, not an interface: the kernel still reaches `config/` and `src/hosting/` by relative
  path. The workspace restructure (`kernel/`, `sdk/`, `ui/`, `plugins/*`) is where they become real inputs.
- `catalog:add` records this repository's commit and its "uncommitted" check looks at ignored files. For a plugin
  version it should record the kernel commit instead, which is a kernel change.
- Eight plugins still take feed labels from the Civic Hub space type.
