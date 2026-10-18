# Codesigner architecture

Codesigner is a desktop design tool that feels like Framer but edits a **real SvelteKit app's source code**. The canvas shows the actual app, running in its own dev server, logged in like a normal user. Every visual edit becomes a small edit to `.svelte` or `.css` files, which flows back to the canvas through Vite HMR. Version control is built in: by default you design on a branch in its own git worktree, so `develop` and `main` are never touched until you ship.

Research behind every decision lives in [`docs/research/`](research/):

| Report | Topic |
|---|---|
| [01-desktop-shell](research/01-desktop-shell.md) | Electron vs Tauri, embedding with webviews and auth, packaging, updates, processes, i18n |
| [02-code-sync-engine](research/02-code-sync-engine.md) | DOM ⇄ source mapping, surgical `.svelte` edits, the Tailwind v4 design system API, tokens, HMR loop |
| [03-agents-and-comments](research/03-agents-and-comments.md) | Claude / Codex / Cursor through ACP, the MCP server, checkpoints, comment anchoring |
| [04-framer-ui-spec](research/04-framer-ui-spec.md) | Framer's editor UI, panels, controls and shortcuts, plus the keep / adapt / drop mapping |

## The big picture

```
┌─────────────────────────────── Electron app ───────────────────────────────┐
│                                                                            │
│  Editor UI (SvelteKit 3 SPA, Tailwind 4, Paraglide i18n)                   │
│  ┌────────────┬──────────────────────────────────────────┬──────────────┐  │
│  │ Pages      │  Canvas (CSS translate/scale)            │ Agent  Style │  │
│  │ Layers     │   ┌ Desktop 1200 ┐ ┌ Tablet ┐ ┌ Phone ┐   │              │  │
│  │ Assets     │   │ <webview>    │ │        │ │       │   │              │  │
│  │            │   └──────────────┘ └────────┘ └───────┘   │              │  │
│  └────────────┴──────────────────────────────────────────┴──────────────┘  │
│        ▲ window.codesigner (typed IPC)        ▲ webview.send / sendToHost  │
│        │                                      │                            │
│  Main process (Node)                    Bridge (in each webview)           │
│  • project detection, routes            • preload relays messages          │
│  • dev servers per working copy         • main-world script reads          │
│  • git worktrees, checkpoints             __svelte_meta, hit-tests,        │
│  • engine: AST edits, Tailwind,           builds the layer tree,           │
│    tokens, undo journal                   previews classes optimistically  │
│  • (later) ACP agents + MCP server                                         │
└────────────────────────────────────────────────────────────────────────────┘
                 │ spawns                          ▲ http://localhost:53xx
                 ▼                                 │
        user's dev server (`bun run dev --port …`) ─┘   per branch / worktree
```

## Key decisions

1. **Electron, not Tauri.** We need a Node toolchain anyway (Svelte compiler, Tailwind's design system, git, agent CLIs). Chromium on every OS gives the same rendering as the browser your users have. Tauri's multi-webview is still unstable and its child webviews can't be CSS-transformed.
2. **Canvas frames are `<webview>` tags sharing `partition="persist:preview"`.** Each frame is a top-level browsing context, so `SameSite=Lax` auth cookies (Supabase, Lucia, Auth.js…) are first-party. You log in once, and every frame and every branch (any localhost port) is logged in, even after a restart. Webviews are DOM elements, so the canvas can pan and zoom with CSS transforms. Zoom never uses `setZoomFactor`, which would change the layout viewport and break breakpoints.
3. **DOM → source via Svelte's dev metadata.** In dev, Svelte 5 attaches `__svelte_meta = { loc, parent }` to every element. `loc` is the element's own `file:line:column`. `parent` is the chain of component, each, if and render frames, so a click on a shadcn `<button>` leads to the `<Button>` usage in your page. **No IDs are ever written into your files.**
4. **The bridge runs in the page's main world.** The webview preload runs in an isolated world and can't see `__svelte_meta`. It injects the bridge into the main world with `webFrame.executeJavaScript` and relays messages to the host with `sendToHost`. This needs no change to the user's `vite.config`, and works with whatever `dev` script the project uses (`bun --bun vite dev`, …).
5. **Surgical edits: `svelte/compiler` `parse({ modern: true })` + `magic-string`.** Only the exact byte ranges change: class tokens, attribute values, text, element ranges for wrap, move and delete. The rest of the file keeps its formatting, comments and indentation. Prettier never runs implicitly.
6. **Tailwind through the project's own design system.** `@tailwindcss/node`'s `__unstable__loadDesignSystem(app.css)` validates classes, tells us which CSS properties a class sets (for conflict removal), orders classes canonically, and generates preview CSS for classes the page hasn't compiled yet. tailwind-merge misclassifies custom tokens.
7. **Design tokens are the CSS variables in your stylesheet.** `:root`, `.dark` and `@theme` are read and written with PostCSS (byte-identical round trip). Editing a token changes one line, and CSS HMR updates the canvas without remounting.
8. **Version control.** Default mode: a design branch `design/<name>` in a git worktree under `~/.codesigner/worktrees/…`, with its own dev server and a copy of your `.env*` files. Edits are checkpointed silently; you "Ship" by merging or opening a PR. Optional per-project mode: edit the current checkout directly.
9. **Comments live in the repo** (`.codesigner/comments/*.json`), anchored by source location, DOM signals, route and viewport, so teammates and any coding agent can read them.
10. **Agents through ACP (Agent Client Protocol).** One client integration covers Claude (via the official `claude` CLI the user installed and logged into), Codex (ChatGPT login) and Cursor (`agent acp`). Codesigner hosts a local MCP server exposing the selection, screenshots, comments, routes and tokens.

## Repository layout

```
apps/
  desktop/        Electron main + preloads (electron-vite). Window, IPC, webview guard,
                  dev servers, git, updater. Loads the editor from :5199 (dev) or app:// (prod).
  editor/         SvelteKit 3 SPA: the Framer-like UI (canvas, panels, toolbar).
packages/
  protocol/       Shared TypeScript types: IPC contract, bridge messages, edit ops, tokens.
  engine/         Node engine: project detection, routes, dev server, git, Svelte edits,
                  Tailwind design system, tokens, undo journal. Unit-tested with bun test.
fixtures/
  kit2-app/       Primary test target: Kit 2 + svelte.config.js + $lib + src/app.css,
                  shadcn-svelte, cookie login (demo@codesigner.test / design-demo).
  kit3-playground/ Kit 3 layout (config in vite.config.ts, #lib imports).
docs/
  research/       Decision-grade research reports.
```

## The edit loop

1. **Hover/click** on the canvas → the gesture layer converts screen coordinates through the canvas transform → `webview.send(hover-at|select-at)` → the bridge hit-tests, climbs to the nearest element with `__svelte_meta`, and resolves the *selection target*:
   - an element authored in user source → the element itself;
   - an element inside a user component's template → the component **instance** (Framer semantics; "Edit component" goes inside);
   - DOM rendered by a library (bits-ui, `node_modules`) → the nearest user instance;
   - each-block items share one template (shown as ×N).
2. **Style panel** reads computed styles and the class tokens, and shows Framer controls (size Fixed/Fill/Fit/Relative, Stack direction/distribute/align/wrap/gap/padding, fill, radius, border…).
3. **Change a control** → the editor previews immediately through the bridge (class patch + preview CSS) → on commit, `source:edit` sends a semantic op (`classes`, `text`, `wrap`, …) addressed by source location.
4. **Engine** parses the file, validates the target (tag name must match), applies a byte-range edit, writes atomically, and records a journal entry (before/after) for undo.
5. **Vite HMR** remounts the component; the bridge re-indexes, and the editor re-selects by source location.

Known trade-off: Svelte HMR remounts the edited component, so its local `$state` resets (an open dialog closes). A class-only fast path is a later experiment.

## Security model

- The editor UI is the only trusted IPC sender (origin checked on every call). Canvas webviews have no Node access, run sandboxed with context isolation, and get a preload forced by the main process.
- Webviews may only load local dev URLs (localhost, 127.0.0.1, `*.localhost`). OAuth popups open in the same preview session.
- The future MCP server binds to 127.0.0.1 with a random port and a per-session bearer token, and rejects browser `Origin`s.
- Agent CLIs run with the user's own login. Codesigner never reads or stores their credentials.
