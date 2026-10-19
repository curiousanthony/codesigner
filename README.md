# Codesigner

**Design your real SvelteKit app, visually.** Codesigner is a desktop design tool that looks and feels like Framer, but every change you make on the canvas is a small, precise edit to your actual `.svelte` and CSS files, on its own git branch.

> Status: early development (milestone M1). See [ROADMAP.md](ROADMAP.md).

## Why

Designing in a separate prototype tool means re-implementing every design in code, and the shipped UI drifts from the mockups. Codesigner removes that hand-off: the canvas *is* your app, running on its own dev server and logged in like a normal user. Changes become real Tailwind classes in your components, and coding agents can work on the same branch at the same time.

## What works today

- **Your app on the canvas:** Desktop, Tablet and Phone frames, each a real browser view sharing one login session. Log in once and every frame and every branch stays logged in, even behind auth (Supabase, Lucia, Auth.js…).
- **Framer-style selection:** click picks the top level, double-click drills in, ⌘-click goes straight to the innermost layer, Esc selects the parent. Component instances (e.g. `<Button>`) are selected as instances; repeated `{#each}` items show ×N.
- **Layers, Pages, Assets:** all routes (route groups and `[slug]` routes with sample values), the layer tree of the current page, your `src/lib` components with their `tv()` variants, and your design tokens from `app.css`, editable for light and dark.
- **Style panel:** Position, Size (Fixed / Fill / Fit / Relative / Viewport), Layout (Stack / Grid, direction, distribute, align, wrap, gap, padding), Styles (opacity, visibility, fill, overflow, radius, border), Text, and component props.
- **Precise code edits:** only the affected bytes change (class tokens, attributes, text). Classes are validated and ordered with your project's own Tailwind design system, conflicting classes are removed, and the edit targets the responsive variant in effect at the frame's width.
- **Structure:** `⇧A` wraps the selection in a Stack, `⌘↩` in a Frame, `⌘⌫` removes a wrapper, `⌘D` duplicates, `⌫` deletes. `S`, `F`, `⇧G` and `T` pick the Stack, Frame, Grid and Text tools: click or drag inside a container to draw one where you point.
- **Undo/redo** across file writes, and safe against external edits.
- **Version control:** by default every design session runs on a `design/*` branch in its own git worktree, with its own dev server. `develop` and `main` are untouched until you ship. You can also edit the current checkout directly.
- **i18n:** English, with French included.

Coming next: comments anchored to elements, an Agent tab (Claude, Codex and Cursor through ACP, using your own login), merging and PRs, and component editing with variants. See the [roadmap](ROADMAP.md).

## How it works

- Svelte 5 dev builds attach `__svelte_meta` (file, line, column and component stack) to every DOM element. A small bridge injected into each canvas frame reads it, so **nothing is ever written into your source for tracking**.
- Edits go through `svelte/compiler`'s AST plus `magic-string`, so formatting, comments and indentation are preserved.
- Tailwind v4's design system API (`@tailwindcss/node`) validates and orders classes. Tokens are read and written with PostCSS.

The details and the research behind each decision are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/research](docs/research).

## Requirements

- macOS (Windows and Linux are planned)
- A SvelteKit project using **Svelte 5**, ideally Tailwind v4 (shadcn-svelte works great)
- [Bun](https://bun.sh) for development

## Development

```bash
bun install
bun run dev
```

`bun run dev` starts the editor UI (SvelteKit on :5199, override with `CODESIGNER_EDITOR_PORT`) and the Electron shell with hot reload. Then click **Open a SvelteKit project**. `fixtures/kit2-app` is a ready-made test project whose login is `demo@codesigner.test` / `design-demo`.

```bash
bun run test        # engine (bun test) + editor (vitest)
bun run check       # type checks
cd apps/desktop && node e2e/smoke.ts   # end-to-end run in Electron (editor dev server must be running)
```

### Mac app

```bash
cd apps/desktop && bun run package   # dist/mac-arm64/Codesigner.app and a .dmg (unsigned for now)
cd apps/desktop && bun run icon      # re-render build/icon.icns from build/icon/icon.html
```

The packaged app bundles the editor UI, so rebuild it to pick up changes.

## License

[MIT](LICENSE)
