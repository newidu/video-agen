# Architecture and ownership

## Runtime layers

- **UI document** (`ui/index.html`): original DOM structure and stable element IDs. This is the view layer.
- **UI styling** (`ui/styles/base.css`): extracted original stylesheet. Later UX work belongs under `ui/redesign/`.
- **Canvas** (`src/canvas/`): drawing primitives, typography, edit model, scene construction and frame rendering.
- **Editor** (`src/editor/`): selection, pointer and keyboard interaction, panels, playback, export, persistence, undo/redo, scene operations and visual QA.
- **Features** (`src/features/`): font registration and music/beat/SFX support.
- **Agent** (`src/agent/`): credentials and chat session, skill use, tool registry/implementations, model streaming, context budget, tool loop and spec/media bridge.
- **Skills** (`skills/`): original skills as standalone Markdown resources.

## Why ordered classic scripts?

The source was authored as one classic inline script and has shared top-level bindings (for example `SPEC`, `EDIT`, `MUSIC`, `TOOL_IMPL`, and functions called across feature areas). Converting each file to an ES module would change scope and break direct references unless the whole engine were migrated to explicit imports/exports. This split therefore keeps standard script semantics and preserves execution order. A true ES module migration should be a separate tested change.

## Original-source mapping

Every extracted JS file starts with a comment recording the inclusive original line range from `original/source.html`. `original/source.html` remains the exact uploaded source for rollback and diffing.
