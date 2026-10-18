# 02 — Code-sync engine: DOM ⇄ source mapping and surgical edits to `.svelte` and CSS

> Research for **codesigner** (placeholder name), a Framer-like canvas that edits a real SvelteKit 2 + Svelte 5 + Tailwind v4 + shadcn-svelte app.
> Date: 2026-10-18.
> Reference app: a production SvelteKit SaaS (read-only), with svelte 5.56.8, kit 2.70.2, vite 7.3.6, vite-plugin-svelte 6.2.4, tailwindcss 4.3.3, tailwind-variants 3.2.x, tailwind-merge 3.x.
>
> **How claims are tagged:**
> - **[verified]**: I ran it, in a scratch project or against the reference app's real files.
> - **[source]**: read in library source code.
> - **[reported]**: web or docs only, not reproduced.

---

## 0. TL;DR

1. **Use Svelte's dev metadata as the main DOM→source map. Do not write IDs into the user's files.**
   - In dev, Svelte 5 attaches `element.__svelte_meta = { loc: { file, line, column }, parent }` to **every DOM element created from a template** [verified in jsdom, and in a real SvelteKit dev server with bits-ui].
   - `parent` is a stack of `component | each | if | await | key | render` frames. A `component` frame carries `componentTag` and the **call-site** location. So instance resolution, which Onlook had to reconstruct heuristically for React, comes for free.
   - Onlook did write `data-oid` into source files. Its own issue tracker shows the cost: noisy diffs on every file and cleanup bugs ([#1738](https://github.com/onlook-dev/onlook/issues/1738), [#1672](https://github.com/onlook-dev/onlook/issues/1672)).
2. **Hook in without touching `vite.config.ts`.** Start the user's dev server through a small launcher.
   - The launcher calls the project's own `vite.createServer({ configFile: <user config>, plugins: [codesigner()] })`. Inline plugins are merged into the user's config.
   - SvelteKit runs fine this way [verified: kit 2.70.3 + vite 7.3.7].
   - The plugin serves the in-page **bridge** script, a file/AST RPC endpoint and HMR notifications. It can also, optionally, inject `data-cd-*` attributes at compile time.
3. **Edit with `svelte/compiler` `parse(src, { modern: true })` + `magic-string`.** Never re-print a whole file.
   - Svelte has shipped an official `print()` since **5.45.0**. It reformats the output (it re-indents and adds blank lines) [verified], so use it only to generate *new* snippets.
   - Edits touch byte ranges: class tokens inside `Text` chunks, string literals inside `cn(...)`/`[...]`, attribute values, text nodes, and element ranges for move, wrap and delete.
4. **Tailwind v4 has a real programmatic engine.**
   - `__unstable__loadDesignSystem(css, { base })` from `@tailwindcss/node` loads the reference `app.css` in ~66 ms [verified].
   - It provides: candidate→CSS (`candidatesToCss`/`candidatesToAst`), class ordering (`getClassOrder`, the same API `prettier-plugin-tailwindcss` uses), the class list (26,744 entries), variants, theme lookup, `parseCandidate`, and `canonicalizeCandidates` (`w-[16px]`→`w-4` with `{ rem: 16 }`).
   - Use it to **validate classes, resolve conflicts by CSS property + variant, and order classes**.
   - Don't rely on `tailwind-merge`. It misclassifies custom tokens: `text-sm text-body` and `shadow-xs shadow-elevation-md` both survive merging [verified].
5. **Edit tokens in `app.css` with PostCSS.** Its round-trip is byte-identical [verified], and editing one `:root` value changes exactly one line [verified]. Don't use lightningcss for edits: it re-serializes the whole file.
6. **Read props and variants statically.**
   - Read the `$props()` destructuring from the instance script AST.
   - Read `tv({ variants, defaultVariants })` from the `<script module>` AST [verified on the reference `button.svelte`].
   - Use svelte2tsx + the TS checker only when you need the full types.
7. **Expect state loss on HMR.**
   - Svelte 5 HMR **destroys and re-creates** the edited component and its subtree; local `$state` resets [source: `svelte/src/internal/client/dev/hmr.js`].
   - Mitigation: patch the DOM optimistically and inject preview CSS made by the design system; coalesce slider drags so only the release writes; consider a class-only fast path (unverified).
   - Version every file so stale `line:column` values are never used.

---

## 1. Version snapshot (npm, 2026-10-18)

| Package | Latest | In reference app | Notes |
|---|---|---|---|
| `svelte` | 5.57.2 | 5.56.8 | `print()` since 5.45.0. `class={[..]}`/objects (clsx) since 5.16.0. `__svelte_meta.parent` hierarchy since 5.35.1. Template declaration tags (`{const x = ...}` → `DeclarationTag` node) since 5.56.0 |
| `@sveltejs/kit` | **3.1.0** | 2.70.2 | Kit 3 requires Vite 8 (rolldown) and Node 22+, moves Svelte config into the Vite plugin, removes `$app/stores` and adds `#lib` subpath imports [reported]. The target is still kit 2, but plan for 3 |
| `@sveltejs/vite-plugin-svelte` | 7.3.1 | 6.2.4 | Ships the inspector (`@sveltejs/vite-plugin-svelte-inspector` 5.x) |
| `vite` | 8.3.4 | 7.3.6 | |
| `tailwindcss` / `@tailwindcss/node` | 4.3.3 | 4.3.3 | `__unstable__loadDesignSystem` |
| `tailwind-merge` | 3.7.0 | ^3.3.1 | |
| `tailwind-variants` | 3.3.1 | ^3.2.2 | |
| `magic-string` | 1.4.3 (1.0.0 released 2026-07) | — | Svelte itself depends on ^0.30.11, so pin either one deliberately |
| `esrap` | 2.4.0 | — | The printer behind `svelte/compiler` `print()` |
| `svelte-ast-print` | 1.1.0 (last published 2025-05) | — | Superseded by the official `print()` |
| `svelte2tsx` | 0.7.62 | — | |
| `postcss` | 8.5.30 | — | |
| `sveld` | 0.38.7 | — | Component docs/types generator; supports runes [reported] |
| `svelte-docgen` | 0.1.0 | — | Early |

What the reference app actually contains (`grep` over 485 `.svelte` files under `src/`):

| Pattern | Count | Implication |
|---|---|---|
| `class="static"` (no braces) | **6,149** | The 95% case. Token edits inside a `Text` chunk |
| `class={cn(...)}` | **339** | Edit string-literal arguments |
| `class="a b {expr}"` (mixed) | 88 | Edit only the `Text` chunks; the expression stays read-only |
| `class={[...]}` (clsx array) | 0 | Support it anyway (Svelte ≥ 5.16) |
| `class:foo={…}` directives | 3 | Read-only display |
| `{#each` / `{#if` / `{#snippet` / `{@render` | 369 / 1,628 / 177 / 348 | Dynamic structure is everywhere, so the editability rules (§3.3, §4.5) are core |

Formatting conventions to preserve (from `.prettierrc`):

- tabs, single quotes, `printWidth: 100`
- `prettier-plugin-svelte`
- `prettier-plugin-tailwindcss` with `tailwindStylesheet: ./src/app.css`, which means classes are expected in Tailwind's canonical order

---

## 2. Prior art: how others map DOM to code

### 2.1 Onlook (onlook-dev/onlook, ~27k ★): the closest analogue

I read the repo source (`packages/parser`, `packages/constants`, `apps/web/client/src/components/store/editor/ast/README.md`) and the README.

**Mapping: `data-oid` written into the source files.**
- `packages/parser/src/ids.ts` walks every JSX element with Babel and adds `data-oid="<random>"` attributes. It keeps global/local uniqueness sets and handles branch conflicts.
- Constants in `packages/constants/src/editor.ts`:
  - `data-oid`: element ID
  - `data-oiid`: instance ID
  - `data-odid`: DOM ID
  - `data-ocname`: component name
  - `data-onlook-dynamic-type`: `array` / `conditional`
  - `data-onlook-core-element-type`
- These attributes are **persisted in the user's files**.

**Indexing:** `template-node/map.ts` builds `oid → TemplateNode { file, location, component stack, dynamicType }`.
- `ConditionalExpression` and `&&`/`||` push `CONDITIONAL`.
- `.map()` calls that return JSX push `ARRAY`.

**Instances:** React's DOM carries no instance information, so Onlook reconstructs it heuristically.
- From `editor/ast/README.md`: "the DOM tree does not have instance information and the AST does not have the tree information".
- Their algorithm walks the DOM. Where a child's component name differs from its parent's, it looks up the parent's code and finds "the child with the same index and component name".

**Edits** (`code-edit/transform.ts`, `style.ts`):
- Babel traverse to the element with that `oid`.
- Mutate the AST:
  - `className` string: `customTwMerge(old, new)`
  - `className={cn(...)}`: **push a new string argument**
  - moves, inserts, removes, group/ungroup, image changes
- Regenerate with `@babel/generator` (`retainLines: true`), then **run Prettier on the whole file** (`parser/src/prettier`).

**Canvas:** an iframe. A preload script (`apps/web/preload`) uses penpal RPC (`@onlook/penpal`) and does optimistic DOM edits first ("we edit the element in our iFrame, then in code").

**Runtime:** the web version runs the project in a CodeSandbox SDK container (README).
- In 2026 the product is again an **Electron desktop app** (docs.onlook.com/developers/architecture).
- That app runs your own dev server locally and gives each project a **git worktree on a new branch**.
- It bundles Claude Code / ChatGPT agents.
- It "refuses to start it anywhere else" (it will not touch your own checkout).

**Lessons for codesigner:**
1. **Never persist IDs in user source.** Onlook's own issues:
   - [#1738](https://github.com/onlook-dev/onlook/issues/1738): "transforming every jsx/tsx files with `data-oid` … creates large commits that include irrelevant files".
   - [#1672](https://github.com/onlook-dev/onlook/issues/1672): oids not removed from untouched files.
   - Svelte's compiler gives us locations without this.
2. **Babel generate + Prettier is not formatting-preserving.** It is acceptable for Next.js shops that already run Prettier, but noisy otherwise. Use byte-range edits.
3. **Optimistic DOM patch first, then code** is the right UX. Their bug [#898](https://github.com/onlook-dev/onlook/issues/898) ("wrapping divs … no className") shows that structural ops need careful attribute handling.
4. **Worktree isolation + an agent next to the canvas** is where Onlook ended up (see 03-agents report). It is also a cheap safety net for undo.

### 2.2 Others

| Tool | Mapping approach | Relevance |
|---|---|---|
| **Svelte's own inspector** (`@sveltejs/vite-plugin-svelte-inspector`) | Reads `el.__svelte_meta.loc` on hover. On click it calls `fetch('/__open-in-editor?file=file:line:col')`. Elements whose `loc.file` contains `node_modules/` are ignored [source: `runtime/Inspector.svelte`] | Proves the mapping path. We replicate it without needing the inspector enabled |
| **code-inspector-plugin** (zh-lx) | A Vite transform that parses `.svelte` with the *legacy* parser (blanking script/style regions with spaces) and `prependLeft`s `data-insp-path="file:line:col:tag"` after every element's tag name with magic-string [source: `transform-svelte.ts`] | Reference implementation for compile-time attribute injection. Skips components (correct) |
| **svelte-trace** (git002) | Svelte *preprocessor* adding `data-svelte-trace` (base64 `{tag, line:col, tag offsets, class-attr offsets, absolute path}`) and `data-svelte-trace-id` (hash of `path:offset`). Beta [reported] | Shows the "offsets of the class attribute" idea. Its README notes the offsets are stale after recompiles, which is the same staleness problem as §7.3 |
| **Builder.io Fusion** | Git-backed visual canvas plus AI over existing React/MUI repos; opens branches/PRs per change. **Mapping mechanism not publicly documented** [reported] | Validates "edit real repo, PR out" positioning |
| **Tempo Labs** | "Design tool on top of an IDE" for React + Vite + Tailwind. **Mechanism not documented** [reported] | — |
| **Wix Codux** | Two-way React visual IDE that "writes code the way you would". Closed source. Listed as discontinued by a single third-party source (AlternativeTo), **unconfirmed** | Two-way sync without owning the codebase is hard to sustain as a business |
| **Plasmic** | Owns a JSON model and codegens files it controls (plus "code components" you register) | Opposite philosophy: not editing arbitrary code |
| **Webflow DevLink** | One-way export of Webflow components to React | Not two-way |
| **Pinegrow Vue Designer** | Opens and saves standard `.vue` SFCs. A Vite plugin "Live Designer" module and a Tailwind plugin drive the visual controls [reported, docs from 2023] | The closest thing to a "real SFC visual editor". No Svelte support found |
| **Svelte-specific builders** | `svelte-visual-builder` (BluePointDigital, Elementor-style, embeds in host app with its own data model), Dialyma (canvas builder that *exports* code), svedit (content-editing library) | **None edits arbitrary `.svelte` source two-way.** The niche is open |

---

## 3. Svelte 5: mapping DOM → source

### 3.1 `__svelte_meta`: exact shape [source + verified]

The compiler wraps every dev template in `$.add_locations(template, Component[$.FILENAME], [[line, col, children?], ...])` [source: `compiler/phases/3-transform/client/transform-template/index.js`].

At runtime `assign_location` sets:

```ts
// svelte/src/internal/client/dev/elements.js
element.__svelte_meta = {
  parent: dev_stack,                       // DevStackEntry | null
  loc: { file: filename, line, column }    // line 1-based, column 0-based ('<' of the tag)
};

// svelte/src/internal/client/context.js — add_svelte_meta() pushes frames around blocks:
type DevStackEntry = {
  type: 'component' | 'if' | 'each' | 'await' | 'key' | 'render';
  file: string;           // file in which the block / component tag is WRITTEN
  line: number;           // 1-based
  column: number;         // 0-based
  componentTag?: string;  // for type 'component', e.g. 'Button', 'Card.Root'
  parent: DevStackEntry | null;
};
```

- The line is **1-based** (`getLocator(source, { offsetLine: 1 })`) and the column is **0-based** [verified].
  - The inspector UI prints `line + 1` and `column + 1`. Don't copy that offset.
- `file` is the `filename` passed to `compile`. Under vite-plugin-svelte it is **root-relative**, e.g. `src/routes/+page.svelte` [verified in a real SvelteKit dev server].
- Only `ELEMENT_NODE`s get meta. Text nodes do not.
  - `{@html}` content gets no meta.
  - `<svelte:element>` does get it (`blocks/svelte-element.js`).
- Meta is assigned during hydration too (the `hydrating` branch walks past hydration comments), so SSR'd pages are covered once hydrated.
- `element_prototype.__svelte_meta = null` is set in `operations.js`, so reading it on any element is safe.

**What a real SvelteKit page reports** [verified]. Test app: kit 2.70.3, vite 7.3.7, svelte 5.57; `+page.svelte` renders `<MyButton class="mt-2"><span class="lbl">Go</span></MyButton>`; `MyButton.svelte` renders bits-ui `<Button.Root class="btn {className}">`.

```text
<main class="p-4">        loc src/routes/+page.svelte:6:0
                           parent: component Pyramid_1 @ .svelte-kit/generated/root.svelte → render @ node_modules/@sveltejs/kit/.../layout.svelte → …
<button class="btn mt-2">  loc node_modules/bits-ui/dist/bits/button/components/button.svelte:14:0
                           parent: component "Button.Root" @ src/lib/MyButton.svelte:6:0
                                 → component "MyButton"  @ src/routes/+page.svelte:8:2 → (kit root frames)
<span class="lbl">         loc src/routes/+page.svelte:8:25          ← authored in the page (children snippet)
                           parent: render @ src/lib/MyButton.svelte:6:37 ({@render children()})
                                 → render @ node_modules/bits-ui/.../button.svelte:26:1
                                 → component "Button.Root" @ src/lib/MyButton.svelte:6:0 → component "MyButton" @ +page.svelte:8:2 → …
```

And in jsdom, compiled with `dev: true` [verified]:

| DOM element | `loc` | parent chain |
|---|---|---|
| `<li>` inside `{#each items}` (2 rendered) | **both** `Page.svelte:13:4` | `each @ Page:12:2` |
| root `<button>` of `<Button>` | `Button.svelte:5:0` | `component "Button" @ Page:16:4` → `if @ Page:15:2` |
| `<b>` passed as children to `<Button>` | `Page.svelte:16:30` | `render @ Button:6:22` → `component "Button" @ Page:16:4` → `if` |
| `<article>` from `{#snippet card}` | `Page.svelte:8:2` (snippet **definition**) | `render @ Page:18:2` (call site) |

What this means:

- **Every iteration of an `{#each}` shares one `loc`.** Editing it means editing the template, so all items change. The `each` frame tells us we're inside a loop.
- **Elements inside a component report the component's file.** The nearest `component` frame gives the **instance** (the `<Button …>` tag in the parent file, with exact line and column). This beats Onlook's index-matching heuristic.
- **Children/snippet content reports the file where it was written.** Editing `<b>` edits the page, not `Button.svelte`. The `render` frame tells us it is projected content.
- **Elements rendered by libraries** (bits-ui, layerchart, kit internals) report `node_modules/...` locations. Climb the parent chain to the first frame whose `file` is user source (`!file.startsWith('node_modules/') && !file.startsWith('.svelte-kit/')`). That frame is the editable handle, e.g. `Button.Root` in `MyButton.svelte`.

**Caveat: preprocessing.** Locations refer to the code *after* Svelte preprocessors run (vite-plugin-svelte compiles `finalCode`).
- The reference app uses `vitePreprocess()`. Since vite-plugin-svelte 4 it preprocesses **only `<style>`** unless `script: true` [source: `vite-plugin-svelte/src/preprocess.js`]. So markup locations match the file on disk unless a `<style lang="postcss">` block *above* the markup changes its line count.
- The resolver must therefore **validate**: the node at the computed offset must be a `RegularElement`/`SvelteElement` with the same tag name. If it isn't, search nearby (§3.4).

### 3.2 Resolution algorithm (bridge → engine)

In-page bridge (main world; see §3.5):

```ts
type Frame = { type: string; file: string; line: number; column: number; componentTag?: string };
type Hit = {
  loc: { file: string; line: number; column: number };
  frames: Frame[];            // innermost → outermost
  tag: string;                // el.localName
  instanceCount: number;      // how many live elements share this loc
};

const isUser = (f: string) => !f.startsWith('node_modules/') && !f.startsWith('.svelte-kit/');

export function describe(el: Element): Hit | null {
  // climb to the nearest element that has meta (text nodes / @html have none)
  let cur: Element | null = el;
  while (cur && !(cur as any).__svelte_meta) cur = cur.parentElement;
  if (!cur) return null;
  const meta = (cur as any).__svelte_meta;
  const frames: Frame[] = [];
  for (let p = meta.parent; p; p = p.parent)
    frames.push({ type: p.type, file: p.file, line: p.line, column: p.column, componentTag: p.componentTag });
  const key = `${meta.loc.file}:${meta.loc.line}:${meta.loc.column}`;
  return { loc: meta.loc, frames, tag: cur.localName, instanceCount: countByLoc(key) };
}
```

Engine side, deciding what a click selects:

```ts
type Target =
  | { kind: 'element'; file: string; offset: number }                 // editable element in user source
  | { kind: 'instance'; file: string; offset: number; tag: string }   // <Button …> at call site
  | { kind: 'readonly'; reason: string; fallback?: Target };

function classify(hit: Hit): Target {
  const userLoc = isUser(hit.loc.file);
  const firstUserComponent = hit.frames.find(f => f.type === 'component' && isUser(f.file));
  const insideComponentDef = userLoc && firstUserComponent && hit.loc.file !== firstUserComponent.file;

  if (!userLoc) {
    // library DOM (bits-ui etc.): select the nearest user-source component instance
    return firstUserComponent
      ? { kind: 'instance', file: firstUserComponent.file, offset: toOffset(firstUserComponent), tag: firstUserComponent.componentTag! }
      : { kind: 'readonly', reason: 'rendered by a library' };
  }
  if (insideComponentDef) {
    // element is part of a component's template, e.g. <button> inside button.svelte.
    // Framer semantics: a click selects the INSTANCE; double-click / "Edit component" enters the definition.
    return { kind: 'instance', file: firstUserComponent!.file, offset: toOffset(firstUserComponent!), tag: firstUserComponent!.componentTag! };
  }
  return { kind: 'element', file: hit.loc.file, offset: toOffset(hit.loc) };
}
```

`toOffset({line, column})` = `lineStarts[line - 1] + column`, computed on the **version of the file the browser is currently running** (§7.3).

Then validate with the AST: find the node whose `start === offset`. It must be a `RegularElement`/`SvelteElement` with `name === tag`, or a `Component` with `name === componentTag`.

### 3.3 Selection semantics (Framer mapping)

| Clicked thing | Frame signals | Default selection | Editable as | Notes |
|---|---|---|---|---|
| Plain element in a page/layout | none / `if` | element | full: classes, text, structure | |
| Element inside an `{#each}` | `each` frame | element (template) | classes + structure **of the template** | Show "×N" (count of live elements with the same loc). Text that is an expression (`{item.name}`) is read-only |
| Element in an `{#if}` branch | `if` frame | element | full | Only the rendered branch is visible. "Show other branch" needs app state (out of scope; offer "open in code") |
| Root/inner element of a user component (`$lib/components/ui/button/button.svelte`) | `component` frame in user file | **instance** (`<Button>` tag at call site) | instance: props (`variant`, `size`), `class` prop override (shadcn components merge `class` via `cn`), children text | "Edit main component" enters the definition. Edits there affect **all** instances: warn and show a usage count via a grep for imports |
| Children content passed into a component | `render` → `component` | element (authored in the parent file) | full | Common for `<Button>Label</Button>` |
| Element in a `{#snippet}` | `render` frame, loc at the definition | element (definition) | full, with a warning: "shared by N render sites" | Count the `{@render name(...)}` call sites in the file |
| DOM from bits-ui / node_modules | loc in `node_modules` | nearest user component instance | instance props/class only | e.g. `Dialog.Content` |
| `{@html}` content, text nodes | no meta | nearest ancestor with meta | read-only | |

### 3.4 Robust re-identification (after edits, HMR and external edits)

`line:col` is a moving target. Keep an engine-side **NodeRef** that survives edits:

```ts
type NodeRef = {
  file: string;
  version: number;          // file version this ref was resolved against
  start: number; end: number;
  tag: string;
  path: number[];           // child-index path through fragment.nodes from the root (blocks count as nodes)
  fingerprint: string;      // hash(tag + static attribute names + first 40 chars of static text)
};
```

When the file changes:
1. If we made the edit, map `start` through our own edit (magic-string offsets: everything before the edit is unchanged, everything after shifts by delta).
2. If it was external, re-parse, try `path`, check `tag`/`fingerprint`, then fall back to fingerprint search within ±10 lines.
3. Validate against the DOM after HMR by re-reading `__svelte_meta` on the element at the selection's last screen position.

### 3.5 Getting code into the page: plugin + bridge, without touching `vite.config.ts`

**Launcher** [verified with SvelteKit 2.70.3 / Vite 7.3.7 under Node]. Inline `plugins` are merged with the loaded config file via `mergeConfig(loadResult.config, inlineConfig)` [source: `vite/dist/node/chunks/config.js`]. SvelteKit loads `svelte.config.js` from `process.cwd()`, so `chdir` first.

```ts
// codesigner/launcher/dev.mjs — run with the SAME runtime the project uses: `bun --bun dev.mjs <projectDir> <port>`
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const [projectDir, port] = process.argv.slice(2);
process.chdir(projectDir);                                   // SvelteKit uses process.cwd()
const req = createRequire(path.join(projectDir, 'package.json'));
const vite = await import(pathToFileURL(req.resolve('vite')).href);   // the PROJECT's vite (7 or 8)
const { codesigner } = await import('./plugin.mjs');

const server = await vite.createServer({
  root: projectDir,
  configFile: findViteConfig(projectDir),     // vite.config.{ts,js,mts,mjs}; false if none
  plugins: [codesigner({ projectDir })],      // appended to the user's plugins
  server: { port: Number(port), strictPort: true, host: 'localhost' }
});
await server.listen();
server.printUrls();
```

Notes:

- The test printed the resolved plugin order: `vite-plugin-svelte:preprocess, vite-plugin-svelte-inspector, …, codesigner, vite-plugin-svelte, …, vite-plugin-svelte:compile, …`. With `enforce: 'pre'` plus `transform.order: 'pre'`, our transform sees `.svelte` source before compilation.
- The alternative is `vite dev --config <wrapper>`, where the wrapper does `mergeConfig(userConfig, { plugins: [...] })`. It works too, but kit's internal `load_config_from_vite()` re-resolves the *default* config file in `cwd`, which is harmless. `createServer` avoids temp files entirely.
- Kit 3 moves `svelte.config.js` content into `sveltekit({...})` inside `vite.config.ts`. The inline-plugin approach is unaffected.
- **Bun:** the reference project runs `bun --bun vite dev`. I only verified the launcher under Node. Running it under `bun --bun` should behave the same (Vite's JS API), but **test it**. The plugin must be compatible with both Vite 7 and 8 (rolldown): use only stable hooks (`transform`, `configureServer`, `hotUpdate`/`handleHotUpdate`).
- Report 01 says how the shell spawns the dev server. Replace `bun --bun vite dev` with `bun --bun <launcher> <dir> <port>` when the `dev` script is a plain Vite call. For custom scripts (`concurrently …`), fall back to `__svelte_meta` only, with the bridge injected by the preload (below).

**The plugin's responsibilities:**

```ts
export function codesigner(opts): Plugin {
  return {
    name: 'codesigner',
    enforce: 'pre',
    configureServer(server) {
      // 1. RPC for the editor: /__codesigner/* (or a ws channel: server.ws.on('codesigner:*'))
      server.middlewares.use('/__codesigner', rpcHandler(opts));
      // 2. Inject the bridge into HTML documents. SvelteKit does NOT call transformIndexHtml in dev;
      //    it only string-replaces </head> to add /@vite/client (kit/src/runtime/server/utils.js).
      //    So wrap res.end for text/html responses and add:
      //    <script type="module" src="/@id/__x00__virtual:codesigner/bridge"></script>
      //    [UNVERIFIED] risks: streamed/chunked HTML (kit can stream), stale content-length header
      //    (delete it before writing). Fallback: preload runs, in the MAIN world,
      //    webFrame.executeJavaScript("import('/@id/__x00__virtual:codesigner/bridge')")
      server.middlewares.use(injectBridgeIntoHtml);
    },
    resolveId: (id) => (id === 'virtual:codesigner/bridge' ? '\0virtual:codesigner/bridge' : undefined),
    load: (id) => (id === '\0virtual:codesigner/bridge' ? bridgeSource : undefined),
    // 3. Know when a .svelte module was (re)compiled → per-file "served version" (§7.3)
    transform: { order: 'pre', handler(code, id) { if (id.endsWith('.svelte')) noteServed(id, code); } },
    hotUpdate(ctx) { /* see §7.2: class-only fast path (optional) */ }
  };
}
```

**Why the bridge must run in the page's main world:** `__svelte_meta` is a JS expando property on DOM objects, and expandos are **per JavaScript world**.
- An Electron `<webview>` preload with `contextIsolation` runs in an isolated world. It **cannot see** `__svelte_meta` (standard isolated-world semantics; not tested here).
- So either the Vite plugin serves the bridge as a module (preferred: it gets `import.meta.hot` for `vite:afterUpdate`), or the preload injects it into the main world (`webFrame.executeJavaScript` / `contextBridge.executeInMainWorld`).
- In the main world the bridge can still subscribe to HMR events: `const { createHotContext } = await import('/@vite/client'); const hot = createHotContext('/__codesigner'); hot.on('vite:afterUpdate', …)`.

### 3.6 Optional: compile-time `data-cd-*` attributes

Verified working via the launcher above: a plugin transform parsed with `{ modern: true }` inserted `data-cd="src/routes/+page.svelte:<offset>"` after each `RegularElement` tag name, and SSR HTML came back with `<main data-cd="src/routes/+page.svelte:41" class="p-4">`.

| | `__svelte_meta` (primary) | Injected `data-cd-*` attribute |
|---|---|---|
| Needs a plugin | No (dev mode is enough) | Yes (launcher) |
| Visible in SSR HTML / before hydration | No | **Yes** |
| CSS-selectable (`[data-cd="…"]`), visible from an isolated world | No | **Yes** |
| Instance and loop context | **Yes** (parent chain) | Only what you encode |
| Components | **Yes** (frames) | Must **not** inject on `Component` nodes: they would land in `...restProps` and change runtime behaviour, or be dropped |
| Perturbs the code | No | Columns shift for later elements on the same line, so `__svelte_meta` columns drift. Inject at a position that does not shift the next tag's offset, or encode the original offset in the attribute and stop using meta columns. Requires a sourcemap (`magic-string.generateMap`) |
| Risk | Dev-only private API: the field name changed once (`filename`→`file`, 5.0-next) and `parent` was added in 5.35.1 | Duplicate-attribute errors if a spread already sets it (unlikely); slower compile |

**Recommendation:** ship `__svelte_meta` first. Keep the attribute injector behind a flag for two cases: the pre-hydration selection overlay, and a fallback if the private field changes. The bridge should feature-detect: `'__svelte_meta' in Element.prototype`.

---

## 4. Parsing and surgical editing of `.svelte`

### 4.1 Parser and AST [verified]

`import { parse } from 'svelte/compiler'; parse(src, { modern: true })` returns:

```ts
Root {
  options, module?: Script, instance?: Script, css?: StyleSheet,
  fragment: Fragment { nodes: (RegularElement | Component | SvelteElement | Text | ExpressionTag |
                               IfBlock | EachBlock | SnippetBlock | RenderTag | DeclarationTag | Comment | …)[] }
  comments
}
RegularElement { type, start, end, name, name_loc, attributes: (Attribute | SpreadAttribute | ClassDirective | StyleDirective | BindDirective | OnDirective | AttachTag …)[], fragment }
Component      { type: 'Component', name: 'Button' | 'Card.Root', attributes, fragment }
Attribute      { name, start, end, value: true | ExpressionTag | (Text | ExpressionTag)[] }
Text           { start, end, raw, data }
ExpressionTag  { start, end, expression: ESTree (acorn + TS; has start/end) }
Script.content: ESTree Program (TS-aware, via @sveltejs/acorn-typescript)
```

Observed shapes:

- `class="flex gap-2"` gives `value: [Text{raw:'flex gap-2'}]`.
- `class="a {b}"` gives `[Text, ExpressionTag]`.
- `class={cn('text-sm', item && 'font-bold')}` gives `ExpressionTag{ expression: CallExpression{ callee: cn, arguments: [Literal, LogicalExpression] } }`.
- `class={['a', active && 'b', { c: x }]}` gives an `ExpressionTag` with an `ArrayExpression`.
- `class:d={y}` is a `ClassDirective`; `style:width="10px"` is a `StyleDirective`.
- `{const z = 1}` in markup is a `DeclarationTag` (5.56+).

Every node has absolute `start`/`end`, so magic-string can edit any of them. Walk with `zimmerframe` (what Svelte uses) or a tiny recursive visitor.

### 4.2 Printing: what exists

- **`svelte/compiler` `print(ast, { indent })`**, added in **5.45.0** (PR #16188) and actively fixed through 5.57.
  - It is built on `esrap` and handles Svelte, TS and CSS.
  - It **normalizes formatting**: it re-indents with tabs, adds blank lines between blocks and imports, and reflows [verified: the round-trip output differed from the input].
  - **Use it only to serialize newly built fragments** (e.g. a generated `<div class="flex flex-col gap-2">`). Even that is often easier as a string template.
- **esrap 2.4**: the JS printer (with sourcemaps) under `print()`.
- **svelte-ast-print 1.1.0**: community printer, last published 2025-05. Superseded.
- **prettier + prettier-plugin-svelte 3.x**: formats a whole file. Use it only if the file was already Prettier-clean before our edit (check with `prettier.check`) **and** the user opted in. Otherwise we'd produce whole-file diffs, which is Onlook's mistake.
- **magic-string**: the core. `overwrite`, `prependLeft`/`appendRight`, `remove`, `move`, `indent(str, { exclude })`, `generateMap`. Svelte itself depends on `magic-string ^0.30`; 1.x is current. Either works for our use.

### 4.3 Class editing strategy

Rules:
- **Edit only static string material.** That means `Text` chunks of attribute values and string `Literal`s / `TemplateLiteral` quasis without expressions inside JS expressions.
- **Never rewrite an expression's structure** unless the user explicitly asks.
- Preserve each chunk's internal whitespace and newlines; replace tokens in place.

```ts
import MagicString from 'magic-string';

/** Replace/remove/add tokens inside one static class chunk, preserving surrounding whitespace. */
function editTokens(s: MagicString, chunk: { start: number; raw: string }, ops: { remove: string[]; add: string[] }) {
  const tokens = [...chunk.raw.matchAll(/\S+/g)];                    // keep positions
  for (const m of tokens) if (ops.remove.includes(m[0])) {
    const a = chunk.start + m.index!, b = a + m[0].length;
    // also eat one adjacent space so we don't leave double spaces
    const nextSpace = /\s/.test(chunk.raw[m.index! + m[0].length] ?? '') ? 1 : 0;
    s.remove(a, b + nextSpace);
  }
  if (ops.add.length) {
    // insertion point: canonical Tailwind order (prettier-plugin-tailwindcss uses ds.getClassOrder)
    const insertAt = pickInsertPosition(chunk, tokens, ops.add);     // see below
    s.appendLeft(insertAt.pos, insertAt.prefix + ops.add.join(' ') + insertAt.suffix);
  }
}
```

Per attribute form:

| Source form | Where tokens are read | Where edits go |
|---|---|---|
| `class="…"` (all `Text`) | the text | `editTokens` on the text chunk |
| `class="… {expr} …"` (mixed) | `Text` chunks are editable. Tokens inside `expr` are shown as **conditional/dynamic, read-only** (or editable per §4.3.1 if the expr is a ternary of literals) | The *last* static chunk for additions. Removals wherever the token lives |
| `class={cn('base', cond && 'x', className)}` | Literal args: the unconditional ones are "base". Args under `&&`/`?:` become **states** labelled with the condition source text (`active`) | Base edits go to the **first unconditional Literal** (Onlook pushes a new arg each time, which grows `cn` calls forever; don't). If there's no Literal arg (`cn(buttonVariants(...), className)`), additions insert a new Literal arg right after the callee's first argument or at the end |
| `class={['a', cond && 'b', { c: x }]}` (≥5.16) | Literal elements are base; `&&` and object keys are states | Same as `cn` |
| `class={x}` (identifier/member/call without literals) | dynamic, unknown | Read-only. On "add class", rewrite to `class={[x, 'p-4']}` (native clsx, no import needed). If the file imports `cn`, prefer `class={cn(x, 'p-4')}` so conflicts still merge at runtime |
| `class:foo={…}` | show as a state | Read-only (3 occurrences in the reference app) |
| no `class` attribute | — | Insert ` class="…"` right after the last attribute, or after the tag name. Use double quotes (Svelte convention; Prettier keeps `"` for attributes even with `singleQuote`) |
| Component instance `<Button class="…">` | the `class` prop | Same rules. shadcn components merge it (`cn(buttonVariants(…), className)`), so it behaves as an instance override |
| Inside `tv({...})` in `<script module>` (editing a component's variants) | string Literals in `base`, `variants.X.Y`, `compoundVariants[i].class` | Same `editTokens` on the Literal's inner range (`lit.start + 1 … lit.end - 1`) |

**Prototype output** [verified]. The input was a realistic slice of `+error.svelte`, and the edits were: `p-6`→`p-8` in a static class, `mt-2` appended inside `cn('…')`, `variant="outline"`→`"secondary"`, and an `h1` text replacement. Only those bytes changed; the comment, the multi-line mixed class with `{active ? … : …}`, the double space and the tabs were all untouched.

**Ordering added classes:** call `ds.getClassOrder(tokens)`. It returns a `bigint` order per class, with `null` for non-Tailwind classes. Insert the new token before the first existing token whose order is greater. This matches what `prettier-plugin-tailwindcss` would produce, so a later `prettier --write` makes no diff. Non-Tailwind tokens (`null`) stay where they are.

#### 4.3.1 Conditional classes as "states" (optional, v2)

A ternary of literals `{active ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}` maps nicely to a Framer-like **variant switch** (`active: true | false`).
- Each branch's Literal is editable through `editTokens`.
- The panel shows a toggle that previews a branch by patching DOM classes (§7.2). It never changes app state.

### 4.4 Structural edits

Use one helper for indentation. The naive wrap in the prototype produced misindented output: the wrapped `<Button>` line and the closing `</div>` were off by a tab. Indentation must be computed, not guessed:

```ts
const indentUnit = detectIndent(src);            // '\t' in the reference app (.prettierrc useTabs) — sniff the file, fall back to prettier config
const lineIndent = (pos: number) => src.slice(src.lastIndexOf('\n', pos - 1) + 1, pos).match(/^[\t ]*/)![0];

/** Wrap sibling nodes [first..last] in a new element, re-indenting the wrapped range by one unit.
 *  SKETCH (untested): check magic-string's ordering of indent() vs appendLeft() at the same position,
 *  or simply build the replacement string for [rangeStart, last.end] by hand and overwrite(). */
function wrap(s: MagicString, first: Node, last: Node, open = '<div class="flex flex-col gap-2">', close = '</div>') {
  const base = lineIndent(first.start);
  const rangeStart = src.lastIndexOf('\n', first.start - 1) + 1;   // start of first line
  s.indent(indentUnit, { exclude: [[0, rangeStart], [last.end, src.length]] });   // indent every line in range
  s.appendLeft(rangeStart, `${base}${open}\n`);
  s.appendRight(last.end, `\n${base}${close}`);
}
```

| Operation | Recipe | Gotchas |
|---|---|---|
| **Insert** element/component | Build a string such as `<div class="…"></div>` with the target indent and insert it at `parent.fragment` position *k*: after node *k-1*'s `end` plus newline and indent. For a component, also add an import (below) | Parent may be a block (`{#if}` body), which is fine because blocks have fragments too. Inside `{#each}` the insert repeats per item; warn |
| **Add import** for a component (`Button`, `* as Card`) | Find `instance.content.body` `ImportDeclaration`s. If a matching specifier exists, reuse it. Else `appendLeft(lastImport.end, '\n\timport { Button } from \'$lib/components/ui/button/index.js\';')`. If there's no instance script, prepend `<script lang="ts">\n\timport …\n</script>\n\n` | Respect the project's quote style and the `.js` suffix convention (the reference app uses `…/index.js`). Kit 3 introduces `#lib`, so read the existing imports to learn the alias |
| **Remove** | `s.remove(lineStartIfOnlyWhitespaceBefore(node.start), node.end + trailingNewline)` | Remove the preceding `<!-- comment -->` if it is directly attached (Onlook-like) |
| **Reorder / move within file** | `s.move(startOfLine(node), endOfLine(node), targetPos)`, then re-indent if the depth changes | magic-string `move` can't move overlapping ranges, so apply one move per transaction |
| **Move across files** | Disallow in v1, or treat it as copy+delete with a warning. Identifiers referenced in the moved markup may not exist in the target | Detect free identifiers via `ExpressionTag` walks |
| **Wrap** in Stack/Grid | `wrap()` above. Stack = `flex flex-col gap-2`, Row = `flex gap-2`, Grid = `grid grid-cols-2 gap-2` | Selection must be contiguous siblings in the same fragment and file |
| **Unwrap** | Replace the element range with its `fragment` source, de-indented by one unit | Keep the children's own classes |
| **Duplicate** | Copy `src.slice(start, end)` after the node | |
| **Text edit** | Allowed if the element's fragment is a single `Text` node, or `Text` plus simple inline elements edited as "rich text" later. Overwrite `Text.start..end`. Escape `{` as `{'{'}` (or `&#123;`) and `<` as `&lt;` | `{t('key')}` or `{item.name}` stays read-only, with an "edit in code" link. i18n strings are a later feature |
| **Component prop** `<Button variant="outline">` | `Attribute` with `value: [Text]` → overwrite the text range. With `value: ExpressionTag{Literal}` → overwrite the literal. Missing → insert ` variant="…"` after the tag name or last attribute. Boolean `true` → `disabled` shorthand | If the attribute comes from a spread (`{...rest}`), it's read-only. Show "set via spread" |

### 4.5 Editability matrix (summary)

| Node | Classes | Text | Structure | Props |
|---|---|---|---|---|
| RegularElement in user file, static context | ✅ | ✅ (static text) | ✅ | n/a |
| … inside `{#each}` | ✅ (template, ×N badge) | static ✅, expression ❌ | ✅ (template) | — |
| … inside `{#if}` | ✅ | ✅ | ✅ | — |
| … inside `{#snippet}` | ✅ (warn: shared) | ✅ | ✅ | — |
| Component instance (user component) | via `class` prop ✅ | children text ✅ | ✅ (move, delete, wrap) | ✅ (`tv` variants, literal props) |
| Component definition (Edit main) | ✅ | ✅ | ✅ | `tv()` variants editor |
| Library-rendered DOM (node_modules) | ❌ → select the nearest user instance | ❌ | ❌ | via the instance |
| `{@html}` / dynamic `<svelte:element this>` | ❌ | ❌ | ❌ (move/delete the host element only) | — |

---

## 5. Tailwind v4 engine

### 5.1 Programmatic design system [verified]

```ts
import { __unstable__loadDesignSystem } from '@tailwindcss/node';   // resolves @import / @plugin relative to base
const css = await fs.readFile(`${root}/src/app.css`, 'utf8');
const ds = await __unstable__loadDesignSystem(css, { base: `${root}/src` });   // 66 ms on the reference app
```

Reference-app results:

| API | Result |
|---|---|
| `ds.candidatesToCss(['bg-primary','md:w-[237px]','dark:bg-navy-50/50','not-a-class'])` | `.bg-primary{background-color:var(--primary)}`, `@media (width >= 48rem){.md\:w-\[237px\]{width:237px}}`, `.dark\:bg-navy-50\/50:is(.dark *){background-color:color-mix(in oklab,var(--navy-50) 50%,transparent)}`, `null` |
| `ds.getClassOrder(['p-4','flex','md:p-2','text-sm','bogus'])` | `p-4:1n, flex:0n, md:p-2:3n, text-sm:2n, bogus:null` |
| `ds.getClassList()` | 26,744 entries, including the custom `bg-navy-50` etc. from `@theme inline` |
| `ds.getVariants()` | `* not group peer first-letter … hover focus … sm md lg xl 2xl … dark` (incl. `@custom-variant dark`) |
| `ds.resolveThemeValue('--color-primary')` | `var(--primary)`. Also `--radius-lg` = `var(--radius)`, `--spacing` = `0.25rem`, `--breakpoint-md` = `48rem` |
| `ds.canonicalizeCandidates(['w-[16px]','p-[8px]'], { rem: 16 })` | `['w-4','p-2']`. Without `rem`, only rem-valued arbitrary values canonicalize (`mt-[1rem]`→`mt-4`). `rounded-[10px]` stays, because `--radius-lg` is `var(--radius)`, not a literal |
| `ds.parseCandidate('md:hover:bg-primary/90')` | `{ kind:'functional', root:'bg', value:{named:'primary'}, modifier:{named:'90'}, variants:[hover, md] }` |
| `ds.theme.entries()` | 1,244 theme keys (breakpoints, radius, colors, spacing …) |

It is "unstable", but it's the same entry point used by the Tailwind language server and `prettier-plugin-tailwindcss`. Pin the Tailwind version you test against, and load the **project's own** `@tailwindcss/node` via `createRequire(projectDir)` so behaviour matches the app.

Reload the design system when `app.css` (or anything it `@import`s) changes. `compile()` reports dependencies; watch those.

### 5.2 Conflict removal: use the design system, not tailwind-merge

Problem cases [verified with tailwind-merge 3.7.0]:

- `twMerge('text-sm text-body')` keeps both, because it guesses `text-body` is a color.
- `twMerge('shadow-xs shadow-elevation-md')` keeps both.

The reference app defines custom `--elevation-*`, `--color-navy-*` and `--radius-*` tokens, so these misclassifications are real. `extendTailwindMerge` can be generated from the theme, but it is a second source of truth.

The design system tells us exactly which CSS properties a candidate sets:

```ts
function propsOf(ds, candidate: string): Set<string> {
  const out = new Set<string>();
  const visit = (n) => {
    if (n.kind === 'at-rule' && n.name === 'property') return;              // skip @property registrations
    if (n.kind === 'declaration' && !n.property.startsWith('--tw-')) out.add(n.property);
    n.nodes?.forEach(visit);
  };
  ds.candidatesToAst([candidate])[0]?.forEach(visit);
  return out;
}
// p-4 → {padding}; px-2 → {padding-inline}; text-sm → {font-size, line-height}; text-primary → {color};
// size-4 → {width, height}; rounded-lg → {border-radius}; hover:bg-primary/90 → {background-color}
```

Rule: when the panel sets property group **G** under variant chain **V** (e.g. `md:hover:`), remove existing tokens with the same variant chain whose property set intersects G's **expanded** properties. Use a small static shorthand table:

```ts
const EXPAND = {
  padding: ['padding','padding-inline','padding-block','padding-top','padding-right','padding-bottom','padding-left','padding-inline-start','padding-inline-end'],
  margin: [/* same shape */], inset: [/* top/right/bottom/left/inset-inline/... */],
  'border-radius': ['border-radius','border-top-left-radius', /* … */ 'border-start-start-radius' /* … */],
  'border-width': [...], 'border-color': [...], gap: ['gap','column-gap','row-gap'],
};
```

Setting `p-4` removes `px-*`/`pt-*`. Setting `px-2` removes only `px-*`/`pl-*`/`pr-*`, and keeps `p-4` because Tailwind's order already makes `px-2` win. This is the same semantics as tailwind-merge, but driven by the user's actual theme.

Cache `propsOf` per candidate. Keep tailwind-merge only for runtime parity checks.

### 5.3 Framer panel → Tailwind mapping

Read: parse each token (`ds.parseCandidate`), bucket by `root` and variant chain, and fill the controls. For the "actual" readout, also read `getComputedStyle` from the bridge, since the value may come from a component's internals.

Write: build the candidate, `canonicalizeCandidates([c], { rem: 16 })`, check `candidatesToCss([c])[0] !== null`, remove conflicts (§5.2), then insert in canonical order.

| Framer control | Value | Tailwind output (preferred → fallback) |
|---|---|---|
| **Width** Fixed | 240 px | `w-60` (spacing scale: px/4, any number is valid in v4: `w-61`, `w-[237px]` only if fractional) |
| Width Fill | — | parent flex-row: `flex-1 min-w-0` (or `grow basis-0`). Otherwise `w-full` |
| Width Fit | — | `w-fit` (`w-auto` in flex contexts) |
| Width Relative | 50% | `w-1/2` → `w-[50%]` |
| Height Fixed/Fill/Fit | | `h-*` / `h-full` (flex-col parent: `flex-1 min-h-0`) / `h-fit`. Viewport: `h-svh`/`min-h-svh` (used in the reference app) |
| Min/Max W/H | | `min-w-*`, `max-w-*` (`max-w-md` theme containers), `min-h-*`, `max-h-*` |
| Aspect ratio | 16:9 | `aspect-video` / `aspect-[4/3]` |
| **Layout** Stack direction | H/V | `flex flex-row` / `flex flex-col` |
| Distribute | start/center/end/space-between/around/evenly | `justify-start|center|end|between|around|evenly` |
| Align | start/center/end/stretch/baseline | `items-start|center|end|stretch|baseline` |
| Wrap | yes | `flex-wrap` |
| Gap | 8 / (x,y) | `gap-2` / `gap-x-2 gap-y-4` |
| Padding | all / H-V / 4 sides | `p-4` / `px-4 py-2` / `pt- pr- pb- pl-` (prefer logical `ps-`/`pe-` only if the file already uses them) |
| Grid | cols/rows/gap | `grid grid-cols-3 gap-4`, `grid-rows-*`; child `col-span-2`, `row-span-*`; template: `grid-cols-[200px_1fr]` |
| **Position** | relative/absolute/fixed/sticky | `relative`, `absolute`, `fixed`, `sticky` + `top-0 left-4 inset-0 inset-x-0` + `z-10` |
| Overflow / Clip | | `overflow-hidden`, `overflow-auto`, `overflow-x-auto` |
| Opacity | 50% | `opacity-50` → `opacity-[0.37]` |
| Visible | | `hidden` / `block` (or `invisible`) |
| **Fill** | token / hex / gradient | `bg-primary` (token list from theme `--color-*`) → `bg-[#0d5ca5]` → `bg-linear-to-r from-navy-700 to-navy-500`. Alpha: `bg-primary/90` |
| **Radius** | all / per-corner | `rounded-lg` (theme `--radius-*`) / `rounded-tl-md` → `rounded-[14px]` |
| **Border** | width/style/color | `border`, `border-2`, `border-dashed`, `border-border`, per side `border-t` |
| **Shadow** | preset / custom | `shadow-xs…2xl` (theme `--shadow-*`), `shadow-[var(--elevation-md)]` for the reference app's custom elevation vars (or register them as `--shadow-elevation-md` in `@theme` and use `shadow-elevation-md`) |
| Blur | | `blur-sm`, `backdrop-blur-md` |
| **Typography** | family/size/weight/line height/letter spacing/color/align/transform/decoration | `font-sans`, `text-sm` (theme `--text-*`) → `text-[13px]`, `font-medium`, `leading-6`, `tracking-tight`, `text-muted-foreground`, `text-center`, `uppercase`, `underline`, `truncate` / `line-clamp-2`, `whitespace-nowrap` |
| Cursor / pointer events | | `cursor-pointer`, `pointer-events-none` |
| Transform | rotate/scale | `rotate-3`, `scale-95`, `-translate-y-1` |
| Transition | | `transition-all duration-200 ease-out` |

### 5.4 Breakpoints, dark mode and states

**Breakpoints:** Tailwind is mobile-first (`md:` = `min-width: 48rem`); Framer's breakpoints are frames.
- Read breakpoint frames from the theme (`--breakpoint-sm…2xl`; users may add their own).
- Editing in a frame of width W writes to the **largest breakpoint ≤ W** (base for the smallest frame).
- The panel shows inherited values from smaller breakpoints greyed out, like Framer's "inherited from Desktop", with the cascade inverted.
- Offer `max-md:` (desktop-first) only as an advanced toggle.
- Container queries (`@container`, `@md:`) are a later feature.

**Dark mode:** the reference app uses `@custom-variant dark (&:is(.dark *));` with `mode-watcher`.
- Preview by toggling `document.documentElement.classList` in the frame via the bridge.
- Style edits made while "Dark" is active write `dark:`-prefixed tokens.
- Token edits go to the `.dark { … }` block (§5.5).

**States** (`hover:`, `focus-visible:`, `active:`, `disabled:`, `aria-invalid:`, `data-[state=open]:` from bits-ui) are written as variant prefixes. To *preview* a state:
- In Electron, use `webContents.debugger` → CDP `CSS.forcePseudoState({ nodeId, forcedPseudoClasses: ['hover'] })`. This is exactly DevTools' `:hov`. It requires resolving a CDP `nodeId` (`DOM.pushNodesByBackendIdsToFrontend` / `DOM.querySelector` on a temporary `data-cd-sel` attribute).
- For `data-[state=open]`, temporarily set the attribute on the element.

### 5.5 Reading and editing design tokens in `app.css`

The reference `app.css` has:
- raw scales on `:root` (`--navy-50…900`, `--gold-*`, `--neutral-*` in `oklch()` with hex comments)
- shadcn semantic vars on `:root`/`.dark` (`--primary: var(--navy-700)`)
- `@theme inline { --color-primary: var(--primary); --radius-sm: 6px; … }`
- `@custom-variant`
- `@plugin '@tailwindcss/typography'`
- `@import 'tw-animate-css'`

**Read with PostCSS** [verified]:

```ts
import postcss from 'postcss';
const root = postcss.parse(src);                 // root.toString() === src  → true (byte-identical)
const tokens: Record<string, Record<string, string>> = {};
root.walkRules(r => { if (r.selector === ':root' || r.selector === '.dark')
  r.walkDecls(/^--/, d => { (tokens[d.prop] ??= {})[r.selector] = d.value; }); });
root.walkAtRules('theme', at => at.walkDecls(/^--/, d => { (tokens[d.prop] ??= {})[`@theme ${at.params}`] = d.value; }));
// 155 tokens; --primary → { ':root': 'var(--navy-700)', '.dark': 'var(--navy-400)' }; --color-primary → { '@theme inline': 'var(--primary)' }
```

**Edit** by setting `decl.value` and calling `root.toString()`. Changing `--navy-700` produced exactly one changed line, and kept its trailing `/* #083763 */` comment [verified]. For maximum safety, use magic-string on the decl's `source.start/end` offsets instead of `toString()`. Both approaches preserve formatting.

**Token model for the UI:**

| Layer | Example | How the UI treats it |
|---|---|---|
| Utility namespace (`@theme` / `@theme inline`) | `--color-primary` → `bg-primary`, `--radius-lg` → `rounded-lg`, `--breakpoint-md` → `md:` | Defines which classes exist. Inline means classes emit `var(--primary)` and not the literal value |
| Semantic var (`:root` / `.dark`) | `--primary: var(--navy-700)` / `.dark { --primary: var(--navy-400) }` | "Color style" with light/dark values. Editing changes the reference or literal |
| Raw scale | `--navy-700: oklch(0.333 0.091 251.81)` | Palette swatches |

**Resolve values for swatches:**
- Follow `var()` chains through the parsed token map (light and dark separately).
- Convert `oklch()` to sRGB for display with **culori** (or `colorjs.io`).
- Computed fallback: ask the bridge for `getComputedStyle(document.documentElement).getPropertyValue('--primary')`, with and without `.dark`.

**Do not use lightningcss for editing.** It re-serializes the whole file and drops comments and formatting. It's fine for *analysis*.

**Adding a token:** append a decl at the end of the right block (`:root`, `.dark` and, if it should generate utilities, `@theme inline { --color-x: var(--x); }`), copying the indentation of the previous decl.

After every write, reload the design system so new classes appear in the class list.

---

## 6. Component properties panel and isolated component canvas

### 6.1 Props extraction [verified on the reference `button.svelte`]

Tier 1 is static and fast. It covers shadcn-svelte.

- **`$props()` destructuring** from `ast.instance.content`: find `VariableDeclarator` with `init` = `$props()`. For each property, record the name, local alias, default source text, `$bindable(...)` detection, and `...rest`. The reference button gives:

  `class→className`, `variant='default'`, `size='default'`, `ref=$bindable(null)`, `href=undefined`, `type='button'`, `disabled`, `children`, `...restProps`, plus the type annotation `ButtonProps`.

- **`tv()` variants** from `ast.module.content` (`<script module>`): find `CallExpression` with callee `tv`. Read `variants` → `{ variant: [default, brand, destructive, outline, secondary, navy, tertiary, navyOutline, ghost, quiet, link], size: [default, sm, lg, row, icon, icon-xs, icon-sm, icon-lg] }` and `defaultVariants` → `{ variant:'default', size:'default' }`.
  - **These are the "Variants"** in Framer terms. The panel shows enum dropdowns, and the "Edit main component" view shows each variant's class string (editable via `editTokens` on the Literal).
  - JSDoc comments on variant keys (the reference app has many, e.g. `/** Navy text + Navy-200 border … */`) can be read from `ast.module.content` comments and shown as tooltips.
  - Mapping a prop to its `tv` axis: the `$props()` name equals the variant key (`variant`, `size`). Check that the template calls `buttonVariants({ variant, size })`.
- **Snippet props** (`children`, `child` from bits-ui): typed as `Snippet`, so show them as "slot content", not editable values.

Tier 2 is TypeScript, for non-tv components and union types like `'a' | 'b'`. Use `svelte2tsx` (0.7.62), as svelte-check does:
- Convert each `.svelte` into TSX in a custom `ts.LanguageServiceHost`. Map `*.svelte` imports to the generated code, and resolve the kit aliases `$lib` / `$app` from `.svelte-kit/tsconfig.json`.
- Create a probe file: `import C from '…/button.svelte'; type P = import('svelte').ComponentProps<typeof C>;`.
- Enumerate `checker.getPropertiesOfType(P)`. For each property, take `getTypeOfSymbol` and unions of string literals as enum options. Filter the inherited `HTMLButtonAttributes` noise by declaration file (`svelte/elements`).
- It is expensive (hundreds of ms per component on a warm program), so run it in a worker and cache by file hash.
- Alternatives: `sveld` (0.38.7, runes-aware docs generator) or `svelte-docgen` (0.1.0, too early).

**Discovering components:** glob `src/lib/components/**/*.svelte` and the barrel `index.ts` files.
- shadcn-svelte uses `index.ts` with `export { Root, Root as Button, … }`, so the "component name" users write is the barrel export (`Button`, or `Card.Root` via `import * as Card`).
- Parse the barrels with acorn/TS to build the `importPath + exportName → file` map. The same map drives "insert component".

### 6.2 Rendering a component in isolation (component canvas)

Approach: a route-less preview page served by our Vite plugin.

```
GET /__codesigner/preview?c=src/lib/components/ui/button/button.svelte&props=<json>
 → HTML (served by our middleware): <link app.css> + <script type="module" src="/@id/__x00__virtual:codesigner/preview-entry?c=...">
virtual:codesigner/preview-entry:
   import '/src/app.css';
   import { mount } from 'svelte';
   import C from '/src/lib/components/ui/button/button.svelte';
   import { decorators } from 'virtual:codesigner/decorators';   // optional user/editor-provided wrappers
   mount(Wrapper, { target: document.getElementById('root'), props: { component: C, props, decorators } });
```

- Use `server.transformIndexHtml` on our own HTML to get the Vite client and HMR.
- Props are JSON (strings, enums, booleans). Snippet props (`children`) come from a tiny generated wrapper `.svelte` (virtual module) that renders `<C {...props}>{text}</C>`.

Concerns:
- **`$app/*` imports** (`$app/state`, `$app/navigation`, `$app/environment`). Kit's Vite plugin resolves them, but they expect the kit client runtime to have started.
  - `page` from `$app/state` will be empty and `goto()` will misbehave outside a kit page.
  - Fix: alias them **only for the preview entry's module graph** to mock modules. Do it via `resolveId` keyed on an importer chain that starts at the preview entry, or by serving the preview under a distinct `?cd-preview` query so the importer IDs differ.
  - Storybook's `@storybook/sveltekit` does the same: it mocks `$app/state` / `$app/navigation` / `$app/forms` / `$app/stores`, with `parameters.sveltekit_experimental` overrides and actions logging for `goto` [reported].
- **Context-dependent components:** `Tooltip.Content` needs `Tooltip.Provider`, `Sidebar.*` needs `Sidebar.Provider`, superforms/formsnap fields need a form context, and `Dialog.Content` needs `Dialog.Root` open.
  - Provide **decorators**, as Storybook does. Keep a built-in table for shadcn-svelte families (render `X.Root` + `X.Trigger` + `X.Content` with `open`), plus user-defined decorators in a `.codesigner/` folder (opt-in).
  - Fallback: "show instances in context", which lists usages found by import scan and opens a page frame scrolled to one.
- **Server-only data:** components that receive `data` from `load` get sample props, or are marked "needs data".
- **SSR:** the preview is client-only (`mount`), which is fine for design.

A cheaper alternative for v1 is to skip isolation and show components **in situ**: the component panel lists instances on the current page.

---

## 7. Live update loop

### 7.1 What happens on a write [source + verified]

1. We write `foo.svelte` (atomically: write a temp file, then rename).
2. Vite's watcher (chokidar) fires. vite-plugin-svelte recompiles. Svelte 5 HMR (`compilerOptions.hmr`, on by default in dev) accepts the update at the component level.
3. In the browser, the `hmr()` wrapper swaps `current` → `block` re-runs → **`destroy_effect(effect)` on the old instance and `branch(() => component(anchor, props))` creates the new one** [source: `svelte/src/internal/client/dev/hmr.js`].
   - This happens for **every instance** of that component.
   - Props are re-passed, so parent state survives. **Local `$state` of that component and of every child inside it is reset**, transitions are suppressed, and **all DOM nodes in that subtree are new objects**.
   - Editing `+page.svelte` remounts the page (the layout survives). Editing `button.svelte` remounts every button.
4. `@tailwindcss/vite` rescans the changed module for candidates. If new classes appear, the CSS module updates through CSS HMR (no remount).
5. Editing `app.css` (tokens) is a CSS-only HMR, which is cheap and keeps state.
6. `+page.ts` / `+page.server.ts` / `+layout.*` edits cause a kit data reload or a full page reload. We don't edit those in v1.

### 7.2 Optimistic preview (instant feedback, fewer HMR cycles)

During a drag or slider scrub, **don't write files**:
- Patch DOM classes on **all live elements sharing the `loc`**. The bridge keeps a `loc → Set<Element>` index, rebuilt lazily.
- Make sure the CSS exists. Tailwind only generates used classes, so `p-13` may have no rule yet. The engine calls `ds.candidatesToCss(newTokens)` and pushes the CSS to the bridge, which keeps a single `<style id="codesigner-preview">` in `<head>`.
- On pointer-up, commit the file write once. Remove the preview `<style>` after the HMR + CSS update lands (`vite:afterUpdate` plus a check that the class's rule now exists).

**Class-only fast path (optional, UNVERIFIED).** When a commit changes only class tokens in static `Text`/`Literal` chunks:
- The DOM is already correct (optimistic patch), so the remount, and its state loss, is pure cost.
- The plugin's `hotUpdate`/`handleHotUpdate` hook could return `[]` for that `.svelte` module (suppressing the JS HMR) while letting the CSS module update through.
- Caveat: the browser now runs stale compiled code. Any later re-render of that block (an `{#if}` toggle, an `{#each}` item added) will create elements with the **old** class until the next real HMR or reload.
- Mitigations: flush a deferred real HMR when the user leaves Design mode or after N seconds idle; or never fast-path elements inside `each`/`if` frames.
- Prototype this before promising it.

### 7.3 Versioning and staleness (must-have)

Between our write and the HMR apply, `__svelte_meta` line/column values in the page refer to the **old** text. Model it explicitly:

```ts
type FileState = {
  path: string;
  version: number;            // increments on every change we observe (ours or external)
  text: string;               // current disk content
  hash: string;               // sha1(text)
  servedHash?: string;        // hash of the text the browser currently runs (set when vite:afterUpdate for this module arrives,
                              //   correlated with our plugin's transform() which recorded hash(code) for that id)
  lastWrittenHash?: string;   // what WE last wrote — used to tell our writes from external edits
  ast?: AST.Root;             // parsed lazily, keyed by hash
};
```

- Interpret DOM locations against `servedHash`'s text. Keep the last few texts by hash, in a small LRU.
- If `servedHash !== hash`, either:
  - **(a, simplest)** queue further edits on that file until the bridge reports `vite:afterUpdate` covering it (typically under 100 ms), with a timeout that shows "waiting for dev server…"; or
  - **(b)** map offsets from the served text to the current text through our own edit log (magic-string edits are a list of `(pos, deleteLen, insertLen)`).
- **Always validate on lookup**: tag name, plus `name === componentTag` for instances (§3.2). On mismatch, re-resolve via NodeRef (§3.4).
- After any HMR, previously selected `Element` objects may be detached. Re-select by NodeRef → loc → `document` query through the bridge's loc index.

### 7.4 External edits (agent / editor / git)

- Watch with the Vite server's own watcher (`server.watcher.on('change', …)` in our plugin), so there's no second watcher. Our engine also gets file events from the shell for files outside Vite's graph.
- On change: `hash(newText)`:
  - If it equals `lastWrittenHash`, it is our own echo: ignore.
  - Otherwise it is **external**. Bump the version, drop the cached AST, re-resolve selections via NodeRef, reload the design system if it's `app.css` or its imports, and **mark undo entries for that file as "rebased-needed"**.
- **Write guard:** before writing, compare the on-disk hash with `FileState.hash` (the base we computed the edit on). If they differ (an agent wrote in between), re-parse, re-apply the semantic operation (ops are semantic, e.g. "set padding on NodeRef X"), and write. Never blindly overwrite.
- For agent integration (report 03): agents edit files directly, and we only re-sync. Keep the canvas read-only on a file while an agent's turn is in progress (lock indicator).

### 7.5 Undo/redo across file writes

A transaction journal of **semantic ops plus file snapshots**:

```ts
type Txn = {
  id: string; label: string;                    // "Set padding 16 on <div> (+page.svelte)"
  files: { path: string; beforeHash: string; afterHash: string; before: string; after: string }[];  // usually 1, sometimes 2 (component + app.css)
  ops: SemanticOp[];                             // for re-application after external edits
};
```

- **Undo:** for each file, if the current hash equals `afterHash`, write `before`.
- If the current hash differs (external edit since), **3-way merge** with `node-diff3` (base = `after`, ours = `before`, theirs = current). If that's clean, apply it; otherwise refuse with "file changed outside codesigner; undo unavailable" and offer "open diff".
- **Redo** is symmetric.
- **Coalescing:** slider drags become one txn (written on pointer-up). Typing in a text field becomes one txn per blur, or per 1 s idle.
- Cross-file atomicity: write all files of a txn, then wait for HMR. If one write fails, roll back the others from `before`.
- Persist the journal per worktree/branch (`.git/codesigner/` or app data) so undo survives restarts, but **invalidate on branch switch**.
- Safety net: since the shell runs projects in a **git worktree** (Onlook's model, report 01/03), a "checkpoint" button = `git commit` on the codesigner branch. Always-available rollback costs nothing.

---

## 8. RECOMMENDED APPROACH

### 8.1 Architecture

```
┌──────────────────── Electron main / utilityProcess: "sync engine" (Node) ───────────────────────┐
│  FileStore      versions, hashes, LRU texts, write guard, atomic writes, watcher echo filter      │
│  SvelteDoc      parse(modern) → AST index (by start offset, NodeRef paths), magic-string editor │
│  Ops            setClasses / setProp / setText / insert / remove / move / wrap / unwrap /       │
│                 addImport / editTvVariant / setToken  (semantic, re-applicable)                 │
│  TailwindDS     project's @tailwindcss/node → loadDesignSystem(app.css); propsOf(); order;      │
│                 canonicalize; candidatesToCss for previews; token map via PostCSS               │
│  Components     barrel index → file map; $props()/tv() extraction; (worker) svelte2tsx types     │
│  Journal        txns, undo/redo, 3-way merge on conflict                                        │
└──────────────▲──────────────────────────────────────────────────────────────────▲───────────────┘
               │ RPC (ws via /__codesigner or IPC)                                 │ IPC
┌──────────────┴────────── user's dev server (launcher → vite.createServer) ──────┴───────────────┐
│ user vite.config plugins (tailwindcss(), sveltekit()) + codesigner() plugin (inline, not on disk) │
│   • serves virtual:codesigner/bridge (+ HTML injection middleware)                               │
│   • transform(): records served hash per .svelte; optional data-cd attrs (flag)                 │
│   • hotUpdate(): HMR notifications; optional class-only fast path                               │
│   • /__codesigner/preview: isolated component page with $app/* mocks + decorators               │
└──────────────▲──────────────────────────────────────────────────────────────────────────────────┘
               │ module script in the page's MAIN world
┌──────────────┴───────────── bridge (in each <webview>/frame) ─────────────────────────────────┐
│ hit-testing → __svelte_meta {loc, parent frames}; loc→elements index; rects for overlay;        │
│ optimistic class/text patches; <style id=codesigner-preview>; dark/state toggles;               │
│ vite:afterUpdate → re-index + report served versions                                           │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Decisions

1. **Mapping:** `__svelte_meta` (dev only, no source changes) is primary. Compile-time `data-cd` stays behind a flag. **Never write IDs into user files.**
2. **Selection semantics:** a click selects the nearest *user-source* component **instance** (Framer-like). "Edit main component" enters the definition. `each` means template editing with a ×N badge. Snippets carry a "shared" warning. Library DOM resolves to the nearest user instance. Expression text is read-only.
3. **Editing:** modern AST plus magic-string byte-range edits only, with indentation-aware structural helpers. Svelte `print()` is only for building new snippets. Prettier never runs implicitly.
4. **Classes:** edit `Text` chunks and unconditional string literals. Conditionals are shown as states. `class={x}` becomes `class={[x, '…']}` (or `cn(x, '…')` if `cn` is imported). Order by `getClassOrder`. Validate and resolve conflicts via the design system (CSS-property sets per variant chain), not tailwind-merge.
5. **Tokens:** PostCSS read/modify on `app.css` (`:root`, `.dark`, `@theme`/`@theme inline`). Use exact-range writes; reload the design system after every write.
6. **Props/variants:** static `$props()` + `tv()` extraction (enough for all shadcn-svelte components). svelte2tsx + TS checker in a worker for everything else.
7. **Live loop:** optimistic DOM + preview CSS during gestures, then a single write on commit. Per-file versioning with the served hash; edits block until HMR acks (option a). Accept HMR state loss in v1; prototype the class-only fast path later.
8. **Safety:** write guard (hash compare plus re-apply semantic ops), journal with 3-way-merge undo, git worktree checkpoints.

### 8.3 Build order

| Phase | Deliverable | Exit test |
|---|---|---|
| P0 | Launcher + plugin + bridge. Hover/click shows `file:line:col` and the frame chain on the reference app | Clicking any shadcn `Button` selects the `<Button>` call site; clicking an `{#each}` row shows ×N |
| P1 | FileStore + SvelteDoc + `setClasses` on static/mixed/cn/array forms + design-system validation and conflicts + journal undo | 200 random class edits across the reference app produce diffs touching only the class bytes; `prettier --check` stays green on files that were already clean |
| P2 | Style panel (§5.3) + breakpoints/dark + optimistic preview CSS | Slider drag = 0 writes until release; 1 write and 1 HMR after |
| P3 | Text, props (`variant`/`size` from `tv()`), insert/remove/move/wrap + imports | Wrapping 2 siblings in Stack produces correctly indented output (tabs) |
| P4 | Token editor (PostCSS) + color styles light/dark | Editing `--primary` changes 1 line and live-updates without a remount |
| P5 | External-edit sync + agent locks + 3-way undo; component isolation page with `$app/*` mocks and decorators | An agent edit mid-session never gets clobbered; undo after an external edit merges or refuses cleanly |

---

## 9. Risks and open questions

- **Private API:** `__svelte_meta` is dev-only and undocumented. It has changed before (`filename`→`file`; `parent` added in 5.35.1).
  - Mitigation: feature-detect, pin the tested Svelte range, run a CI smoke test against the latest Svelte, and keep the `data-cd` injector as the fallback.
- **Preprocessed offsets:** locations are computed on post-preprocess source. This is safe with the default `vitePreprocess()` (styles only) unless a style block above the markup changes its line count. Projects with `vitePreprocess({ script: true })` or svelte-preprocess (pug, etc.) can drift. Validate every lookup.
- **Bun runtime:** the launcher was only verified under Node. Verify `bun --bun launcher.mjs` with Vite 7 and Vite 8.
- **Kit 3 / Vite 8 (rolldown):**
  - The plugin hooks used here are stable, but `transform.order` interplay with vite-plugin-svelte 7 must be re-tested.
  - Kit 3's `#lib` imports change the import-insertion logic.
  - Svelte config moving into `vite.config.ts` doesn't affect us.
- **`@tailwindcss/node` `__unstable__` API** may change in minor releases. Load the project's copy and pin integration tests per Tailwind minor.
- **HMR state loss** on every `.svelte` write is visible to users (open dialogs close, form inputs clear).
  - The class-only fast path is unverified and has a stale-render caveat.
  - Consider "freeze state" tricks later (snapshotting `$state` is not possible generically).
- **Isolated-world caveat:** an Electron preload cannot read `__svelte_meta`. The bridge must live in the main world.
- **Bridge HTML injection is unverified:** wrapping `res.end` in a middleware placed before SvelteKit's handler was not tested. Watch for streamed responses and `content-length`. The fallback is a main-world `import()` from the preload.
- **Library-rendered DOM** (most interactive shadcn-svelte pieces render through bits-ui in `node_modules`) always maps to the nearest user instance [verified with bits-ui `Button.Root`]. Per-element styling inside library components is only possible through props/`class` that the user component forwards.
- **Unconfirmed prior art:** the mechanisms behind Fusion, Tempo and Codux are not public. "Codux discontinued" rests on one third-party listing.

---

## 10. Sources

- Svelte source (5.56.8 in the reference app; 5.57.2 latest):
  - `src/internal/client/dev/elements.js` (`add_locations`, `assign_location`)
  - `src/internal/client/context.js` (`add_svelte_meta`, `dev_stack`)
  - `src/compiler/phases/3-transform/client/transform-template/index.js` (`build_locations`)
  - `src/compiler/phases/3-transform/client/visitors/shared/utils.js` (`add_svelte_meta` types)
  - `src/internal/client/dev/hmr.js`
  - `src/compiler/print/index.js`
  - `src/compiler/state.js` (`offsetLine: 1`)
- Svelte CHANGELOG: https://github.com/sveltejs/svelte/blob/main/packages/svelte/CHANGELOG.md (`print` #16188 in 5.45.0; `__svelte_meta` parent #16255 in 5.35.1; clsx class #14714 in 5.16.0; template declarations #18282 in 5.56.0)
- vite-plugin-svelte source: `src/preprocess.js`, `src/utils/options.js`, `src/plugins/preprocess.js`; inspector `src/runtime/Inspector.svelte` — https://github.com/sveltejs/vite-plugin-svelte
- SvelteKit source: `src/core/config/index.js` (`load_config`, `load_config_from_vite`), `src/runtime/server/utils.js` (`@vite/client` injection) — https://github.com/sveltejs/kit
- Vite `resolveConfig` merge: `vite/dist/node/chunks/config.js` (`mergeConfig(loadResult.config, inlineConfig)`) — https://vite.dev/guide/api-javascript
- Onlook: https://github.com/onlook-dev/onlook (`packages/parser/src/{ids.ts,code-edit/*.ts,template-node/map.ts,prettier}`, `packages/constants/src/editor.ts`, `apps/web/client/src/components/store/editor/ast/README.md`); issues [#1738](https://github.com/onlook-dev/onlook/issues/1738), [#1672](https://github.com/onlook-dev/onlook/issues/1672), [#898](https://github.com/onlook-dev/onlook/issues/898); https://docs.onlook.com/developers/architecture
- code-inspector-plugin Svelte transform: https://github.com/zh-lx/code-inspector/blob/main/packages/core/src/server/transform/transform-svelte.ts
- svelte-trace: https://github.com/git002/svelte-trace
- Svelte "What's new" June 2026 (Dialyma, svelte-visual-builder): https://svelte.dev/blog/whats-new-in-svelte-june-2026 ; https://github.com/BluePointDigital/svelte-visual-builder ; https://github.com/michael/svedit
- Builder.io Fusion: https://www.builder.io/blog/introducing-fusion
- Codux: https://smashingmagazine.com/2023/06/codux-react-visual-editor-improves-developer-experience ; https://alternativeto.net/software/codux/about/
- Pinegrow Vue Designer: https://pinegrow.com/vue-designer ; https://docs.pinegrow.com/docs/vue/vite-plugin/
- Storybook SvelteKit mocking: https://storybook.js.org/docs/get-started/frameworks/sveltekit
- SvelteKit 3 pre-release notes: https://releases.sh/collections/frontend-frameworks/digest/2026-07-06 ; https://www.youngju.dev/blog/2026-07-17-sveltekit-3-pre-release-what-breaks.en
- Tailwind v4 `DesignSystem` type: `tailwindcss/dist/lib.d.mts`; `@tailwindcss/node` `__unstable__loadDesignSystem` — https://github.com/tailwindlabs/tailwindcss
- tailwind-merge: https://github.com/dcastil/tailwind-merge ; tailwind-variants: https://www.tailwind-variants.org
- PostCSS: https://postcss.org ; magic-string: https://github.com/Rich-Harris/magic-string ; esrap: https://github.com/sveltejs/esrap ; svelte2tsx: https://github.com/sveltejs/language-tools/tree/master/packages/svelte2tsx ; sveld: https://github.com/carbon-design-system/sveld

### Verification log (scratch, outside both repos)

- `t2/run.mjs`: compiled two components with `dev: true` and mounted them in jsdom 30, then dumped `__svelte_meta` for `each`/`if`/component/children/snippet cases.
- `kitapp` + `launcher/launch.mjs`: kit 2.70.3, vite 7.3.7, bits-ui. Covered inline-plugin injection via `createServer`, `data-cd` in SSR HTML, and `__svelte_meta` read in a real browser (root-relative `file`, bits-ui node_modules frames).
- `t2/edit.mjs`: magic-string edits (static class token, `cn()` literal, component prop, text, naive wrap that showed the indent problem).
- `t2/tw.mjs`, `t2/tw2.mjs`: `__unstable__loadDesignSystem` on the reference `app.css` (timing, CSS, order, class list, variants, theme, canonicalize, parseCandidate, CSS property sets) and tailwind-merge misclassification.
- `t2/css.mjs`: PostCSS byte-identical round-trip and a one-line token edit on the reference `app.css`.
- `t2/props.mjs`: `tv()` variants and `$props()` extraction from the reference `button.svelte`.
