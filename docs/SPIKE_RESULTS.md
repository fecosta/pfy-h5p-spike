# PFY H5P Runtime & Authoring Spike — Results

**Date:** 2026-09-12 · **Status:** complete · **Recommendation:** **CONDITIONAL GO**

---

## 1. Objective

Determine whether the Lumi H5P Node.js ecosystem can replace the WordPress H5P
installation PFY runs today — specifically whether PFY can import and run its
existing H5P content, author and edit content through a non-technical
experience, capture learning results reliably, export valid `.h5p` packages, and
support a future AI-assisted authoring layer, **without making Lumi the PFY
product domain**.

This is a disposable spike. It produces evidence and a recommendation, not
production code.

---

## 2. Environment and versions

| Component | Version |
|---|---|
| `@lumieducation/h5p-server` | **10.0.4** (npm `latest`, published 2025-03-08) |
| `@lumieducation/h5p-express` | **10.0.5** |
| `@lumieducation/h5p-webcomponents` | **10.0.4** |
| `@lumieducation/h5p-svg-sanitizer` | **10.0.4** |
| H5P core client (`h5p-php-library`) | commit `829524eaf81fe3f3a295d0e843812be4735f51fc` → reports **1.27.0**, coreApi **1.27** |
| H5P editor client (`h5p-editor-php-library`) | commit `80b3b281ee9d064b563f242e8ee7a0026b5bf205` |
| express | 4.21.2 (pinned exactly by `h5p-express@10.0.5`) |
| Next.js / React | 16.3.5 / 19.3.0 |
| Node / pnpm | 22.19.0 / 11.24.0 |
| Playwright | 1.63.0 (Chromium + WebKit) |
| WordPress verifier | WordPress 7 + plugin "Interactive Content – H5P" **1.17.9** |

All Lumi packages are **GPL-3.0-or-later**. See §16.

**Version context that shaped the choice:** upstream `master` is ~18 months
ahead of npm `latest` and carries an unreleased major (Node ≥22.12 floor,
express 5, core 1.28, magic-byte upload validation). The spike pinned the
published 10.0.x line deliberately, and the core/editor client files are pinned
to exactly the commits upstream's `v10.0.5` tag uses, so the runtime runs the
client code the library was released against.

---

## 3. Architecture used

```
PFY domain  (packages/learning-contract)        ← canonical, contains zero Lumi types
      ▲
      │  ActivityRef / Attempt / Result   (snake_case, mirrors pfy-platform)
      │
  H5P Adapter  (apps/h5p-runtime/src/adapter)   ← the only place Lumi appears
      │   contentMap.ts   PFY activity uuid ⇄ Lumi content id
      │   xapi.ts         xAPI statement → PFY outcome
      │   attempts.ts     append-only attempts, token-gated, idempotent
      │   mapping.ts      H5P behaviour → PFY behavior; WordPress id recovery
      ▼
  Lumi H5P runtime  (@lumieducation/h5p-server 10.0.4)
      libraries/ content/ temp/ user-data/ on the filesystem
```

Two processes, on purpose: `apps/h5p-runtime` (Express, :8080) owns everything
H5P; `apps/web` (Next.js, :3000) is the PFY-shaped consumer and talks to the
runtime only over HTTP.

**The boundary held**, with one documented exception (§7).

`packages/learning-contract` — the PFY domain — contains no Lumi or H5P types at
all; the only occurrences of the word "H5P" in it are explanatory comments. No
Lumi content id, filesystem path or raw xAPI statement appears in any PFY-facing
API response or any PFY URL.

Lumi imports are confined to where they are unavoidable: `src/h5p/**` (runtime
wiring), `src/adapter/import.ts` (type-only), and a single dynamically-imported
client component in `apps/web`. Two `api/routes.ts` endpoints return Lumi's own
player/editor *model* objects, because those feed Lumi's own web components;
they are keyed by PFY activity uuid and are labelled as such in the source.

The contract mirrors the model that already exists in `repos/pfy-platform`
(`packages/activity-engine`, `activity_attempts`), so spike output maps 1:1 onto
production: `score_raw`, `score_max`, `score_min`, `score_scaled`,
`pass_threshold`, `is_passed`, `is_completed`, `duration_seconds`, `verb`,
`attempt_number`, append-only.

One field was **added**: `score_provenance` (`server_authoritative` |
`client_reported`). See §8.

---

## 4. Content types tested

Imported and rendered across the whole corpus (21 distinct main libraries):

`H5P.TrueFalse` (46) · `H5P.Accordion` (29) · `H5P.DragQuestion` (20) ·
`H5P.MultiChoice` (17) · `H5P.Blanks` (17) · `H5P.ImageMultipleHotspotQuestion` (9) ·
`H5P.DragText` (7) · `H5P.Column` (7) · `H5P.ImageHotspots` (6) ·
`H5P.SortParagraphs` (5) · `H5P.Essay` (4) · `H5P.ImageSlider` (4) ·
`H5P.CoursePresentation` (3) · `H5P.Collage` (2) · `H5P.MarkTheWords` (2) ·
`H5P.MemoryGame` (2) · `H5P.FindTheWords` (1) · `H5P.InteractiveVideo` (1) ·
`H5P.MultiMediaChoice` (1) · `H5P.QuestionSet` (1) · `H5P.SingleChoiceSet` (1) ·
plus `H5P.DocumentationTool` (1, from a separate export).

Deep-tested fixtures (interaction, scoring, editing, export):

| Fixture | WP id | Why |
|---|---|---|
| `1-de-acordo-com-o-texto-…-141.h5p` | 141 | Multiple Choice, 2 of 4 correct, `singlePoint:false` |
| `4-encontre-no-texto-sinonimos-…-124.h5p` | 124 | Fill in the Blanks |
| `as-horas-em-portugues-196.h5p` | 196 | Drag and Drop, deepest editor-dependency chain |
| `escute-e-repite-audio-207.h5p` | 207 | image **and** audio (1 png + 26 audio files) |
| `quiz-question-set-7.h5p` | 7 | structurally complex, aggregate scoring, `passPercentage: 50` |
| `verdadeiro-ou-falso-a-85.h5p` | 85 | the corpus's most common type (25%) |
| `conectores_…_documentation_tool.h5p` | — | **ships no libraries at all** |

---

## 5. Import results

**185 / 185 legacy WordPress packages imported successfully. 0 failures.**
Total wall time 16.6s (~90 ms/package). Report: `apps/h5p-runtime/out/bulk-import-probe.md`.

Every one of the 21 content types imported at a 100% rate. This is a measurement
over PFY's entire real corpus, not a sample.

**Storage**, after importing everything (185 packages, 185 MB of archives):

| | |
|---|---|
| Installed libraries | **95 directories, 27 MB** |
| Content (params + assets) | **52 MB** |
| Layout | `h5p/libraries/<Machine.Name-major.minor>/`, `h5p/content/<contentId>/{h5p.json,content.json,assets}` |

Libraries deduplicate across packages, so 185 MB of archives becomes ~79 MB on disk.

**Identifiers.** Lumi's `FileContentStorage` generates a random 32-bit integer
content id — and returns it as a JavaScript `number` even though the type is
declared `string`. The adapter coerces once at the boundary.

**ID mapping.** Each import allocates a PFY activity `uuid`; the Lumi content id
is written only to the adapter-private `h5p_content_map` table. PFY URLs and API
responses use the uuid exclusively. The trailing integer in WordPress export
filenames (`…-141.h5p`) was **confirmed** to be the WordPress content id and is
recovered into `activities.legacy_h5p_content_id` — 177 of the imported
activities carry their WordPress provenance.

**Two export shapes exist and both are handled:**

1. *Self-contained* — all 185 corpus packages bundle their libraries, including
   the `H5PEditor.*` ones. They import with no network access at all.
2. *Library-less* — the DocumentationTool export (2,851 bytes) declares five
   dependencies and ships none. It failed with a clean, precise error
   (`install-missing-libraries`, listing all five). Installing
   `H5P.DocumentationTool` from the H5P Hub resolved all five and the import
   then succeeded.

**The H5P Hub works on 10.0.4's default endpoint.** `POST https://api.h5p.org/v1/content-types/`
returns 53 content types and the editor's content-type list populates
(`outdated: false`). The endpoint is **POST-only with a non-empty `uuid`** — a
GET, or a POST with an empty uuid, returns 404, which is easy to misread as a
dead endpoint. Setting a fixed `uuid` in config also stops Lumi re-registering
the site on every start.

---

## 6. Playback results

**All 202 activities rendered and reloaded with zero console errors and zero
failed network requests**, verified in a real Chromium via Playwright. Assets
resolve (no broken images), and every activity survives a reload.

This run happened *after* the library patch-upgrades described below, so it also
demonstrates that content authored against older patch levels still renders on
the upgraded libraries.

**Library patch drift is real but bounded.** During the 185-package import, **9
in-place patch upgrades** occurred (Lumi upgrades a library when a package
carries a higher patch version, and never downgrades):

| Package | Upgrade |
|---|---|
| `a-quais-perguntas-…-208.h5p` | `H5P.MultiChoice 1.16.6 → .12`, `H5P.Question 1.5.6 → .15` |
| `dialogo-6-149.h5p` | `H5P.Column 1.16.2 → .7` |
| `formas-de-dizer-…-150.h5p` | `H5P.OpenEndedQuestion 1.0.22 → .23`, `H5P.Table 1.1.17 → .18` |
| `ouca-as-apresentac-es-…-203.h5p` | `H5P.DragNBar 1.5.18 → .22`, `H5P.DragQuestion 1.14.9 → .20` |
| …and 2 more | |

Consequence: **import order changes which library code some content runs on.**
After a full batch the result is deterministic (everything converges to the
highest patch present), but an incremental import observed midway is not.
Different `major.minor` versions coexist correctly — 6 libraries are installed at
two minor versions simultaneously (e.g. `H5P.Question-1.4` and `-1.5`).

**Scoring is not universal.** 50 of 186 corpus packages (**27%**) can never emit
a score: `H5P.Accordion` (29), `H5P.ImageHotspots` (6), `H5P.ImageSlider` (4),
`H5P.Collage` (2), `H5P.DocumentationTool` (1), plus 8 `Column`/`CoursePresentation`
containers whose children are all non-scoring. Verified in the browser: the
ImageHotspots fixture renders and is interactive but presents no check/score
affordance at all. For that 27%, completion is the only available signal.

**Mobile (emulated).** Under an iPhone 13 profile on WebKit, six activities were
checked: no horizontal overflow (390 px viewport, 390 px scroll width) and zero
console errors. This is device *emulation*, not a physical device.

---

## 7. Authoring results

All three required flows work through the **stock H5P editor**, driven in a real
browser:

| Flow | Result |
|---|---|
| **Create** — pick content type → author → save → play | ✅ content type picker lists 53 types; authored MultiChoice saved and played |
| **Edit + reopen** — edit → save → reopen → verify persistence → play | ✅ change persisted and reloaded into the editor |
| **Legacy edit** — import WordPress package → visible change → save → play | ✅ opens directly into its own form, edit saved and played |

The editor UI renders **in Portuguese** ("Verificar", "Obter", "Usar") — both the
Hub and content-type strings.

**Identity leak (the one documented exception).** The player web component
matches its H5P instance with `h5pInstance.contentId == this.contentId`, where
`this.contentId` is the element's `content-id` attribute. It therefore **must**
hold Lumi's content id; a PFY uuid there silently prevents the `initialized`
event from ever firing. Resolution: PFY's uuid remains the address in the URL and
in every API call; the runtime id is fetched together with the player model and
used only to set that one DOM attribute. It never reaches PFY state or storage.

**Cross-origin embedding works.** The Next.js app on :3000 loads the player
served from :8080, plays it, and relays xAPI back — no CORS failures, no asset
404s. Two things were required and are not optional:

1. `@lumieducation/h5p-webcomponents` evaluates `class H5PPlayerComponent extends
   HTMLElement` at import time, so it must be imported inside an effect
   (`dynamic`/`import()` in the browser). Importing during SSR throws.
2. Lumi emits **relative** URLs for every asset and ajax endpoint
   (`/h5p/core/js/h5p.js`), which resolve against the *embedding* origin. There
   is no config for this — `baseUrl` also controls where routers mount — so the
   runtime rewrites the model to absolute URLs on the embed routes.

`@lumieducation/h5p-react` was deliberately not used: it declares `react: 18.3.1`
as a **hard dependency**, not a peer, so it would pull a second React into a
React 19 app. The web components carry no React at all.

**Embed type matters.** The entire legacy corpus declares `embedTypes: ["div"]`
and renders inline. Content created without specifying it defaults to
`["iframe"]` and renders inside an iframe — different CSS inheritance and height
behaviour. The AI transformer was changed to emit `["div"]` to match the corpus.

---

## 8. Tracking results

There is **no xAPI endpoint in `h5p-server` at all** — statements exist only in
the browser. The spike therefore implements the boundary itself: the player page
subscribes to `H5P.externalDispatcher`'s `xAPI` event and posts statements to
`/api/xapi` against a **server-issued attempt token** (not an attempt id, so a
client cannot post a result onto an arbitrary attempt).

All eight required behaviours are proven by automated browser tests:

| # | Behaviour | Evidence |
|---|---|---|
| 1 | Attempt starts | navigation allocates exactly one attempt, `attempt_number = last + 1` |
| 2 | Completion detected | `is_completed` flips on the top-level `completed`/`answered` statement |
| 3 | Score & max captured | `score_raw: 2`, `score_max: 2` on the legacy MultiChoice |
| 4 | Success/completion captured | `is_passed: true`, `verb: passed`; a wrong answer yields `0/2`, `is_passed: false`, `verb: failed` |
| 5 | Duration captured | ISO-8601 parsed (`PT12.5S` → 13 s); falls back to measured elapsed time |
| 6 | Second attempt distinct | new uuid, `attempt_number + 1`, its own result |
| 7 | First result preserved | attempt 1 unchanged after attempt 2 completes |
| 8 | Reload creates no duplicate | reloading the attempt URL twice leaves the attempt count and result identical |

Observed across the whole session: **1,311 raw statements captured, 25 accepted,
1,286 correctly ignored** —

| Ignored because | Count |
|---|---|
| verb is not `completed`/`answered` (`interacted`, `attempted`, …) | 1,264 |
| **sub-content statement** (has `context.contextActivities.parent`) | 14 |
| unknown/missing attempt token (rejected, 401) | 4 |
| attempt already completed (idempotent suppression) | 4 |

The sub-content filter matters: a question inside a QuestionSet or Column reports
its own completion, and counting those would complete the attempt on the first
sub-question.

**Attempt isolation.** Each attempt is rendered with its own `contextId`, so
Lumi's `contentUserData` state is per-attempt and attempt 2 does not resume
attempt 1's answers.

**Lumi's own completion channel cannot distinguish attempts.** `POST /h5p/finishedData`
carries only `contentId, score, maxScore, opened, finished, time` — no
`contextId`, no attempt id, and `IFinishedUserData` has no field for one. The
spike closes the gap by appending the attempt token to the page's
`H5PIntegration.ajax.setFinished` URL and intercepting the POST: **21 completion
posts captured, 19 attributed to a specific attempt**. Both channels agree on
score/maxScore; only the xAPI channel carries `success` and `duration`.

**The trust model changes, and this is the most important tracking finding.**
`pfy-platform` scores server-side: the client posts `response_data` and
`ScorerRegistry` recomputes the score. `ScorerRegistry` has no `h5p` entry, and
it cannot get one without reimplementing each content type's grading logic in
PHP. H5P scores in the browser and reports the result. Results from H5P
activities are therefore **client-reported**, which is why `score_provenance` was
added to the contract rather than quietly mixing the two.

---

## 9. Round-trip results

**Lumi → Lumi:** export `/h5p/download/:contentId` produced a 768 KB package with
158 entries and 9 library directories. Asserted structurally by unzipping in
Node, not by eyeballing the UI:

- `h5p.json` and `content/content.json` present
- `mainLibrary` and `title` preserved; main library listed in `preloadedDependencies`
- libraries written at the archive **root** (`H5P.MultiChoice-1.16/…`), which is
  the correct `.h5p` layout
- scoring behaviour intact: 4 answers, 2 correct, `singlePoint: false`, `passPercentage: 100`
- reimported into the runtime as a distinct activity, rendered, and **scored 2/2**
- both copies remain independently playable

**Media round-trip:** the image+audio fixture exported with **1 image and 26
audio files**, all non-empty.

**Lumi → WordPress (independent implementation):** a disposable WordPress 7 +
H5P 1.17.9 container, with its Hub **disabled**, accepted both exported packages
through the normal admin upload and rendered them:

- the MultiChoice package plays and shows its Portuguese prompt
- the media package plays and its images load (`naturalWidth > 0`)
- WordPress installed **13 libraries** from the uploaded packages alone,
  including the `H5PEditor.*` ones, so the content is editable there too
- the DB shows the libraries at the patch levels Lumi had installed
  (`H5P.MultiChoice 1.16.12`, `H5P.Question 1.5.15`) — exports carry the
  exporting server's patch levels, not the original package's

The production PFY WordPress site and database were never touched.

---

## 10. AI-assisted authoring proof of concept

Implemented as `packages/h5p-authoring-draft`, isolated from the runtime (a pure
function with unit tests; nothing in the runtime path depends on it).

```
PFY authoring draft (YAML, zod-validated)
        ↓  deterministic transformer
valid H5P.MultiChoice params + metadata
        ↓  H5PEditor.saveOrUpdateContent
editable H5P content, status = draft
        ↓  human opens the stock editor, revises, saves
published activity that plays and scores
```

**No LLM is called.** A fixture stands in for model output, because the
transform is what needed proving, not the generation. This also keeps
credentials, cost and prompt orchestration out of the spike entirely.

Verified end to end in the browser: the generated activities exist as `draft`
(never auto-published), open in the **real** editor with every field populated
(question, both answers), accept a human revision that persists, play, and score
`1/1` through the same tracking path as any other activity. The Portuguese UI
strings the transformer emits reach the learner, including the accessibility
labels.

Transform details that are easy to get wrong and are covered by tests:
`overallFeedback` must be a **flattened array** (H5P collapses single-child
groups); feedback ranges are inclusive percentages that must tile 0–100 with no
gap; draft prose is HTML-escaped rather than trusted as markup; and
`mainLibrary`/`preloadedDependencies` are deliberately **omitted** because
`saveOrUpdateContent` recomputes and overwrites them (only `title` is actually
required).

**Lumi's own AI editor is not a dependency candidate.** `Lumieducation/Lumi-AI-Editor`
(MIT) is a 21-commit prototype, last touched 2026-04-12, unpublished to npm,
hard-coded to German, pinned to stale library versions, exporting
fill-in-the-blanks and free-text blocks as static text, and it does not use
`h5p-server` at all. Useful as a reference for the "LLM → content.json → package"
shape; not something to adopt.

---

## 11. Security observations

Probes were run against the **real** import path with nothing disabled
(`pnpm --filter @spike/h5p-runtime probe:security`). The probe deletes whatever
it manages to import, so no hostile content is left behind in the environment.

| Probe | Result |
|---|---|
| `.php` inside `content/` | **rejected** — `not-in-whitelist` |
| `.svg` inside `content/` | **rejected** — SVG is deliberately absent from `contentWhitelist` |
| `.html` inside `content/` | **rejected** — `not-in-whitelist` |
| bundled library shipping `backdoor.php` | **rejected** — `not-in-whitelist` |
| zip path traversal (`../escaped.txt`) | **rejected** — but surfaces as an unhandled **HTTP 500** with a raw `Relative path: …` message rather than a clean 4xx |
| `<script>` / `<img onerror>` inside content **params** | **IMPORTED VERBATIM AND EXECUTES** ⚠️ |

### ⚠️ Stored XSS via the import path

A package whose `content.json` contains `<script>alert(1)</script>` or
`<img src=x onerror=…>` imports successfully, is stored **unmodified**, and the
payload **executes in the learner's browser** when the activity is played
(confirmed: both the script tag and the `onerror` handler fired).

The same payload saved through the **editor** *is* sanitized — after one editor
save the stored params contain inert text. So:

- `H5PEditor.saveOrUpdateContent` → `ContentStorer` → `SemanticsEnforcer` →
  `sanitize-html`: **sanitized**
- `PackageImporter.addPackageLibrariesAndContent` (the migration/upload path):
  **not sanitized**

Upstream describes `SemanticsEnforcer` as *"very incomplete and mostly only a
stub"* and validates only `text` and `library` semantic types. This is a real
gap, not a misconfiguration. Mitigations, in order of preference: sanitize params
in the adapter on import; restrict import to trusted operators; or re-save
imported content through the editor pipeline. PFY's own 185 packages are
first-party and contain no such payloads, so migration is safe — but **any
future "upload a .h5p" feature is not**.

### Other observations

- **Uploading a package installs libraries**, which means shipping third-party
  JavaScript to every learner. Upstream is explicit that library files are never
  sanitized or malware-scanned, by design. The "temporary" import mode is only
  temporary for *content files* — libraries it installs are permanent and global.
- **The default permission system allows everything.** Omitting
  `options.permissionSystem` silently installs `LaissezFairePermissionSystem`,
  whose every check returns `true` — an unauthenticated, world-writable library
  installer. The spike wires an explicit permission system instead (authors may
  install libraries and upload media; learners may only view, and may only touch
  their own user data).
- **Library administration routes are not mounted** by default here. They
  install, restrict and delete libraries with no authentication of their own;
  they are opt-in behind `SPIKE_ENABLE_LIBRARY_ADMIN=1`.
- **The SVG sanitizer is wired but is belt-and-braces**: SVG is not in
  `contentWhitelist`, so content SVGs are rejected before sanitization. Library
  SVGs are never sanitized — by design, since library authors can already ship JS.
- **10.0.4's `contentWhitelist` is broad** — it still permits `swf`, `docx`,
  `pdf`, `xml`, `rtf`. Upstream `master` has already narrowed it substantially.
  Narrowing it is safe for PFY: the corpus uses only `json`, `png`, `jpg`, `m4a`
  and `mp3`.
- **10.0.4 has no magic-byte content validation.** The `contentFileValidation`
  layer (which sniffs real file types and blocks `<script>`/`<svg>`/`<html>`
  disguised by extension) exists only on `master`.
- **No CSRF protection is configured.** `UrlGenerator` supports token injection
  (`protectAjax`, `protectContentUserData`, `protectSetFinished`); the spike does
  not use it because it has no authentication to protect.
- **WordPress's H5P plugin offers "Disable file extension check"**, warning it
  allows uploading PHP files. Relevant to the current installation, not to Lumi.

No security mechanism was disabled to make any fixture work.

---

## 12. Usability observations

**This is an engineering usability assessment, not consultant testing.** No
pedagogical consultant participated. Everything below is what an engineer
observed while driving the editor.

Working well:
- The editor is fully localized to Portuguese, including Hub tiles and content-type names.
- Choosing a content type is a single click on a visual tile; 53 types are listed.
- Legacy WordPress content opens straight into its own editing form.
- Saving navigates directly to the playable result, which is a good review loop.

Friction a non-technical author would hit:
- **The editor is an iframe, and the Save button lives outside it.** Save is
  visually detached from the form it saves.
- **A title is mandatory but non-obvious.** H5P refuses to save without one
  (`isMainTitleSet`), and the field sits apart from the content fields.
- **The "Usar" (Use) button next to a content-type tile is `aria-hidden` and
  never visible** — the tile itself is the control. A keyboard or screen-reader
  user would struggle here.
- **Duplicate accessible names**: two "Metadata" buttons and two "Title" labels
  can be present simultaneously (main form + metadata popup).
- **A localStorage draft-restore feature** can make a fresh "new content" form
  appear pre-filled with a previous session's data — confusing, and a source of
  accidental publication.
- **Error messages are H5P error ids**, not sentences a consultant can act on.
- Rich-text fields are inline CKEditor instances whose behaviour differs from
  ordinary inputs (documented in the test helpers, which had to work around it).

**Verdict:** the stock editor is usable by a technically confident author and is
*not* ready for a non-technical pedagogical consultant without a PFY wrapper —
at minimum: guided content-type selection, a title-first flow, Portuguese error
messages, and an explicit draft/publish state.

**Still needs human validation:** whether consultants can complete a realistic
authoring task unaided; whether media upload and feedback configuration are
discoverable; error recovery; and whether the iframe editor is workable on the
devices consultants actually use.

---

## 13. Known Lumi limitations encountered

1. **No xAPI endpoint** anywhere in `h5p-server`; statements exist only client-side.
2. **`setFinished` cannot distinguish attempts** — no `contextId`, no attempt id
   in the payload or the interface.
3. **`completionTime` is effectively never populated** on the xAPI-derived path;
   duration must come from the statement or be measured.
4. **The import path does not sanitize params** (§11).
5. **`enableHubLocalization: true` crashes without a translation function** —
   `TypeError: Cannot read properties of undefined` from
   `ContentTypeInformationRepository.localizeHubInfo`, not a graceful fallback.
6. **Portuguese server translations are `pt` only.** `pt_BR.json` exists for just
   2 of 9 namespaces, and the underscore filename never matches the `pt-BR`
   language tag i18next requests, so those files are dead and everything falls
   back to `pt`.
7. **Relative asset URLs** with no configuration switch for cross-origin embedding.
8. **The web component couples `content-id` to Lumi's content id** (§7).
9. **`PackageImporter` is not exported** from the package index; it is reachable
   only via `h5pEditor.packageImporter`.
10. **Caller-supplied content ids** work only through a method marked
    `@deprecated`; `saveOrUpdateContent` rejects unknown ids.
11. **`FileContentStorage` returns a `number`** where the type says `string`.
12. **Temporary files are never cleaned up automatically** — the host must
    schedule `TemporaryFileManager.cleanUp()`.
13. **Path traversal is blocked but returns HTTP 500** with a raw message.
14. **npm `latest` is 18 months behind `master`**, which carries an unreleased
    major.

---

## 14. Unresolved risks

| Risk | Severity | Notes |
|---|---|---|
| Stored XSS on the import path | **High** | Must be closed before any non-operator upload path exists |
| Import order changes library patch levels | Medium | Deterministic after a full batch; pre-normalizing libraries would remove it entirely |
| 27% of legacy content cannot report a score | Medium | Product decision: what "done" means for non-scoring activities |
| Client-reported scores for H5P activities | Medium | Different trust model from PFY's existing server-side scorers |
| GPL-3.0 across the whole Lumi stack | Medium | Drives process separation (§16); not legal advice |
| 2 legacy activities embed YouTube; 1 demo references remote video | Low–Medium | External runtime dependency outside PFY's control |
| Pinned to a release 18 months old | Medium | Upgrading to the coming major means Node ≥22.12, express 5, core 1.28 |
| Editor UX for non-technical consultants | Medium | Needs a PFY wrapper and real consultant testing |
| `subContentId` stability across re-import | Low | Not verified; matters only if per-question history is joined across re-imports |
| Largest legacy asset is 13.84 MB vs a 16 MB default limit | Low | One re-upload away from failing |

---

## 15. Recommendation — **CONDITIONAL GO**

The core approach works, and it works on PFY's *real* content rather than on
samples: 185/185 packages import, 202 activities render cleanly, authoring and
legacy editing work in the stock editor, packages round-trip through an
independent WordPress installation, results normalize into PFY's existing
contract, and the PFY domain stayed free of Lumi concepts throughout.

It is not an unconditional GO because of bounded, quantified issues:

1. **Close the import-path XSS gap** before exposing any upload path beyond
   trusted operators. Sanitize params in the adapter on import. *(Required.)*
2. **Decide the completion semantics for the 27%** of content that cannot score.
   `score_provenance` and a nullable score are in the contract; the product rule
   is not. *(Required.)*
3. **Accept client-reported scoring for `activity_type = 'h5p'`**, with the
   attempt-token channel and raw-statement retention as the audit trail.
   *(Required.)*
4. **Pre-normalize libraries** (install the highest patch of each `major.minor`
   once, then import content) so migration is order-independent. *(Recommended.)*
5. **Wrap the editor** for pedagogical consultants, and validate with real
   consultants. *(Required before consultant rollout, not before a GO.)*
6. **Keep Lumi in its own process** for both architectural and licensing reasons.
   *(Required.)*

Nothing found is structural. There is no material incompatibility with PFY
content, result capture is reliable, authoring works, the package round-trip
works, and PFY's domain model demonstrably does not need to bend around Lumi.

---

## 16. Recommended production architecture implications

**Keep the runtime as a separate service.** PFY's API is Laravel/PHP and every
Lumi package is **GPL-3.0-or-later**; running Lumi as its own Node service that
PFY calls over HTTP is both the natural topology and the clean licensing
position. (Observation for engineering planning, not legal advice.)

**Own the adapter, not the runtime.** `contentMap`, `xapiToResult`, `attempts`
and `mapping` are ~600 lines and are the part PFY should treat as product code.
The runtime itself is replaceable.

**Identity.** PFY activity `uuid` stays the only identifier in PFY's model, URLs
and API. The Lumi content id belongs in one adapter-owned mapping table.
`activities.legacy_h5p_content_id` already exists and should be populated from
the export filename during migration.

**Tracking.** Attempts are created server-side and handed a token; the browser
posts statements against that token; the adapter normalizes and writes
append-only rows; raw statements are retained for audit. Add CSRF tokens via
`UrlGenerator` once real authentication exists, and enforce download and
import authorization in PFY middleware — `PackageExporter` falls back to a
permissive permission system.

**Migration shape.** Pre-normalize libraries, then import content packages, then
verify by rendering every activity (the spike's playback check is a reusable
migration gate). Budget roughly 80 MB of storage for the current corpus and
~90 ms per package.

**Security posture.** Explicit permission system (never the default), library
installation restricted to operators, library administration routes unmounted or
admin-only, `contentWhitelist` narrowed toward `master`'s list, SVG sanitizer
wired, params sanitized on import, and the H5P surface served from its own origin
so a malicious library cannot reach PFY's cookies or storage.

**Version strategy.** Stay on 10.0.x until the next major is published, then
evaluate the upgrade deliberately (Node ≥22.12, express 5, core 1.28, magic-byte
upload validation — which would also close part of §11).

---

## Validation matrix

| Capability | Required | Result | How verified |
|---|---|---|---|
| Import existing `.h5p` | Yes | ✅ **185/185** | automated (bulk probe) |
| Render without WordPress | Yes | ✅ 202/202, no console/network errors | automated (Playwright) |
| Activity assets load | Yes | ✅ images/audio load; no broken media | automated |
| Completion captured | Yes | ✅ | automated |
| Score captured when provided | Yes | ✅ 2/2 and 0/2 cases | automated |
| Multiple attempts retained | Yes | ✅ distinct attempts, first preserved | automated |
| Reload behaviour validated | Yes | ✅ no duplicate completion | automated |
| Create new H5P | Yes | ✅ | automated |
| Edit new H5P | Yes | ✅ persists across reopen | automated |
| Edit imported legacy H5P | Yes | ✅ | automated |
| Save/reopen editor | Yes | ✅ | automated |
| Export `.h5p` | Yes | ✅ structure asserted by unzipping | automated |
| Reimport exported package | Yes | ✅ renders and scores | automated |
| AI draft → editable H5P | PoC | ✅ draft → editor → play → score | automated |
| Mobile/responsive check | Yes | ✅ **emulated** iPhone 13 (WebKit) | automated |
| Independent environment (WordPress) | Where practical | ✅ WP 7 + H5P 1.17.9 | automated (Playwright) |
| Consultant usability test | Optional | ❌ **not performed** | — |

**Automated:** 42 unit tests (vitest) + 23 browser tests (Playwright, Chromium +
WebKit) + the 185-package import probe + the security probe.
**Manual:** none of the claims above rest on manual inspection.
**Not done:** physical-device mobile testing, consultant usability testing,
penetration testing, load/performance testing, and any verification of the
`subContentId` stability question.

---

## Appendix — setup and run

```bash
# prerequisites: Node >=22, pnpm, Docker (only for the WordPress check)
pnpm install
pnpm setup:core                 # downloads the pinned H5P core + editor client files
pnpm fixtures:copy              # copies the selected legacy fixtures out of the local corpus

# runtime (:8080) and web (:3000)
pnpm dev:runtime
pnpm dev:web

# import legacy content
pnpm import -- fixtures/sample-h5p/1-de-acordo-com-o-texto-e-possivel-afirmar-que-141.h5p
pnpm hub:install -- H5P.DocumentationTool          # for packages that ship no libraries
pnpm probe:bulk-import -- <dir-with-185-h5p-files> # full compatibility matrix

# AI-draft proof of concept
pnpm create:from-draft

# checks
pnpm type-check
pnpm test                       # 42 unit tests
pnpm e2e                        # 23 browser tests (starts the runtime if needed)

# WordPress round-trip
pnpm wp:up
docker compose -f infra/wordpress/docker-compose.yml exec -T cli \
  wp core install --url=http://localhost:8090 --title="H5P Verifier" \
  --admin_user=admin --admin_password=admin --admin_email=a@b.invalid --skip-email
docker compose -f infra/wordpress/docker-compose.yml exec -T cli wp plugin install h5p --activate
pnpm e2e:wp
pnpm wp:down                    # removes containers AND volumes

# security probe
pnpm --filter @spike/h5p-runtime probe:security
```

Fixtures are real PFY course content and are **not** committed; `fixtures/copy-fixtures.sh`
copies them from a local corpus path (override with `PFY_H5P_CORPUS`).
