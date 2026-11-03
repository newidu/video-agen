# UI/UX redesign area

The current functional UI lives in `../index.html` and `../styles/base.css`.
Create the future redesigned UI in this folder without moving or rewriting the engine modules.

Integration contract:
- Preserve the element IDs used by the engine, or provide a compatibility layer.
- Load the engine script files in the same order shown in `../index.html`.
- Keep the agent, canvas, media, skills, playback, editor and tools logic in `src/`; do not duplicate it in UI code.
- Keep desktop-only APIs behind the Electron preload bridge when that wrapper is reintroduced.
