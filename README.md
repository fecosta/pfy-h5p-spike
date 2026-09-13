# PFY H5P Spike

A **disposable** technical spike answering one question:

> Can PFY use the Lumi H5P Node.js ecosystem to import and run its existing H5P
> content, author it, capture results, export packages, and support AI-assisted
> authoring — **without** making Lumi the PFY product domain?

**Answer: CONDITIONAL GO.** The evidence and the reasoning are in
**[`docs/SPIKE_RESULTS.md`](docs/SPIKE_RESULTS.md)** — start there.

This is not production code. It exists to retire risk and then be thrown away.

## Headline results

| | |
|---|---|
| Legacy WordPress packages imported | **185 / 185**, 0 failures, 16.6s |
| Activities rendered in a real browser | **202 / 202**, no console or network errors |
| Automated checks | 49 unit tests + 25 browser tests (Chromium + WebKit) |
| Package round-trip | Lumi → Lumi **and** Lumi → WordPress 7 + H5P 1.17.9 |
| Most important finding | h5p-server does **not sanitize params on import** → stored XSS; closed in the adapter (§11) |

## Layout

```
apps/h5p-runtime/       Express + @lumieducation/h5p-server. Owns everything H5P.
  src/adapter/          THE BOUNDARY — the only place Lumi concepts exist.
  src/api/              PFY-facing REST: activities, attempts, xAPI intake.
  scripts/              import, bulk probe, hub install, draft->H5P, security probe.
apps/web/               Next.js 16 / React 19. Embeds the player cross-origin.
packages/learning-contract/    PFY domain types. Contains zero Lumi types, by design.
packages/h5p-authoring-draft/  AI-friendly draft -> valid H5P.MultiChoice params.
e2e/                    Playwright specs — where most of the evidence comes from.
fixtures/               Real PFY content: gitignored, see fixtures/MANIFEST.md.
infra/wordpress/        Disposable WordPress + H5P, for the independent round-trip.
docs/SPIKE_RESULTS.md   The deliverable.
```

## The one rule this spike exists to test

```
PFY domain  →  H5P Adapter  →  Lumi runtime
```

`packages/learning-contract` — the PFY domain — contains **no Lumi or H5P types
at all**, and no Lumi content id, filesystem path or raw xAPI statement reaches a
PFY API response or a PFY URL. Lumi appears only where it must:
`apps/h5p-runtime/src/h5p/**` wires the runtime, `src/adapter/import.ts` imports
its types (type-only), and one client component in `apps/web` dynamically imports
the browser web components. The single identity compromise — a DOM attribute the
player component requires — is documented in `docs/SPIKE_RESULTS.md` §7.

Verify it:

```bash
grep -rn "lumieducation" packages/learning-contract/src/   # comments only
grep -rl "@lumieducation" apps packages --include="*.ts" --include="*.tsx"
```

## Running it

See the appendix of `docs/SPIKE_RESULTS.md` for the full sequence. The short version:

```bash
pnpm install
pnpm setup:core            # pinned H5P core + editor client files
pnpm fixtures:copy         # real fixtures, from the local corpus
pnpm dev:runtime           # :8080
pnpm dev:web               # :3000
pnpm test && pnpm e2e
```

## Conventions

Small and deliberate, since this is disposable: pnpm workspace, TypeScript,
vitest for units, Playwright for browser evidence, `node:sqlite` so there is no
native build step. No CI, no release process, no governance.

Fixtures are real course content and are never committed — this repo is public.
