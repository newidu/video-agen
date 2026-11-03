# AI Video Agent — Modular Source

This repository reorganizes the uploaded original `source.html` into a folder-based source tree while preserving its original engine logic and embedded skills. The original file is retained unchanged at `original/source.html` for traceability.

## What changed

- The original inline CSS is separated into `ui/styles/base.css`.
- The original HTML body is separated into `ui/index.html`.
- The JavaScript is split into ordered, classic-script files under `src/`.
- All 24 embedded skills are preserved as individual Markdown files under `skills/`.
- `src/skills/skill-manifest.js` is generated from those Markdown files and loaded before the agent.
- `ui/redesign/` is reserved for the next UI/UX redesign; it is separate from the engine.

## Folder structure

```text
original/source.html              Exact original upload (rollback/reference)
ui/index.html                     Separate UI document
ui/styles/base.css                Original inline stylesheet extracted unchanged
ui/redesign/                     Future UI/UX redesign boundary
src/skills/skill-manifest.js      Runtime skill registry (generated)
src/canvas/                      Canvas primitives and scene engine
src/editor/                       Editing, interaction, history and QA
src/features/                     Fonts, music, beats and SFX
src/agent/                         Agent session, tools, streaming, loop and spec bridge
skills/                            Original embedded skill pack as individual Markdown files
scripts/                           Build, serve and validation scripts
```

## Runtime loading order

`ui/index.html` loads the scripts in a deliberate order. They are **classic scripts**, not ES modules, because the original engine uses shared top-level `let`, `const` and function declarations across the single original script. Splitting them into separate `<script>` elements preserves that shared global lexical environment while keeping source files manageable. Do not add `type="module"` without a deliberate migration of the engine to modules.

1. Skill manifest
2. Canvas primitives
3. Scene/edit model and rendering
4. Editor interactions and project operations
5. Fonts
6. Music/audio/SFX
7. History and layout audits
8. Agent session and skill prompts
9. Tool implementations and schemas
10. Model streaming and context management
11. Agent loop
12. Spec bridge, media input and final boot

## Run locally

Requirements: Node.js 18+ (no third-party dependencies required for the core static app).

```bash
npm run build:skills
npm run check
npm run serve
```

Then open `http://127.0.0.1:4173/ui/`. A local HTTP server is recommended because browsers restrict some file APIs under `file://`.

## Skills

The source `window.SKILL_FILES` object and `window.SKILL_ORDER` are reproduced from the Markdown files by `scripts/build-skills.js`. The script checks every entry exists and emits `src/skills/skill-manifest.js`. The skills themselves were extracted from the original HTML and kept as Markdown files; their original order is in `skills/manifest.json`.

## Important architecture note

This is a **structural refactor**, not a behavioral rewrite. Engine code sections have been moved into sequential files without converting the shared-global architecture to ES modules. The original HTML is kept for side-by-side comparison. UI redesign is intentionally deferred to `ui/redesign/`.

The original source had a host-injected Cloudflare challenge script at the end. It is preserved only in `original/source.html`; it is not loaded by the new local UI document.
