# 01 — Desktop shell, embedding, packaging, process management, i18n

Status: research / decision record · Date: 2026-10-18 · Author: research agent for "codesigner" (placeholder name)

> **TL;DR** Use **Electron (44.x now, 45 is due ~2026-10-20)**. Build the editor UI as a **SvelteKit 3 SPA** (adapter-static with `fallback`), served in production through a privileged `app://` custom protocol. Use **electron-vite 6** for main and preload, with SvelteKit as its own Vite project.
>
> Render every canvas viewport as an **Electron `<webview>` tag**. Each sits inside a CSS-transformed (pan and zoom) canvas, and all of them use **one shared `partition="persist:preview"`** so a single login covers every viewport and worktree. Inject the selection and hit-testing bridge through a **webview preload**. Draw overlays in the host DOM.
>
> Package with **electron-builder 26 + electron-updater 6 (GitHub Releases)**. Without an Apple Developer ID, macOS auto-update is **impossible**, so ship a "notify and download" fallback. Use **Paraglide JS 2** for i18n.
>
> Tauri 2, Electrobun, Wails and Neutralino are all rejected for this use case. Reasons are in §1.

Legend: **[verified]** = checked against a primary source (docs, source code, npm registry) during this research. **[verify]** = plausible or second-hand; confirm in the Phase-0 spike.

---

## 0. Version snapshot (npm registry, 2026-10-18)

| Package | Version | Notes |
|---|---|---|
| `electron` | **44.9.0** (Chromium 152, Node 24.22) | 45.0.0-beta.5 (Chromium 156) is out, with stable expected ~2026-10-20 [verified releases.electronjs.org] |
| `electron-builder` | **26.15.3** latest / 26.17.0 (`v26` tag) / 27.0.0-alpha.10 (`next`) | The v27 docs on master describe *signed Ed25519 update manifests*, which are mandatory there. That is **not** in 26.x yet [verified] |
| `electron-updater` | **6.8.9** (6.8.10 on `v26` tag), 7.0.0-alpha.9 next | [verified] |
| `electron-vite` | **6.0.0** (2026-10-14), peer `vite ^6‖^7‖^8` | No SvelteKit template, only plain `svelte-ts` [verified] |
| `@electron-forge/cli` | 8.0.1 (2026-09-29) | [verified] |
| `@sveltejs/kit` | **3.1.0** (3.0.0 released 2026-10-01) | peers: `vite ^8.0.12`, `svelte ^5.57.1`, `typescript ^6`, `@sveltejs/vite-plugin-svelte ^7`; Node ≥ 22.17 [verified] |
| `@sveltejs/adapter-static` | 4.0.0 | Still supports `fallback` (SPA) and `strict` [verified from package types] |
| `svelte` | 5.57.2 | |
| `tailwindcss` | 4.3.3 | |
| `@inlang/paraglide-js` | **2.29.0** (2026-10-15) | A plain Vite/unplugin plugin with no Kit peer dependency, so it works with Kit 3 [verified] |
| `svelte-i18n` | 4.0.1 | |
| `typesafe-i18n` | 5.27.1 | Previous release was 2023-08. Effectively in maintenance mode |
| `fix-path` | 5.0.0 (ESM, uses `shell-path`) | |
| `execa` | 10.2.0 (Node ≥ 22) | |
| `node-pty` | 1.1.0 | Native module that needs an Electron rebuild |
| `@supabase/ssr` | 0.12.7 | Default cookie options `{ path:"/", sameSite:"lax", httpOnly:false, maxAge: 400d }`. The browser client writes cookies through **`document.cookie`** [verified in package source] |
| `@tauri-apps/cli` / `tauri` crate | 2.12.x | `WebviewBuilder` / multi-webview is still behind the **`unstable`** cargo feature [verified docs.rs 2.12.4] |
| `electrobun` | 2.0.2 (v1 early 2026; 2.0 adds a new build tool/runtime and multiple main-process runtimes) | |

---

## 1. Shell framework: Electron vs Tauri 2 vs Electrobun / Wails / Neutralino

### 1.1 What this app actually needs from the shell

1. **A full Node toolchain in-process.** Several pieces are Node-native:
   - `svelte/compiler`, `magic-string`, `postcss`
   - `lightningcss` and `@tailwindcss/node`/`oxide`, which are native `.node` addons
   - `child_process` for dev servers, git and agent CLIs
   - file watching (`@parcel/watcher` / `chokidar`)
2. **Several live, interactive embeddings of `http://localhost:<port>`.** These need:
   - script injection at document start
   - pan and zoom inside an infinite canvas
   - one persistent, shared cookie jar, so auth works and survives restarts
   - DevTools per viewport
3. **A rendering engine that matches what designers expect.** It should be one engine on every OS, with Chromium being the dominant engine the user's users run.
4. **Offline operation, no backend, GitHub-hosted updates.**
5. **No Rust on the dev machine.**

### 1.2 Comparison

| Criterion | **Electron 44/45** | **Tauri 2.12** | **Electrobun 2.x** | Wails v3 / Neutralino |
|---|---|---|---|---|
| Node in main process | ✅ Node 24 built in, with `utilityProcess` for workers | ❌ Rust core. Needs a **Node/Bun sidecar** (`bun build --compile` ≈ 60–100 MB) plus a stdio/WebSocket RPC layer | ✅ **Bun** main process. Bun's Node-compat covers most of this, but native addons such as lightningcss/oxide under Bun need checking [verify] | Go (Wails) or extension processes (Neutralino) still need a Node sidecar |
| Rust or other toolchain | none | **Rust required** for anything beyond config (custom commands, multi-webview wiring). Not installed here | none (Zig is bundled, prebuilt) | Go toolchain (Wails) |
| Engine | **Chromium everywhere** (same version on all OSes) | **WKWebView** (macOS), **WebView2/Chromium** (Windows), **WebKitGTK** (Linux): three engines. The CEF runtime is only an alpha (`tauri-cef` v3 alphas) [verified] | WKWebView by default on macOS, optional bundled **CEF**. CEF is effectively required on Windows/Linux for the webview tag [verified docs] | System webviews (same split as Tauri) |
| Embedding pages in a transformable DOM element | ✅ **`<webview>`** is an OOPIF-backed DOM element. CSS `transform: scale()` works. Responsively App (Electron 44.5) and Onlook desktop (Electron 36) both ship this [verified in source] | ❌ Child webviews (`Window::add_child`, `unstable`) are **native views layered over the window**. They can't be CSS-transformed and always sit above the DOM. The other option, iframes, hits WebKit ITP third-party-cookie blocking (see §2) | ❌ `<electrobun-webview>` is a **"positional anchor" in the DOM driving a separate native BrowserView** (still true in 2.x docs). It can't be CSS-transformed, and z-index needs "mask selectors" [verified docs] | ❌ iframes only |
| Script injection | webview `preload` (isolated world, runs before page scripts), `executeJavaScript`, `insertCSS`, `contextBridge.executeInMainWorld` | `initialization_script` / `initialization_script_for_all_frames` [verified] | preload per webview | limited |
| Cookie/session control | `session.fromPartition('persist:x')`, `session.cookies`, `webRequest` header hooks, `setUserAgent`, `clearStorageData` | `data_directory` (Win/Linux), `data_store_identifier` (macOS ≥ 14 only), `incognito` [verified]. `on_web_resource_request` **does not run for external URLs such as a dev server** [verified] | "webview partitions" [verified blog] | minimal |
| DevTools per embedded page | ✅ `webview.openDevTools()`, or `setDevToolsWebContents` to dock it in-app | Safari Web Inspector on macOS (release builds need the `devtools` feature) | CEF DevTools / Safari | varies |
| Bundle size (macOS arm64 DMG) | ~100–130 MB [verify after first build] | ~5–15 MB **plus** the sidecar → ~70–110 MB in practice | ~15 MB with WKWebView, ~120 MB+ with CEF | small |
| Maturity / precedent for this exact app type | VS Code, Cursor, Figma desktop, Polypane, Responsively, Sizzy, Onlook desktop | Fine for typical apps. No precedent for a "multi-viewport live canvas" | v1 early 2026, v2 recent; small community, fast-moving API | low |

### 1.3 Verdict

**Electron wins decisively for this product.** The deciding factors, in order:

1. **`<webview>` is the only mainstream primitive that is a real browser tab** (own top-level browsing context, own process, first-party cookies, document-start preload) **and also a DOM element you can scale and pan with CSS.** Every alternative forces either a native overlay (no zoom) or an iframe (third-party-cookie and auth breakage).
2. **Chromium on every OS.** A design tool that renders differently on macOS (WebKit) and Windows (Chromium) produces "it looked right in the editor" bugs. With Electron, what you see in the canvas is what Chrome users see, on every OS. Known gap: no WebKit/Safari preview. If needed later, add "open in Safari" or a Playwright-WebKit screenshot.
3. **Node is already in the box.** All of the source-editing libraries run in the main process or a `utilityProcess`. There is no sidecar RPC layer to build, version or sign.
4. No Rust needed.

Tauri's size advantage disappears once a Node sidecar is bundled. Its WKWebView embedding model is the wrong shape for a zoomable canvas. Revisit **Electrobun** in 2027 if its CEF path matures and it gets transformable OOPIFs; it is the closest philosophically, being Bun-native. As of 2.x its webview tag is still a native overlay anchored to a DOM rect.

---

## 2. Embedding the user's app: iframe vs `<webview>` vs `WebContentsView`

### 2.1 The cookie / SameSite problem, precisely

- A cookie's **"site"** is *scheme + registrable domain*. **Ports are ignored.** Comparison is **schemeful**: `http://localhost` ≠ `https://localhost` ≠ `app://…`.
- Electron shells normally load the UI from `file://` (opaque origin) or a custom scheme (`app://`). An iframe pointing at `http://localhost:5173` is then a **cross-site subframe**:
  - **`SameSite=Lax` (and `Strict`) cookies are neither sent nor accepted** on its requests. Supabase's `@supabase/ssr` uses `sameSite: "lax"` by default [verified]. The SvelteKit server hook sees no session, and `+layout.server.ts` redirects to `/login` forever.
  - Even `SameSite=None` cookies are "third-party". They depend on third-party-cookie policy, and **storage (localStorage/IndexedDB) is partitioned** by top-level site in modern Chromium [verify for Electron 44].
- **Header rewriting via `session.webRequest.onHeadersReceived`** (forcing `SameSite=None; Secure`) is **not robust**:
  1. `@supabase/ssr`'s **browser client writes and refreshes cookies with `document.cookie`** [verified]. Network hooks never see those writes. You would have to monkey-patch `document.cookie` in the main world as well.
  2. `SameSite=None` requires `Secure`. Chromium treats `http://localhost` as potentially trustworthy, but cross-scheme (`app://` → `http:`) behaviour around `Secure` cookies on localhost is murky [verify].
  3. Every auth library behaves differently (Lucia/Better-Auth/Auth.js/custom). The editor would be fighting the user's security model.
- **`X-Frame-Options` / CSP `frame-ancestors`.** SvelteKit apps with `kit.csp` or hook-set headers can forbid framing. You can strip these in `webRequest.onHeadersReceived`, scoped to the preview session only. That part is fine; the cookie problem is the real blocker.
- **In WKWebView (Tauri/Electrobun on macOS)** the iframe route is likely worse: WebKit's ITP / full third-party-cookie blocking applies to WKWebView apps [verify].

**Why `<webview>` (and `WebContentsView`) solve it:** each guest is its **own top-level browsing context in its own WebContents**. To the user's app, `http://localhost:5173` is the top-level site, so its `Lax` cookies are first-party. Logging in works exactly as in Chrome, with no header hacks and no changes to user code.

### 2.2 Cookie scoping across worktrees: a useful property

Cookies are **not port-scoped**. Dev servers for worktree A (`:5173`) and worktree B (`:5174`) on `localhost` **share the same cookie jar** when they live in the same Electron partition. Logging in once logs every worktree in. That is the desired UX.

Things to watch:
- `localStorage` **is** per-origin (port matters). Apps using non-SSR `supabase-js` (localStorage sessions) will need a login per port.
- `localhost` and `127.0.0.1` are **different sites**. Always use one host consistently: pass `--host localhost`, or open `http://localhost:<port>`.
- Branches pointing at different Supabase projects get different cookie names (`sb-<ref>-auth-token`), so they don't collide.
- Supabase **redirect allow-list**: per-worktree ports mean OAuth and magic-link redirects to `http://localhost:5174/auth/callback` must be allowed. Supabase supports glob patterns such as `http://localhost:*/**` [verify the port wildcard].

### 2.3 Options evaluated

| | `<iframe>` (shell on `app://`) | `<iframe>` (shell on `http://localhost:<editorPort>`) | **`<webview>`** | `WebContentsView` |
|---|---|---|---|---|
| Auth with Lax cookies | ❌ cross-site | ✅ same-site (ports ignored) | ✅ first-party | ✅ first-party |
| CSS pan/zoom inside the canvas | ✅ | ✅ | ✅ (OOPIF composited with transforms) | ❌ native layer above the DOM; only `setBounds`, plus `enableDeviceEmulation({scale})` hacks |
| HTML overlays drawn above the page | ✅ | ✅ | ✅ (host DOM above the element) | ❌ needs a second transparent view on top |
| Process isolation from the editor UI | ⚠️ separate process (cross-site OOPIF) | ⚠️ **same site → likely same renderer process as the editor**, so a heavy user app can jank the editor [verify] | ✅ own process per guest | ✅ |
| Document-start script injection | `nodeIntegrationInSubFrames` + preload, or `webFrameMain.executeJavaScript` | same | ✅ `preload` attribute (forced in `will-attach-webview`) | ✅ `webPreferences.preload` |
| Framing headers | must strip XFO/`frame-ancestors` | must strip | not applicable (not framed) | n/a |
| Official status | fine | fine | **"not recommended"** in docs due to architecture divergence, but **not deprecated**. Disabled by default since Electron 5 (`webviewTag: true`) [verified] | recommended replacement for BrowserView (deprecated since Electron 29) |

**About the `<webview>` "not recommended" warning.** The Electron docs say the tag's divergence from Chromium "impacts the stability of `webviews`, including rendering, navigation, and event routing". They advise iframes or `WebContentsView` instead [verified]. In practice it remains supported, tested and shipped by major apps:
- **Responsively App** is on Electron 44.5.1 and uses `<webview style="transform: scale(zoomfactor)">` with a webview preload [verified source: `desktop-app/src/renderer/components/Previewer/Device/DeviceFrame.tsx`].
- **Onlook desktop** (v0.2.33, Electron 36) used `<webview>` frames inside a `translate(x,y) scale(s)` canvas, plus a webview preload bridge and a "GestureScreen" overlay [verified source: `apps/studio/src/routes/editor/WebviewArea/Frame.tsx`, `Canvas/index.tsx`].
- Polypane and Sizzy are Electron multi-pane browsers, believed to be `<webview>`-based [verify; not confirmed from source].

Removal would be a breaking change with a long deprecation cycle. Mitigate the risk with an abstraction (§2.6).

### 2.4 How comparable tools handle viewports and auth

- **Polypane**: one session shared across all panes by default (cookies, localStorage, sessionStorage), so logging in once carries over. Optional named per-pane sessions exist for testing different users. Their docs note some sites refuse simultaneous logins from many panes [verified polypane.app/docs/mental-model, session-management].
- **Responsively App**: `<webview>` per device with **no `partition` attribute**, so the default session is shared and logging in once works everywhere. Zoom uses CSS `transform: scale()` on the webview with `origin-top-left`. The outer box is sized `width*zoom × height*zoom`. Guest security is hardened in `will-attach-webview` [verified].
- **Onlook (desktop, 2024–25)**: `<webview>` frames on a pan/zoom canvas.
  - Mouse events in design mode are captured by a transparent overlay div (`GestureScreen`) on top of each webview.
  - That div converts client coordinates to guest coordinates (dividing by the canvas scale).
  - It then calls `webview.executeJavaScript('window.api.getElementAtLoc(x,y)')`, implemented by the webview preload.
  - Overlays (hover/click rects, measurement, resize handles) are drawn in the host DOM.
  - Onlook later moved to a **web** app with iframes into cloud sandboxes, where auth is a non-issue because they control the origin [verified repo history].
- **Sizzy**: webview-based multi-device browser with synced sessions (closed source; not inspected).

### 2.5 Recommended architecture: webviews on a CSS canvas, one shared partition

```
BrowserWindow (session: default / "persist:editor")  ← editor UI (SvelteKit SPA on app://)
└─ <div class="canvas" style="transform: translate(px,py) scale(s); transform-origin:0 0">
     ├─ <section class="frame" style="left:0;    width:1440px; height:900px">   Desktop
     │    ├─ <webview partition="persist:preview" src="http://localhost:5173/dashboard">
     │    └─ <div class="gesture-layer">   ← transparent, captures pointer in Design mode
     ├─ <section class="frame" style="left:1540px; width:810px; height:1080px"> Tablet
     └─ <section class="frame" style="left:2450px; width:390px; height:844px">  Phone
└─ <svg class="overlay">  ← selection/hover/handles, drawn in *screen* space from guest rects × s + offset
```

Key rules:

1. **Zoom with CSS `transform: scale()`, never `setZoomFactor`.**
   - `setZoomFactor`/`setZoomLevel` change the guest's **CSS px per device px**, which changes the layout viewport. A 390 px wide frame at zoom 0.5 would lay out at 780 CSS px and break breakpoint fidelity.
   - A CSS transform keeps the guest's layout viewport equal to the element's untransformed size (Responsively relies on this, using `offsetWidth` = guest viewport).
   - Call `webview.setZoomLevel(0)` on `dom-ready`, as Onlook does. Chromium zoom is per-origin and can leak between guests on the same origin.
2. **One persistent partition for all previews:** `partition="persist:preview"`.
   - It is persisted under `userData/Partitions/preview`. Keep it separate from the editor's own session so `clearStorageData` ("log out of preview") never touches editor state.
   - Call `session.fromPartition('persist:preview').flushStorageData()` on `before-quit`.
   - Optional per-frame session ("view as another user", Polypane-style): `persist:preview-<name>`. Note `partition` can only be set before first navigation [verified].
3. **Force the guest config in main** (do not trust renderer attributes):

```ts
// main/webview-guard.ts
import { app, session, type WebContents } from 'electron';
import path from 'node:path';

const PREVIEW_PARTITION = 'persist:preview';
const GUEST_PRELOAD = path.join(__dirname, '../preload/guest.cjs');

export function hardenWebviews(host: WebContents) {
  host.on('will-attach-webview', (_e, prefs, params) => {
    delete (prefs as any).preloadURL;
    prefs.preload = GUEST_PRELOAD;          // always our bridge
    prefs.nodeIntegration = false;
    prefs.contextIsolation = true;          // bridge runs in isolated world
    prefs.sandbox = true;                   // preload only needs ipcRenderer/contextBridge
    // one jar for every viewport. [verify] that overriding params.partition is honoured;
    // if not, keep the renderer attribute and e.preventDefault() when params.partition !== PREVIEW_PARTITION
    params.partition = PREVIEW_PARTITION;
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(params.src)) {
      // allow external only for auth flows you explicitly whitelist
    }
  });
  host.on('did-attach-webview', (_e, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      // OAuth popups: open as a child BrowserWindow on the SAME partition (see 2.7)
      return { action: 'allow', overrideBrowserWindowOptions: {
        webPreferences: { partition: PREVIEW_PARTITION, contextIsolation: true, sandbox: true } } };
    });
  });
}

app.whenReady().then(() => {
  const s = session.fromPartition(PREVIEW_PARTITION);
  // Plain Chrome UA (drop "Electron/xx codesigner/x"): fewer bot/OAuth blocks.
  s.setUserAgent(s.getUserAgent().replace(/\s(Electron|codesigner)\/\S+/g, ''));
  // Only for preview session: allow the editor to frame/inspect if a user app sets CSP frame-ancestors
  // (not needed for <webview>, needed only for the iframe fallback)
});
```

4. **The bridge (guest preload) runs in an isolated world.** It shares the DOM, so `elementFromPoint`, `getComputedStyle`, `getBoundingClientRect` and `MutationObserver` all work. It does **not** share JS expandos.
   - Svelte 5's dev-mode `element.__svelte_meta` (file/line/col, valuable for DOM→source mapping) lives on **main-world** objects.
   - Read it with `contextBridge.executeInMainWorld({ func })` (Electron ≥ 35 [verify]) or `webFrame.executeJavaScript`, and pass results back via `CustomEvent`/`postMessage`.

```ts
// preload/guest.ts  (compiled to CJS; sandboxed preload)
import { ipcRenderer } from 'electron';

function describe(el: Element) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return { tag: el.tagName.toLowerCase(), rect: { x: r.x, y: r.y, w: r.width, h: r.height },
           styles: { display: cs.display, padding: cs.padding, margin: cs.margin, fontSize: cs.fontSize } };
}

ipcRenderer.on('bridge:hit-test', (_e, { id, x, y }) => {
  const el = document.elementFromPoint(x, y);
  ipcRenderer.sendToHost('bridge:reply', { id, el: el && describe(el) });
});

// push layout changes (HMR re-render, scroll, resize) so host overlays stay glued
const push = () => ipcRenderer.sendToHost('bridge:invalidate', { scrollX, scrollY });
addEventListener('scroll', push, { passive: true });
addEventListener('resize', push);
new MutationObserver(push).observe(document, { subtree: true, childList: true, attributes: true });
```

```svelte
<!-- editor: Frame.svelte (Svelte 5) -->
<script lang="ts">
  let { url, width, height, scale }: { url: string; width: number; height: number; scale: number } = $props();
  let wv: Electron.WebviewTag;
  const pending = new Map<number, (v: any) => void>();
  let seq = 0;

  $effect(() => {
    const onMsg = (e: Electron.IpcMessageEvent) => {
      if (e.channel === 'bridge:reply') { const [m] = e.args; pending.get(m.id)?.(m.el); pending.delete(m.id); }
    };
    const onReady = () => wv.setZoomLevel(0);
    wv.addEventListener('ipc-message', onMsg);
    wv.addEventListener('dom-ready', onReady);
    return () => { wv.removeEventListener('ipc-message', onMsg); wv.removeEventListener('dom-ready', onReady); };
  });

  function hitTest(e: PointerEvent) {
    const r = wv.getBoundingClientRect();              // already includes canvas transform
    const x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;  // inverse transform
    const id = ++seq;
    wv.send('bridge:hit-test', { id, x, y });
    return new Promise((res) => pending.set(id, res));
  }
</script>

<div class="relative" style="width:{width}px;height:{height}px">
  <!-- partition/preload are forced in main; attribute kept for clarity -->
  <webview bind:this={wv} src={url} partition="persist:preview" style="display:inline-flex;width:100%;height:100%"></webview>
  <div class="absolute inset-0" onpointermove={hitTest}></div>   <!-- gesture layer in Design mode -->
</div>
```

5. **Interaction modes** (Onlook pattern):
   - *Design mode*: the gesture layer is on and the guest receives no pointer events.
   - *Interact mode*: the gesture layer is `pointer-events:none`. The user clicks through to use the app normally, including logging in.
   - Wheel events over a webview go to the guest. For canvas pan/zoom, catch them on the gesture layer in Design mode. In Interact mode, use Space/Cmd-drag or a modifier to pan.
6. **Performance and limits:**
   - Every `<webview>` is a renderer process (~80–200 MB each with a SvelteKit dev app). Three breakpoints × a few worktrees adds up.
   - Mitigation: only keep frames that are on-screen or near the viewport *live*. Replace distant or zoomed-out frames with `webContents.capturePage()` snapshots. Note the open issue about degraded `capturePage` quality on transformed contents, [electron#44227](https://github.com/electron/electron/issues/44227).
   - Fractional scales can blur text or re-raster lazily; snap to a few raster-friendly scales while idle [verify on 44/45].
   - Each guest connects its own Vite HMR socket, which is fine.
7. **DevTools:** `wv.openDevTools()` (detached), or dock it into a panel via a `WebContentsView` + `guest.setDevToolsWebContents(view.webContents)`.

### 2.6 Keep an escape hatch: `PreviewSurface` abstraction

Hide the embedding behind an interface, for example `PreviewSurface { load(url); hitTest(x,y); onInvalidate(); capture(); openDevTools(); }`.

The fallback implementation, if `<webview>` regresses or is ever deprecated, is the **iframe-on-localhost** variant:
- Serve the editor UI itself from `http://localhost:<random editor port>` (a tiny static server in main, or `protocol.handle` + a loopback server).
- Then `http://localhost:5173` iframes are **same-site**: Lax cookies are sent and storage is not partitioned.
- Inject the bridge with `nodeIntegrationInSubFrames: true` + preload, or `webFrameMain.executeJavaScript` (find frames via `webContents.mainFrame.framesInSubtree`).
- Strip `X-Frame-Options`/`frame-ancestors` for the preview session only.

Costs: the editor runs on an http loopback origin (protect IPC with sender-URL checks plus a random port/token), there may be no process isolation, and you must watch for host consistency (`localhost` vs `127.0.0.1`).

### 2.7 OAuth inside the canvas

- **Email/password, magic link (opened in-canvas), GitHub OAuth**: work in a `<webview>` [verify GitHub].
- **Google OAuth**: Google blocks sign-in from embedded browser frameworks ("This browser or app may not be secure" / `disallowed_useragent`), and Electron is commonly detected. Mitigations, all fragile: a Chrome-like UA on the preview session; opening the OAuth popup as a real `BrowserWindow` on the **same partition** so the PKCE verifier cookie (stored by `@supabase/ssr`) and the final session cookie land in the shared jar. Documented fallback: "log in with email in the canvas" or a dev-only password login. Treat this as a known limitation to test in Phase 0 [verify].
- The PKCE `code_verifier` lives in a cookie in the partition. A callback opened in the *system* browser will fail the code exchange. The callback must load inside the preview partition.

### 2.8 Reverse proxy (same origin as the editor): not recommended

Idea: serve the user's app at `http://localhost:7000/__app/…` behind a proxy on the editor's origin, so the editor can reach into the iframe's DOM directly. Pitfalls:
- **Absolute URLs everywhere.** SvelteKit/Vite emit `/@vite/client`, `/src/...`, `/_app/immutable/...`, `/node_modules/.vite/deps/...`. Rewriting them requires either changing `paths.base` in the user's config (invasive, changes app behaviour) or brittle HTML/JS rewriting.
- **HMR WebSocket.** Vite's dev-server hardening (early 2025 CVE fixes) checks `Host`/`Origin` and uses a token. The proxy must forward `Upgrade`, keep `Host`, or the user must add `server.allowedHosts`.
- **Cookies and redirects.** `Set-Cookie; Path=/` and `Location: /login` escape the prefix. OAuth `redirect_to`, Supabase site URL and `url.origin` in server code all see the proxy origin.
- Service workers, `location.origin` logic, CSP and `fetch('/api')` behave differently.
- It does not avoid processes or isolation issues, and it makes the editor same-origin with arbitrary user code (security).

A proxy is only worth it for *non-cookie* concerns, such as injecting a script into HTML for a pure-browser build. The webview preload does that without a proxy.

### 2.9 `WebContentsView`: where it still fits

Use it for **non-canvas** surfaces:
- a full-window "Preview/Play" mode
- a docked DevTools panel
- hidden offscreen views for thumbnails: `offscreen: true` (+ `useSharedTexture` for GPU frames, advanced, needs a native module) [verified docs]

Avoid it for canvas frames. It can't be transformed, clipped by DOM, or overlaid by HTML.

---

## 3. SvelteKit inside Electron

### 3.1 Tooling choice

| Option | Verdict |
|---|---|
| **electron-vite 6** (main + preload only) **+ SvelteKit 3 as a separate Vite project** | **Recommended.** electron-vite gives fast main/preload builds, hot restart of main, preload reload, `externalizeDeps`, isolated preload builds and V8 bytecode (optional). SvelteKit keeps its own `vite dev` HMR untouched |
| electron-vite with SvelteKit as the `renderer` | Possible (community `sveltekit-adapters` work), but electron-vite controls `root`/`outDir`, which fights SvelteKit's output layout. No official template [verified] |
| Electron Forge 8 + `@electron-forge/plugin-vite` | Workable. Forge's Vite plugin has historically lagged Vite majors, and Forge's default Windows target is Squirrel.Windows. We prefer electron-builder's NSIS + `electron-updater` (§4) |
| `vite-plugin-electron` (used by Onlook) | Fine, but less structured than electron-vite |

### 3.2 Layout

```
codesigner/
  apps/editor/             SvelteKit 3 SPA (Tailwind 4, Paraglide)
    vite.config.ts         sveltekit({ adapter: adapter-static({ fallback: 'index.html' }) })
    src/routes/+layout.ts  export const ssr = false; export const prerender = false;
  apps/desktop/
    electron.vite.config.ts   main + preload (+ guest preload) only
    src/main/…               window, protocol, IPC handlers, process manager, git, updater
    src/preload/index.ts     editor preload (contextBridge API)
    src/preload/guest.ts     webview bridge
  packages/ipc-contract/     shared TypeScript types for IPC
  electron-builder.yml
```

**SvelteKit 3 config** (no `svelte.config.js` any more; options move into the Vite plugin [verified migration guide]):

```ts
// apps/editor/vite.config.ts
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    tailwindcss(),
    paraglideVitePlugin({ project: './project.inlang', outdir: './src/lib/paraglide',
                          strategy: ['localStorage', 'preferredLanguage', 'baseLocale'] }),
    sveltekit({ adapter: adapter({ fallback: 'index.html', strict: false }) })
  ],
  server: { port: 5199, strictPort: true }
});
```

Routing choice:
- With `app://` as a **standard + secure** privileged scheme and an SPA fallback in the protocol handler, the default `pathname` router works, and the SPA has a stable origin (`app://editor`) for localStorage and IndexedDB.
- `router: { type: 'hash' }` still exists in Kit 3 [verified types]. Use it only if you ever load via `loadFile` (`file://`).
- Kit 3 removed `$app/paths` `base`/`assets`; use `resolve()`/`asset()` [verified]. It also removed `$app/stores`; use `$app/state`.

**Kit 3 vs 2.70.** Kit 3 is 17 days old but stable on npm `latest`, and greenfield projects avoid a migration later. Its requirements (Vite 8, TS 6, Node 22.17) are fine because Electron 44 ships Node 24 and our dev toolchain is modern. Fallback: Kit 2.70 if a UI library's peer ranges block Kit 3 (most depend on `svelte`, not `@sveltejs/kit`).

### 3.3 Production loading: `app://` protocol with SPA fallback

```ts
// main/protocol.ts
import { protocol, net, app } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }
]);

export function registerAppProtocol() {
  const root = path.join(app.getAppPath(), 'editor');           // adapter-static output
  protocol.handle('app', async (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString()).catch(() => null);
    return res?.ok ? res : net.fetch(pathToFileURL(path.join(root, 'index.html')).toString());
  });
}
// window: dev → loadURL('http://localhost:5199'), prod → loadURL('app://editor/')
```

Set a strict CSP for the editor (`default-src 'self' app:`; `connect-src` for the GitHub update check).

### 3.4 Typed IPC with `contextIsolation` + preload

`electron-trpc` (last publish 2024-12) and `@electron-toolkit/typed-ipc` (2024-11) are stale. Use a **hand-written contract**: a single source of truth with no extra runtime.

```ts
// packages/ipc-contract/index.ts
export interface Invoke {
  'project:open':      (dir: string) => Promise<ProjectInfo>;
  'devserver:start':   (worktree: string) => Promise<{ id: string; url: string }>;
  'devserver:stop':    (id: string) => Promise<void>;
  'git:worktrees':     (repo: string) => Promise<Worktree[]>;
  'source:applyEdit':  (edit: StyleEdit) => Promise<EditResult>;
  'update:check':      () => Promise<UpdateInfo | null>;
}
export interface Events {            // main → renderer
  'devserver:log':  { id: string; chunk: string; stream: 'stdout' | 'stderr' };
  'agent:event':    { runId: string; event: unknown };
}
```

```ts
// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Invoke, Events } from '@codesigner/ipc-contract';
const api = {
  invoke: <K extends keyof Invoke>(ch: K, ...a: Parameters<Invoke[K]>) =>
    ipcRenderer.invoke(ch, ...a) as ReturnType<Invoke[K]>,
  on: <K extends keyof Events>(ch: K, cb: (p: Events[K]) => void) => {
    const l = (_: unknown, p: Events[K]) => cb(p); ipcRenderer.on(ch, l);
    return () => ipcRenderer.off(ch, l);
  },
  webviewPreloadPath: process.env.GUEST_PRELOAD!   // not needed if forced in will-attach-webview
};
contextBridge.exposeInMainWorld('codesigner', api);
export type CodesignerApi = typeof api;
```

```ts
// main/ipc.ts — typed handler registration with sender validation
export function handle<K extends keyof Invoke>(ch: K, fn: (...a: Parameters<Invoke[K]>) => ReturnType<Invoke[K]>) {
  ipcMain.handle(ch, (e, ...a) => {
    const u = new URL(e.senderFrame!.url);
    if (!(u.protocol === 'app:' || (isDev && u.origin === 'http://localhost:5199'))) throw new Error('forbidden');
    return fn(...(a as Parameters<Invoke[K]>));
  });
}
```

Validate payloads at runtime (valibot/zod) for anything touching the filesystem. Use `MessageChannelMain` ports for high-volume streams (dev-server logs, agent token streams) instead of thousands of `webContents.send` calls.

### 3.5 Dev workflow

- `pnpm --filter editor dev` runs SvelteKit HMR on `:5199`.
- `electron-vite dev --watch` builds main/preload, restarts main on change and reloads preloads; main loads `http://localhost:5199`.
- Wire both with one root script (`concurrently` or a Bun script). electron-vite's `ELECTRON_RENDERER_URL` is only set when it owns the renderer, so pass `EDITOR_URL` yourself.
- Heavy CPU work (svelte/compiler parses, Tailwind compile, git diff) goes to a **`utilityProcess`** so main stays responsive.
- Native modules (`node-pty`, `lightningcss`, `@tailwindcss/oxide`, `@parcel/watcher`) need `asarUnpack`. `node-pty` needs `electron-builder install-app-deps` / `@electron/rebuild`.
- Fidelity note: to compile the **user's** Svelte files, load their own `svelte/compiler` from their project (`createRequire(path.join(worktree, 'package.json'))('svelte/compiler')`), falling back to our bundled version.

---

## 4. Packaging and updates

### 4.1 electron-builder vs electron-forge

| | **electron-builder 26** | electron-forge 8 |
|---|---|---|
| Targets | dmg+zip (mac), NSIS (win), AppImage/deb/rpm/pacman (linux) | dmg/zip, Squirrel.Windows/MSIX/WiX, deb/rpm/flatpak/snap |
| Auto-update | **electron-updater** with a GitHub provider. Works on mac (Squirrel.Mac under the hood), Windows NSIS, **Linux AppImage/deb/rpm**. Staged rollouts, progress events [verified] | built-in `autoUpdater` + `update-electron-app`/update.electronjs.org. No Linux, needs signed mac |
| Signing/notarization | built in (`mac.notarize`, `CSC_LINK`, Azure signing options) | `@electron/osx-sign`, `@electron/notarize` |
| Verdict | **Recommended**: one config file for all three OSes plus GitHub update metadata (`latest*.yml`) | Fine, but weaker Linux update story |

Heads-up for **electron-builder 27** (alpha): update manifests (`latest*.yml`) must be **Ed25519-signed**, and publishing fails without a key unless `updateManifest: false`. `disableWebInstaller` defaults to true. Plan the key setup when upgrading [verified docs on master].

### 4.2 macOS signing and notarization

- **Auto-update requires signing.** The electron-builder docs say: "macOS application must be signed in order for auto updating to work" [verified]. Squirrel.Mac checks that the downloaded bundle satisfies the running app's designated requirement.
  - An **unsigned** app has none.
  - An **ad-hoc** signature (`identity: "-"`, needed for arm64 binaries to run at all) has a cdhash-only requirement that the next version can never match.
  - So **unsigned and ad-hoc apps cannot auto-update on macOS**.
- **Requirements for a smooth experience:**
  - Apple Developer Program ($99/yr)
  - a "Developer ID Application" certificate
  - hardened runtime + entitlements (`com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory` for V8; `disable-library-validation` if loading user native modules)
  - notarization via `notarytool` (App Store Connect API key recommended)
  - the `zip` target alongside `dmg` (required for `latest-mac.yml`) [verified]
- **Gatekeeper UX for unsigned downloads:**
  - Since **macOS 15 Sequoia**, the Control-click → Open bypass is gone. Users must try to open, then approve in **System Settings → Privacy & Security → "Open Anyway"** (admin password), or run `xattr -dr com.apple.quarantine /Applications/Codesigner.app` [verified 9to5mac/mjtsai coverage].
  - Apple Silicon quarantined ad-hoc apps often show "is damaged and can't be opened", which is confusing [verify on macOS 26].
  - **Homebrew 5** deprecated `--no-quarantine` and announced the end of support for casks that fail Gatekeeper on **2026-09-01**. An unsigned app can't go in `homebrew/cask`; a self-hosted tap is still possible, but users must remove quarantine themselves [verify current enforcement].
- **Decision item:** budget **$99/yr for Apple Developer ID from the first public release**. It is the only path to one-click install plus silent auto-update on the primary platform.

### 4.3 Windows

- **Unsigned:** SmartScreen shows "Windows protected your PC → More info → Run anyway" until reputation builds. Since 2024, EV certs no longer bypass SmartScreen instantly.
- **Options:**
  - **Azure Artifact Signing** (formerly *Trusted Signing*, ~$10/month): available to organizations in US/CA/EU/UK but **individuals only in the US and Canada** [verify].
  - **SignPath Foundation** offers free signing for qualifying OSS projects [verify].
  - A classic OV cert on an HSM/cloud key.
- electron-updater **works with unsigned NSIS builds**. Signature verification only kicks in when `publisherName`/Authenticode is configured. With signing, keep `verifyUpdateCodeSignature` on.
- Spawning `.cmd` shims (`npm.cmd`, `pnpm.cmd`) since Node 18.20.2/20.12.2 requires `shell: true` or `cross-spawn`/`execa` (CVE-2024-27980).

### 4.4 Linux

- **AppImage** auto-updates via electron-updater with no signing (it replaces the file; event `appimage-filename-updated`) [verified]. deb/rpm updates go through pkexec (auth prompt). `allowUnverifiedLinuxPackages` defaults to true.
- Ship `AppImage` + `deb` first; Flatpak later.

### 4.5 "Notify and download" fallback (unsigned builds)

Strategy: `if (signed build) electron-updater (falling back on 'error') else githubCheck()`.

```ts
// main/update.ts
import { app, shell, dialog } from 'electron';
import electronUpdater from 'electron-updater';
import semver from 'semver';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const REPO = 'OWNER/codesigner';

// CI writes this into the packaged package.json:
//   electron-builder -c.extraMetadata.codesignerSigned=true   (only when signing secrets exist)
// A build-time env var would NOT exist on the user's machine, so read it from the app bundle.
function isSignedBuild(): boolean {
  if (process.platform !== 'darwin') return true;          // Win NSIS / Linux AppImage update unsigned
  try {
    const pkg = JSON.parse(readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
    return pkg.codesignerSigned === true || pkg.codesignerSigned === 'true';  // CLI may pass a string
  } catch { return false; }
}

export async function checkForUpdates() {
  if (!app.isPackaged) return;
  if (!isSignedBuild()) return githubCheck();
  const { autoUpdater } = electronUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', (i) => notifyRenderer({ kind: 'ready', version: i.version }));
  // Squirrel.Mac signature/download failures surface asynchronously via 'error', not as a rejected
  // checkForUpdates() promise, so wire both to the GitHub fallback.
  autoUpdater.once('error', () => void githubCheck());
  return autoUpdater.checkForUpdates().catch(() => githubCheck());
}

async function githubCheck() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'codesigner' } });
  if (!r.ok) return;                                   // offline → silently skip
  const rel = await r.json();
  const latest = semver.coerce(rel.tag_name)?.version;
  if (!latest || !semver.gt(latest, app.getVersion())) return;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const asset = rel.assets.find((a: any) => a.name.endsWith('.dmg') && a.name.includes(arch)) ?? null;
  notifyRenderer({ kind: 'available', version: latest, notes: rel.body,
                   url: asset?.browser_download_url ?? rel.html_url });
  // renderer shows a non-modal banner → button calls shell.openExternal(url)
}
```

- Check on launch and every 6 h. Respect "skip this version" and offline (no error UI).
- Cache the last check with ETag/`If-None-Match` to stay inside the 60 req/h unauthenticated GitHub limit.
- On first run of an unsigned build, show an in-app explainer (the "Open Anyway" path, or the `xattr` one-liner).

### 4.6 electron-builder config sketch

```yaml
# electron-builder.yml
appId: dev.codesigner.app
productName: Codesigner
directories: { output: release/${version} }
files: [ "out/**", "editor/**", "package.json" ]
asarUnpack: [ "**/*.node", "**/node_modules/node-pty/**", "**/node_modules/lightningcss*/**", "**/node_modules/@tailwindcss/oxide*/**" ]
mac:
  target: [ { target: dmg, arch: [arm64, x64] }, { target: zip, arch: [arm64, x64] } ]
  category: public.app-category.developer-tools
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true            # uses APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER
win:
  target: [ { target: nsis, arch: [x64, arm64] } ]
nsis: { oneClick: true, perMachine: false }
linux:
  target: [ AppImage, deb ]
  category: Development
publish:
  provider: github
  owner: OWNER
  repo: codesigner
  releaseType: draft
electronFuses:
  runAsNode: false
  enableNodeOptionsEnvironmentVariable: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
```

### 4.7 GitHub Actions release outline

```yaml
# .github/workflows/release.yml
on: { push: { tags: ['v*'] } }
permissions: { contents: write }
jobs:
  build:
    strategy:
      matrix: { os: [macos-latest, windows-latest, ubuntu-latest] }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2            # or pnpm/action-setup + actions/setup-node (Node 22.17+)
      - run: bun install --frozen-lockfile
      - run: bun run build                    # editor (vite build) + electron-vite build
      - name: Package & publish
        # signed builds embed codesignerSigned=true in package.json (read at runtime by update.ts)
        run: bunx electron-builder --publish always ${{ secrets.MAC_CERT_P12_BASE64 != '' && '-c.extraMetadata.codesignerSigned=true' || '' }}
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # macOS (only if secrets exist; otherwise set CSC_IDENTITY_AUTO_DISCOVERY=false → unsigned)
          CSC_LINK: ${{ secrets.MAC_CERT_P12_BASE64 }}
          CSC_KEY_PASSWORD: ${{ secrets.MAC_CERT_PASSWORD }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY_PATH }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
  # then: manually review the draft release, publish → electron-updater & the GitHub-API fallback see it
```

Notes:
- Build mac arm64 and x64 on `macos-latest` (arm64 runner) with cross-arch packaging. Native modules must be rebuilt per arch, which electron-builder handles.
- Write the App Store Connect `.p8` from a secret to a file and point `APPLE_API_KEY` at that path.
- Linux on `ubuntu-22.04` gives better glibc compatibility for AppImage.

---

## 5. Process management

### 5.1 PATH on macOS GUI apps

Apps launched from Finder/Dock get launchd's minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`), so the user's tools can't be found:
- `bun` (`~/.bun/bin`)
- Homebrew (`/opt/homebrew/bin`)
- nvm/fnm/volta/mise shims
- `claude`, `codex`, `cursor-agent`

Fix at startup, before spawning anything:

```ts
// main/env.ts — fix-path@5 is ESM-only (fine: electron-vite bundles main as ESM or CJS)
import fixPath from 'fix-path';
fixPath();   // runs $SHELL -ilc to read the login+interactive PATH (same thing Onlook does)
```

Caveats:
- It adds ~100–500 ms if the user's shell rc is slow; run it async in the background (`shell-env` exposes an async variant) before the first spawn.
- Some rc files print to stdout or prompt (oh-my-zsh update checks); `shell-env` strips ANSI but can still time out. Fall back to a static list (`~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.volta/bin`, `~/.local/bin`, `~/.cargo/bin`).
- Let the user override the PATH and the binary location per tool in Settings.
- Run the **user's** `node`/`bun`, not Electron's embedded Node (`ELECTRON_RUN_AS_NODE`), which is disabled by the `runAsNode: false` fuse anyway. This respects their engines and version managers.
- Windows/Linux: GUI apps generally inherit the PATH properly. Still resolve binaries with `which`-like logic (`where.exe`) and handle `.cmd` shims.

### 5.2 Package manager detection

Order:
1. `package.json` `"packageManager": "pnpm@10.x"` (Corepack convention; note Node 25+ no longer bundles Corepack [verify]).
2. Lockfiles, walking up to the git root (monorepos):
   - `bun.lock` (text, Bun ≥ 1.2) / `bun.lockb` (legacy) → bun
   - `pnpm-lock.yaml` → pnpm
   - `yarn.lock` (+ `.yarnrc.yml` ⇒ Berry, maybe PnP → **warn: Vite with PnP works but node_modules-based tooling may not**) → yarn
   - `package-lock.json` → npm
3. Default: the user's preferred PM from settings.

For running the dev server:

| PM | Command we run |
|---|---|
| bun | `bun --bun vite dev --port N --strictPort --host localhost` (or `bun run dev --port N --strictPort` if `dev` is a plain vite call; bun passes trailing args) |
| pnpm | `pnpm exec vite dev --port N --strictPort --host localhost` (or `pnpm dev --port N …`) |
| yarn | `yarn vite dev --port N --strictPort --host localhost` |
| npm | `npx vite dev …` or `npm run dev -- --port N --strictPort` (npm needs `--`) |

Strategy:
- If `scripts.dev` matches `^(vite|vite dev)(\s|$)`, invoke vite directly with our flags. This is the most reliable.
- Otherwise (custom script, e.g. `concurrently "vite dev" "supabase start"`), run the script with appended args and **parse stdout**.

### 5.3 Port allocation and detection

- Pick a free port up front (`get-port`, or `net.createServer().listen(0)`) and pass `--port N --strictPort`. Vite fails fast instead of silently moving to `N+1`. Keep a per-worktree port map (stable across restarts, so cookies/allow-lists remain predictable, e.g. 5173 + worktree index).
- **Always** also parse stdout as the source of truth: strip ANSI, then match `/Local:\s+(https?:\/\/\S+)/`. Vite prints `➜  Local:   http://localhost:5174/`.
- Readiness: wait for that line, then poll `GET /` until a non-5xx response (SvelteKit's first request triggers dependency optimisation, which can reload once).
- Set `BROWSER=none` (no auto-open), `FORCE_COLOR=1` (keep colours for our log view and parse after stripping) and `NODE_ENV` unset.

### 5.4 Spawning and killing process trees

```ts
// main/proc.ts
import { spawn, type ChildProcess } from 'node:child_process';

export function startDevServer(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(cmd, args, {
    cwd, env: { ...env, BROWSER: 'none', FORCE_COLOR: '1' },
    detached: process.platform !== 'win32',   // own process group on POSIX → kill(-pid)
    shell: process.platform === 'win32',      // .cmd shims (CVE-2024-27980); or use cross-spawn/execa
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return child;
}

export async function killTree(child: ChildProcess, graceMs = 3000) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  const done = new Promise<void>((r) => child.once('exit', () => r()));
  const timeout = new Promise<'t'>((r) => setTimeout(() => r('t'), graceMs));
  if ((await Promise.race([done, timeout])) === 't') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
}
// app.on('before-quit') → await Promise.all(servers.map(killTree)) with an overall timeout (Onlook: 10s).
```

- `tree-kill` (last published 2022) works but polls `ps`. Process-group kill is cleaner on POSIX.
- Persist `{pid, pgid, port, worktree}` to disk. On next launch, reap orphans left by a crash (check that the pid still matches a vite command line before killing).
- Agent CLIs:
  - Prefer non-interactive JSON streaming over plain `spawn` (no PTY needed): `claude -p --output-format stream-json`, `codex exec --json`, `cursor-agent -p --output-format stream-json` [verify flags per CLI version].
  - Add `node-pty` (a native rebuild) only if you embed an interactive terminal (xterm.js).

### 5.5 Worktrees: `node_modules` and `.env`

- **`git worktree add ../repo.wt/feature-x -b feature-x`** checks out tracked files only. No `node_modules`, no `.env*`.
- **Install strategy** (fastest that is correct):
  1. **bun**: `bun install` with a warm global cache takes seconds. On macOS it uses `clonefile` copy-on-write; Linux hardlinks. It is the best default.
  2. **pnpm**: content-addressable store + hardlinks. Also fast.
  3. **npm/yarn classic**: slow. If `package-lock.json`/`yarn.lock` is byte-identical to the main worktree's, **APFS clone** `node_modules` (`cp -cR main/node_modules wt/node_modules` on macOS: instant, copy-on-write, no extra disk). Otherwise run `npm ci`.
  - **Do not symlink `node_modules`** across worktrees:
    - Branches diverge in dependencies.
    - Vite resolves real paths, so files land outside the worktree root (`server.fs.allow` errors and duplicate-instance bugs).
    - `node_modules/.vite` (optimised deps cache) would be shared and thrash between servers.
- **Env files:** copy git-ignored files the app needs. Adopt a **`.worktreeinclude`** file (gitignore syntax, the same convention Claude Code uses) listing patterns such as `.env`, `.env.local` and `supabase/.temp`.
  - Default when absent: copy `.env*` excluding `.env.example`, found via `git ls-files --others --ignored --exclude-standard -- '.env*'`.
  - Copy, don't symlink, so per-worktree edits (e.g. `PUBLIC_SITE_URL=http://localhost:5174`) stay local.
- Offer per-project "setup" and "teardown" scripts (e.g. `supabase start` is shared, not per-worktree) run after creation.

---

## 6. i18n for the editor UI

| | **Paraglide JS 2 (inlang)** | svelte-i18n 4 | typesafe-i18n 5 |
|---|---|---|---|
| Model | **Compiler**: messages → tree-shakable typed functions (`m.save_button()`) | Runtime ICU formatting via stores (`$_('key')`) | Generator + runtime, typed |
| Type safety | ✅ generated functions; missing keys fail at compile time | ❌ string keys | ✅ |
| Bundle | tiny per message; no runtime parser | intl-messageformat runtime (~15 KB+) | small |
| Svelte 5 / Kit 3 | ✅ plain Vite plugin (`paraglideVitePlugin`); `npx sv add paraglide`; v2.29 released 3 days ago | works (store-based; feels dated with runes) | works, but essentially unmaintained (2023 → one 2026 patch) |
| SPA/Electron fit | ✅ `strategy: ['localStorage','preferredLanguage','baseLocale']`, so no URL prefixes or cookies are needed | ✅ | ✅ |
| Tooling | inlang message format, Sherlock VS Code extension, Fink translator UI, machine translate CLI | JSON | JSON/TS |

**Recommendation: Paraglide JS 2.**
- Strategy for an SPA in Electron: **don't** use the URL strategy (no `/fr/` routes in an app).
- Use `localStorage` plus the OS locale. Expose `app.getLocale()`/`app.getPreferredSystemLanguages()` from main as an initial hint via preload, and call `setLocale()` from settings.
- Keep messages in `messages/{en,fr,…}.json`.

---

## 7. RECOMMENDED STACK

| Layer | Choice |
|---|---|
| Shell | **Electron 44.x → 45.x** (track stable; Chromium on all OSes, Node 24 in main) |
| Build (main/preload) | **electron-vite 6** (main, editor preload, guest/webview preload as separate entries; ESM main) |
| Editor UI | **SvelteKit 3.1 + Svelte 5 + TypeScript 6 + Tailwind 4 + Vite 8**, `adapter-static({ fallback: 'index.html' })`, `ssr = false`, served via privileged **`app://`** protocol in production, `http://localhost:5199` in dev |
| IPC | Hand-written typed contract package + `contextBridge` + `ipcMain.handle` with sender-origin checks + runtime validation; `MessageChannelMain` for streams |
| Canvas viewports | **`<webview>`** per breakpoint, **`partition="persist:preview"`** shared by all frames and worktrees, guest preload forced in `will-attach-webview`, CSS `translate/scale` canvas (never `setZoomFactor`), transparent gesture layer + host-DOM SVG overlays, `sendToHost` bridge, main-world access for `__svelte_meta`. Off-screen/far-zoom frames → `capturePage` snapshots. Abstracted behind `PreviewSurface` with an iframe-on-localhost fallback |
| Auth | Normal login inside the webview (first-party cookies). Chrome-like UA on the preview session. OAuth popups as `BrowserWindow`s on the same partition. Google OAuth flagged as a likely limitation |
| Heavy Node work | `utilityProcess` running svelte/compiler (the user's version when available), magic-string, postcss/lightningcss, `@tailwindcss/node` |
| Processes | `fix-path` at startup; lockfile + `packageManager` detection; `vite dev --port N --strictPort --host localhost` + stdout parsing; POSIX process-group kill / `taskkill /T /F`; orphan reaping; plain spawn + JSON streams for agent CLIs (`node-pty` only for an interactive terminal) |
| Worktrees | `git worktree add` → copy `.worktreeinclude` / `.env*` → `bun install` / `pnpm install` / APFS clone if lockfiles are identical; never symlink `node_modules` |
| Packaging | **electron-builder 26** (dmg+zip / NSIS / AppImage+deb), fuses on, `asarUnpack` native modules |
| Updates | **electron-updater 6** + GitHub Releases (draft → publish). Unsigned mac builds → GitHub API "notify and download" banner. Plan for the v27 Ed25519 manifest key |
| Signing | **Buy Apple Developer ID ($99/yr) before the first public release** (notarize in CI). Windows: SignPath (OSS) or Azure Artifact Signing (US/CA individuals) when affordable. Linux: none |
| i18n | **Paraglide JS 2** with localStorage + OS-locale strategy |
| CI | GitHub Actions tag-triggered matrix (macos/windows/ubuntu) → `electron-builder --publish always` |

---

## 8. Phase-0 spike checklist (de-risk in ~2 days before building the editor)

One throwaway Electron 44 app plus the user's real auth-gated SvelteKit fixture (`fixtures/`):

1. [ ] Three `<webview partition="persist:preview">` frames (1440/810/390) inside a `translate+scale` canvas. Pan/zoom at 0.25–2.0. Check text sharpness, input hit-testing in Interact mode, and frame-rate with three live Vite apps.
2. [ ] **Supabase cookie login** in one frame → the other frames are authenticated after reload → survives app restart (`persist:`) → a second worktree on another port is also logged in.
3. [ ] OAuth: test GitHub and Google via popup-on-same-partition. Record exactly what fails.
4. [ ] Guest preload bridge: `elementFromPoint` hit-testing via `sendToHost`, computed styles, a `MutationObserver` keeping overlays in sync during **Vite HMR**. Reading `__svelte_meta` from the main world.
5. [ ] `capturePage()` snapshot quality for far-zoom thumbnails (electron#44227).
6. [ ] Memory with 3 frames × 2 worktrees. Behaviour when a frame is detached or re-attached (`<webview>` reloads on DOM move: keep frames mounted and move them with CSS only).
7. [ ] Dev-server lifecycle from a Finder-launched packaged build: `fix-path`, bun/pnpm/npm detection, `--strictPort`, kill on quit, orphan reap.
8. [ ] SvelteKit 3 editor in dev (HMR on :5199) and prod (`app://` + SPA fallback, deep link refresh).
9. [ ] Unsigned mac build: first-launch Gatekeeper flow on macOS 15/26 + the GitHub "update available" banner. Signed build (if a cert is available): the electron-updater round trip.

---

## 9. Sources

- Electron releases (44.9.0 / 45.0.0-beta.5): https://releases.electronjs.org/
- `<webview>` tag docs and warning: https://www.electronjs.org/docs/latest/api/webview-tag
- BrowserView deprecation → WebContentsView: https://www.electronjs.org/docs/latest/api/browser-view · https://www.electronjs.org/docs/latest/api/web-contents-view
- Offscreen rendering (shared texture): https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering
- `capturePage` on transformed contents issue: https://github.com/electron/electron/issues/44227
- Responsively App source (webview + `transform: scale`, `will-attach-webview` hardening): https://github.com/responsively-org/responsively-app/tree/main/desktop-app
- Onlook desktop v0.2.33 (Electron 36, webview canvas, `fix-path`, electron-builder/updater): https://github.com/onlook-dev/onlook/tree/v0.2.33/apps/studio
- Polypane sessions: https://polypane.app/docs/mental-model/ · https://polypane.app/docs/session-management · https://polypane.app/docs/website-issues-you-could-encounter/
- Tauri `WebviewBuilder` (unstable, init scripts, data store, `on_web_resource_request` limits): https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html · Tauri v2 beta multiwebview note: https://v2.tauri.app/blog/tauri-2-0-0-beta/ · Tauri releases (tauri-cef alphas): https://v2.tauri.app/release/tauri/
- Electrobun v1 and webview tag: https://blackboard.sh/blog/electrobun-v1/ · https://blackboard.sh/electrobun/docs/guides/architecture/webview-tag · https://framework.blackboard.sh/electrobun/apis/browser/electrobun-webview-tag/
- electron-vite guide: https://electron-vite.org/guide/
- SvelteKit 3 migration: https://svelte.dev/docs/kit/migrating-to-sveltekit-3 · Tauri's SvelteKit SPA guide (same adapter-static pattern): https://v2.tauri.app/start/frontend/sveltekit/
- electron-builder auto-update (mac signing requirement, targets, v27 signed manifests): https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md
- Sequoia Gatekeeper change: https://mjtsai.com/blog/?p=43993 · https://www.cultofmac.com/864843/macos-sequoia-removes-handy-shortcut-bypass-gatekeeper-security/
- Homebrew 5 / Gatekeeper cask policy: https://workbrew.com/blog/homebrew-5-0-0
- Azure Artifact Signing (formerly Trusted Signing): https://azure.microsoft.com/products/artifact-signing
- `@supabase/ssr` default cookie options: npm package `@supabase/ssr@0.12.7` `dist/main/utils/constants.js`
- Paraglide JS: https://inlang.com/m/gerre34r/library-inlang-paraglideJs
