# Creative handoff

This handoff separates preserved creative evidence from approved product scope
and production implementation. The approved design specification, active
integration plan, and project snapshot remain authoritative when an archived
artifact makes a broader or older claim.

## Integration context and ownership

Task 1 began on branch `feature/creative-integration` at `d001ac6` in
`/Users/eugenezhou/Code/cipher-party/.worktrees/creative-integration`. That
integration plan is based on the reviewed Connected Classic runtime at
`fe264e3`. Gemini's creative implementation history remains available at
`main@128c0f79e8a4c7d0451443e22c8916822236f294`; the original main checkout and
its untracked E2E drafts were not edited.

Gemini/Antigravity owns the submitted concepts, prototypes, draft content, and
sample assets. Creative contributors should submit those materials together
with explicit decisions, using the template below. The coordinating agent owns
runtime integration, verification, acceptance bookkeeping, and
`docs/PROJECT_SNAPSHOT.md`. Contributors do not claim implementation by
updating prototypes or historical notes, and the coordinator does not silently
infer decisions from them.

The preserved Antigravity roots are inventoried in
[`creative/manifest.json`](../creative/manifest.json):

- `4e76b1e0-20d3-437b-a8bf-73fb82b1fc7b`: UI prototypes and historical design
  and scaffolding notes.
- `648bd5c6-d395-44e0-a80a-903c25e5c772`: word-list drafts, image-system
  references, and sample JPEGs.

[`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) and
[`SCAFFOLDING_HANDOFF.md`](SCAFFOLDING_HANDOFF.md) are exact imports from
`main@128c0f7`. They preserve provenance; labels such as “approved,”
“completed,” “production,” or “700 unique” inside them are historical
assertions, not current completion evidence.

## Approved direction versus experiments

The September 7 design amendment approves the Neo 8-Bit direction: warm word
cards, readable sans-serif card words, restrained pixel-style chrome, tactile
controls, and team identity communicated by color, glyph, pattern, and semantic
label. Server authority, role-safe projections, accessible interaction, and
mobile readability continue to take precedence over prototype behavior.

Task 1 preserves and documents that direction but does not port the prototype
UI. The reviewed runtime still implements the two-team, 5×5, single-board,
text-only Connected Classic boundary. Arcade presentation is a later integration
task.

The following remain experiments or later-milestone proposals unless a newer
approved plan says otherwise:

- Picture and mixed boards, Pack Studio, image uploads, and the image-card
  inspector.
- Three- and four-team play, campaigns, team switching, custom tokens, and
  audio systems.
- Claims about finished lifecycle coverage, production readiness, accessibility
  conformance, or zero-risk complexity in the imported notes.

## Content inventory

A table-row inventory of the preserved Markdown verifies:

- The core draft contains 200 entries and 200 internally unique labels.
- Each of the five expansion drafts contains 100 entries and 100 internally
  unique labels.
- The six packs contain 700 rows but 682 unique normalized labels in aggregate;
  18 rows repeat a label found in another pack.

Mixed pack selection must deduplicate normalized labels across every selected
pack before sampling. The current Worker runtime intentionally continues to use
its reviewed 50-word fixture; none of these drafts is a runtime pack yet.

The image gallery, generation recipes, and 12 JPEGs are asset-preparation
references. Their presence is not a license or production-use approval. In-app
AI remains limited to editable text suggestions in the MVP; image generation is
an external creative workflow.

## Where work belongs

- Immutable originals: `creative/source/<source-root-id>/`, with metadata in
  `creative/manifest.json`.
- Curated provenance and accepted decisions: `docs/CREATIVE_HANDOFF.md` and the
  approved spec/plan.
- Temporary browser review captures: an ignored test-results location named in
  the task report; never hidden-role or secret-bearing screenshots.
- Production React, CSS, and licensed/optimized assets: the appropriate
  `apps/web` source or public directory only after coordinator review and the
  milestone that consumes them.

Nothing under `creative/source/` is served, bundled, lint-fixed, or
format-rewritten. Several HTML files load remote development Tailwind and Google
Fonts resources, and several originals contain absolute browser-local paths.
They are references, not a portable application.

## Package workflow selection

The integration uses pnpm 11.23.0 and imports the reviewed npm lock's resolved
versions. Internal package references use `workspace:*`. The workspace keeps a
repository-relative `.pnpm-store`, and only `esbuild` and `workerd` have explicit
dependency build approval.

The selected Cloudflare test integration is the reviewed
`@cloudflare/vitest-plugin` 1.1.2 resolution with no patch and no
`cloudflare:test-internal` import. The Worker typecheck still includes
`apps/worker/test/tsconfig.json`. Any plugin upgrade must re-run that typecheck,
the full Worker suite, and release preflight; the historical
`cloudflare:test-internal` patch must be re-evaluated against the new upstream
package rather than carried forward automatically.

## Future creative submission template

### Purpose

What user problem or moment does this explore? Name the milestone and role.

### Preview

Provide a static public-data preview or a safe way to render it. List viewport
sizes and states shown; include no unrevealed ownership or credentials.

### Editable source

Provide the source file(s), tool/version, and any export steps. Keep originals
separate from generated exports.

### Assets

List every asset, dimensions, format, optimization status, and intended
production location.

### Usage and provenance notes

Record author/tool/model, creation date, source inputs, license or usage rights,
external runtime dependencies, and any attribution or review still required.

### Accessibility notes

Describe keyboard and focus behavior, text alternatives, motion/audio controls,
contrast observations, narrow-screen behavior, and what has actually been
tested. Do not substitute design intent for verification.

### Decisions

List each requested decision as accepted, rejected, or deferred, with the
approver and date. Call out conflicts with the current spec or milestone instead
of embedding silent scope changes in an artifact.
