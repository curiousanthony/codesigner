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
- ✅ Shortcuts: `⇧A` wraps in a Stack (was `S`), `⌘↩` Frame, `⌘⌫` unwrap, `⌘D`, `⌫`, `⌘Z` / `⇧⌘Z`, `Esc` parent, `Enter` children, `⌘0/1/2` zoom, space-drag pan, `⌘E` interact mode
- ✅ Undo/redo journal across file writes (refuses safely after external edits)
- ✅ Design tokens: read and edit light/dark values from `app.css` (Assets panel)
- ✅ i18n wiring (Paraglide): English and French
- ✅ End-to-end tests driving the real Electron app (`apps/desktop/e2e`)

**Acceptance checks** (verified by `e2e/smoke.ts` on the fixture and `e2e/real-app.ts` on a production SaaS)
1. ✅ Opening a git project creates a design branch + worktree, starts its dev server, and shows `/login`.
2. ✅ Logging in inside the canvas logs in every breakpoint frame and survives restarts (persistent session).
3. ✅ ⌘-clicking a NavItem selects the instance (its usage in `+layout.svelte`), not its inner `<a>`.
4. ✅ Changing the sidebar `<nav>` gap to 12 changes only `gap-1` → `gap-3`; the canvas updates through HMR.
5. ✅ Selecting two siblings and pressing `⇧A` (originally `S`) wraps them in `<div class="flex flex-col gap-2">`, indented with the file's tabs.
6. ✅ `⌘Z` restores the exact previous bytes (git status clean on the real app).
7. ✅ `/projects/[slug]` appears in Pages with sample-value inputs.

**Not verified yet:** the production path (editor `adapter-static` build served over `app://`, packaging) has never run; everything above was tested in development mode.

**Known gaps carried into M2:** dev servers orphaned by a crash aren't reaped on the next launch; no drag-to-reorder; Svelte HMR resets component-local state after each edit. (Fixed since: outlines now show in every breakpoint; Tablet/Phone edits create responsive overrides.)

## M2 — Full design surface 🚧

- ✅ Draw tools like Framer: `S` Stack, `F` Frame, `⇧G` Grid, `T` Text (also in the `+` menu). Click or drag inside a container; an insertion line follows its flow (row, column, grid), `{#each}` runs are kept intact, empty layout space draws into the page. Drawn sizes snap to the 4px scale; drawn frames get a fill that contrasts in light and dark. `⇧A` wraps the selection in a Stack (smoke-tested; tried on the real SaaS)
- ✅ Insert from Assets: drag a component (its import is added: named, `* as Card` or default) or an image (static/ by URL, `src/lib/assets` imported) onto the canvas
- ✅ Text editing on canvas: double-click a selected text layer (or draw one with `T`), type, `↩` commits, `Esc` cancels
- ⬜ Rich text (inline `<strong>`/links), typography presets
- ✅ Drag to reorder on the canvas (ghost + insertion line) and in the Layers panel (before / after / inside); delete, duplicate (`⌘D`), copy/paste style (`⌥⌘C` / `⌥⌘V`)
- ✅ Breakpoint-aware edits with Framer's cascade: an edit applies to that breakpoint and smaller ones, larger frames get pinned (`gap-6` edited on Phone → `gap-3 md:gap-6`); overridden properties highlighted
- ✅ Per-breakpoint layer trees in the Layers panel (Desktop / Tablet / Phone rows), selection mirrored in every frame, layer click outlines on the canvas
- ✅ Add / resize / remove breakpoints, make one primary (the frame pill's `+` and `…`)
- ✅ Code panel (⌘J): the file behind the selection with its tag highlighted, page and layout tabs; typing saves through the undo journal, invalid Svelte is refused, conflicts are detected
- ✅ Dark preview in the dock; color edits under it write `dark:` variants (projects with a class-based dark mode)
- ✅ States on page elements: Default / Hover / Pressed / Focus picker in the Style panel forces the state on the selection in every breakpoint (CDP) and edits write `hover:` / `active:` / `focus-visible:`
- ✅ Color picker: token swatches with search and an opacity modifier (`bg-primary/80`), custom colors with saturation/brightness, hue and alpha (one write on release), hex input; opens upwards near the bottom
- ⬜ Color picker: rgb/hsl/oklch input modes, eyedropper
- ✅ Scrub-to-change numeric inputs (drag the field), arrow keys ±1 / ⇧ ±10 / ⌥ ±0.1, math in fields
- ✅ ⌥ distance measurement (red lines to the hovered layer; four sides when nested) and padding / gap handles on the canvas (drag with live preview, 4px steps, ⌥ 1px, ⇧ all sides; writes `px-8 pt-14 pb-8`-style classes)
- ⬜ Smart guides when moving absolutely positioned layers
- ✅ Interact mode (use the app normally, `⌘E`) vs Design mode toggle
- ✅ Optimistic preview CSS during scrubs (one file write on release)

## M3 — Components & tokens 🚧

Tried on the real SaaS (all undone, worktree clean): hover state and `dark:` edits, dragging one of its components from Assets, padding handles on a responsive container (`sm:pr-6 sm:pl-11`), Create component on its hero (5 props, imports moved; `svelte-check` error count unchanged).

- ✅ Assets panel: components (grouped, e.g. `ui/`), color tokens (light/dark), images in `static/` and `src/lib/assets` with thumbnails; all draggable onto the canvas
- ⬜ Assets: typography tokens
- ⬜ Design tokens editor: light/dark values from `:root` / `.dark` / `@theme`, alias chains, add a token
- ⬜ Component instance panel: props from `$props()` and variants from `tv()` (Variant dropdown, Text, Boolean, Icon…)
- ✅ "Edit component": component canvas with every `tv()` variant × Default / Hover / Pressed (forced through CDP) plus sizes, purple accent, breadcrumb; edits go to the variant's own entry, `hover:`/`active:` for states, `compoundVariants` when a shared axis controls the value; `+ Variant`
- ✅ Component isolation page served by the app's own dev server (git-ignored route `src/routes/__codesigner`, root layout only)
- ✅ Components without `tv()` (most app components): Default / Hover / Pressed, a cell per boolean prop, a row per enum prop, sample values for required props; edits change the component's own markup (`hover:` classes for state cells). Double-click a component in Assets to open it
- ✅ Create a component from the selection (`⌥⌘K`, or the component button in the Style panel): the markup moves to `src/lib/components/<Name>.svelte`, values it reads from the page (script variables, `{#each}` items, snippets) become props, its imports are copied, two-way state is refused; undo deletes the file
- ⬜ Expose a property (the ⊕ binding): turn a static value inside a component into a prop

## M4 — Version control UX 🚧

Verified by `e2e/smoke.ts` on the fixture (save → restore → ship into the checked-out base) and by engine tests (conflicts, base not checked out, push to a local remote). Not run on the real SaaS on purpose: shipping there would touch its `develop`. Test drivers set `CODESIGNER_NO_AUTOSAVE=1` on real repositories.

- ✅ Pick the branch to start designing from: first open asks (local and remote branches, newest first, or edit the checkout directly); "New design branch…" in the branch menu takes a base too
- ✅ Branch menu in the top bar: switch, create (from any branch), rename, delete design branches (`⇧⌘B` new); each keeps its own dev server
- ✅ Silent checkpoints (a version is saved 20 s after editing pauses, named after the edits) + version history (`⇧⌘H`) with restore (as a new version, nothing lost)
- ✅ "Ship": merge into the base branch as one commit (fast-forwards the checkout when the base is checked out and clean, moves the branch otherwise), or push and open a PR (`gh`, else the compare page); "Update" when the base moved on
- ⬜ Ship: visual diff summary (before/after screenshots of changed pages)
- ⬜ Conflict-aware re-sync when files change outside the app (agents, editors, git)

## M5 — Comments 🚧

- ✅ Comment mode (`C`, or the bubble in the dock): click a layer to pin a comment, threads with replies, resolve / reopen, delete; pins in every breakpoint, the thread opens in the frame you clicked; Comments tab lists them by page (current first), with resolved ones on demand
- ✅ Storage in `.codesigner/comments/*.json` (travels with the design branch); anchors combine source location + repeat index + text + point, so pins follow edits; "outdated" when the element is gone
- 🚧 "Copy for agent" per comment and "Copy N for agent" (all unresolved) as a ready-to-paste prompt; sending straight to an agent comes with M6

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
