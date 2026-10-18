# Roadmap

Status legend: ✅ done · 🚧 in progress · ⬜ not started · 💤 not now

The quality bar is "feels like Framer on my real app". A milestone is done only when its acceptance checks pass on **both** `fixtures/kit2-app` and a real-world production SaaS.

---

## M0 — Foundations ✅

- ✅ Research: desktop shell, code-sync engine, agents & comments, Framer UI spec (`docs/research/`)
- ✅ Architecture (`docs/ARCHITECTURE.md`)
- ✅ Bun monorepo: `apps/desktop`, `apps/editor`, `packages/protocol`, `packages/engine`
- ✅ Fixtures: Kit 2 app (primary; mirrors a shadcn-svelte SaaS with a cookie login) and a Kit 3 app

## M1 — Design your real app (vertical slice) ✅

Goal: open a project, see it logged in on the canvas, select things, change layout and spacing visually, and watch the code change.

- ✅ Electron shell: window, `app://` protocol, typed IPC, webview guard, `fix-path`
- ✅ Open project (folder picker + recent projects), detect Kit 2 / Kit 3, package manager, CSS entry
- ✅ Versioning mode per project: design branch in a worktree (default) or the current checkout
- ✅ Dev server per working copy: free port, install if needed, logs, restart, kill the process tree on quit
- ✅ Canvas: breakpoint frames (Desktop / Tablet / Phone) as `<webview>`s on a pan/zoom canvas, shared login session, frames follow the primary frame's navigation
- ✅ Bridge: hover/selection outlines, `__svelte_meta` resolution (element vs component instance vs each ×N), layer tree, rect tracking through scroll/HMR
- ✅ Pages panel: all routes including groups and `[slug]` routes, with sample param values
- ✅ Layers panel: tree synced with canvas selection, hover, expand/collapse, open in code
- ✅ Style panel v1: Position, Size, Layout, Styles, Text, component props and `tv()` variants
- ✅ Engine: `classes` op on static, mixed, `cn()`, array and expression class forms; Tailwind design system validation, conflict removal and ordering
- ✅ Shortcuts: `S` wraps in a Stack, `⌘↩` Frame, `⌘⌫` unwrap, `⌘D`, `⌫`, `⌘Z` / `⇧⌘Z`, `Esc` parent, `Enter` children, `⌘0/1/2` zoom, space-drag pan, `⌘E` interact mode
- ✅ Undo/redo journal across file writes (refuses safely after external edits)
- ✅ Design tokens: read and edit light/dark values from `app.css` (Assets panel)
- ✅ i18n wiring (Paraglide): English and French
- ✅ End-to-end tests driving the real Electron app (`apps/desktop/e2e`)

**Acceptance checks** (verified by `e2e/smoke.ts` on the fixture and `e2e/real-app.ts` on a production SaaS)
1. ✅ Opening a git project creates a design branch + worktree, starts its dev server, and shows `/login`.
2. ✅ Logging in inside the canvas logs in every breakpoint frame and survives restarts (persistent session).
3. ✅ ⌘-clicking a NavItem selects the instance (its usage in `+layout.svelte`), not its inner `<a>`.
4. ✅ Changing the sidebar `<nav>` gap to 12 changes only `gap-1` → `gap-3`; the canvas updates through HMR.
5. ✅ Selecting two siblings and pressing `S` wraps them in `<div class="flex flex-col gap-2">`, indented with the file's tabs.
6. ✅ `⌘Z` restores the exact previous bytes (git status clean on the real app).
7. ✅ `/projects/[slug]` appears in Pages with sample-value inputs.

**Not verified yet:** the production path (editor `adapter-static` build served over `app://`, packaging) has never run; everything above was tested in development mode.

**Known gaps carried into M2:** dev servers orphaned by a crash aren't reaped on the next launch; selection outlines only in the frame you clicked; no drag-to-reorder; editing in the Tablet/Phone frames writes to the variant in effect but doesn't yet create new `md:` overrides; Svelte HMR resets component-local state after each edit.

## M2 — Full design surface ⬜

- ⬜ Insert menu (`+`): Frame `F`, Stack `S`, Grid `⇧G`, Text `T`, Image; shadcn components from Assets
- ⬜ Text editing on canvas (double-click), typography controls, text color
- ⬜ Drag to reorder in stacks and in the layer tree; delete, duplicate (`⌘D`), copy/paste style
- ⬜ Breakpoint-aware edits (`md:`/`lg:` per frame, inherited values greyed out), add/remove breakpoints
- ⬜ Dark mode toggle in the dock; edits under dark write `dark:` variants
- ⬜ States: hover/focus/active preview (CDP `forcePseudoState`) and editing (`hover:` …)
- ⬜ Color picker with token swatches, opacity, hex/rgb/hsl/oklch
- ⬜ Scrub-to-change numeric inputs, arrow keys ±1 / shift ±10
- ⬜ Smart guides, ⌥ distance measurement, padding/gap handles on canvas
- ⬜ Interact mode (use the app normally) vs Design mode toggle
- ⬜ Optimistic preview CSS during drags (one file write on release)

## M3 — Components & tokens ⬜

- ⬜ Assets panel: components (grouped, e.g. `ui/`), color tokens, typography tokens, images in `static/` and `src/lib/assets`
- ⬜ Design tokens editor: light/dark values from `:root` / `.dark` / `@theme`, alias chains, add a token
- ⬜ Component instance panel: props from `$props()` and variants from `tv()` (Variant dropdown, Text, Boolean, Icon…)
- ⬜ "Edit component": component canvas with variant frames (`+ Variant`, `+ Hover / Pressed`), purple accent, breadcrumb
- ⬜ Component isolation page served by a Vite plugin (with `$app/*` mocks)
- ⬜ Create a component from the selection (`⌥⌘K`), expose a property (the ⊕ binding)

## M4 — Version control UX ⬜

- ⬜ Branch menu in the top bar: switch, create, rename, delete design branches; each keeps its own dev server
- ⬜ Silent checkpoints + version history (`⇧⌘H`) with restore
- ⬜ "Ship": merge into the base branch or open a PR (`gh`), with a visual diff summary
- ⬜ Conflict-aware re-sync when files change outside the app (agents, editors, git)

## M5 — Comments ⬜

- ⬜ Comment mode (`C`): pin on an element, threads, resolve
- ⬜ Storage in `.codesigner/comments/*.json` with multi-signal anchoring and an "outdated" state
- ⬜ "Send to agent" per comment, "Implement all unresolved"

## M6 — Agents ⬜

- ⬜ ACP client (`@agentclientprotocol/sdk`); Claude (user's `claude` CLI), Codex (`codex-acp`, ChatGPT login), Cursor (`agent acp`)
- ⬜ Agent tab: chat, streaming tool calls, diffs, permission prompts, stop
- ⬜ Codesigner MCP server (selection, screenshot, comments, routes, tokens, dev-server errors)
- ⬜ Per-turn snapshots and "Undo turn"; canvas read-only during a turn

## M7 — Distribution ⬜

- ⬜ electron-builder: dmg+zip (mac), NSIS (win), AppImage+deb (linux); ad-hoc signing on mac
- ⬜ GitHub Actions release workflow on tags
- ⬜ Update check on launch (GitHub Releases), "Update available → Download" banner
- 💤 Apple Developer ID signing + notarization → silent auto-updates (needs a paid account)
- ⬜ Windows and Linux smoke tests

## M8 — Polish ⬜

- ⬜ French translation
- ⬜ Dark theme for the editor itself
- ⬜ Command palette (`⌘K`)
- ⬜ Performance: snapshot far-away frames, cap live webviews

## Not now 💤

- Effects / motion (Framer Motion-like), transitions, page effects
- Framer CMS, hosting/publishing, SEO, site settings, localization of site content, analytics
- Plugins marketplace, multiplayer cursors, vector editing
- Frameworks other than SvelteKit
