# 04 — Framer Editor UI/UX Specification (2026, "Framer 3" era)

> Research date: 2026-10-18. Target: make "codesigner" (SvelteKit + Tailwind v4 + shadcn-svelte visual editor) look, feel and respond like the current Framer editor.
>
> Framer shipped "Framer 3.0" (Agents, Branching, redesigned UI, rebuilt Community) on **June 16, 2026**. Later updates: Page Effects / A11Y attributes / Text Shadow (Jul 29, 2026, third-party report), CMS List Field (Sep 8), Pinned Projects (Sep 14), Skills (Sep 22), Firewall (Oct 1).

## 0. How to read this document — evidence tags

Every non-trivial claim is tagged:

| Tag | Meaning |
|---|---|
| **[V]** | **Verified** against an official Framer source: Help Center (framer.com/help), Academy (framer.com/academy), the official shortcuts page (framer.com/shortcuts), the Plugin API reference (framer.com/developers/reference), or Framer Updates. |
| **[M]** | **Measured** from the interactive editor mockups embedded in framer.com/design and framer.com/collaborate. These are Framer-built marketing illustrations of the 2026 editor (built in Framer itself, so CSS values are extractable). They are **dark theme only** and very close to, but **not pixel truth** for, the real editor. Treat as the best available calibration source; verify against live screenshots before freezing tokens. |
| **[R]** | **Recall / unverified**: from general knowledge of Framer's editor (2023–2025 versions) and community material; not confirmed in an official 2026 source. Must be checked against the live app (screenshots / screen recording) before implementation is considered "faithful". |

Primary sources used (all fetched 2026-10-18):
- framer.com/shortcuts (complete official shortcut table, Mac + Windows)
- Help: using-the-canvas, using-pages, how-to-use-agents, previewing-your-site, how-to-use-branches-in-framer, live-collaboration-in-framer, using-text-styles, layout-grids, overflow-clip, using-event-variables, using-triggers, exporting-assets, sharing-components, unlink-components, how-to-update-components, light-and-dark-mode-options, why-can't-i-set-position-fixed, css-styles-support, tab-order-customization
- Academy lessons: framer-interface, frames-vs-stacks, sizing-modes, layer-positioning-modes, stacks-vs-grids, min-and-max-sizing, breakpoints, component-variants, component-variables, creating-components-and-instances, stack-variables, branching-explore-variations-safely, 8-framer-shortcuts-to-learn, text-styles, styles, themes, design pages
- Plugin API reference: FrameNode, TextNode, ComponentInstanceNode, `width` type
- Product pages with editor mockups: framer.com/design, framer.com/collaborate, framer.com/agents
- Third-party Framer 3.0 coverage (humblytics, oma-kase, griffinwooldridge, yoframer) — used only for corroboration
- Claude Design: support.claude.com article 14604416, datacamp overview

---

## 1. Overall layout and visual design language

### 1.1 Window anatomy (top to bottom, left to right)

```
┌───────────────────────────────────────────────────────────────────────────────────────────┐
│ [F Canvas ▾] [+][▦][T][✎]        Site · (main)                 [👥12][▶][Invite][Publish] │  ← Top bar (toolbar)
├──────────────┬─────────────────────────────────────────────────────────────┬──────────────┤
│ Pages Layers │                                                             │ Agent  Style │  ← panel tab bars
│ Assets       │   ┌[▶] Desktop 1200 [+]┐     ┌[▶] Tablet 810 [+]┐          │──────────────│
│ [Search…  ]  │   │                    │     │                 │          │ ⫷ ⫶ ⫸ ⊤ ⊥ … │  ← alignment row
│ Pages     +  │   │   page frame       │     │  page frame     │          │ Position     │
│ ⌂ Home       │   │   (breakpoint)     │     │  (breakpoint)   │          │ Size         │
│ ▢ /about     │   │                    │     │                 │          │ Layout     + │
│ ▤ Notes Pages│   └────────────────────┘     └─────────────────┘          │ Styles     + │
│ ▸ /legal     │                                                             │ …            │
│              │            ╭──────────────────────────────╮                 │              │
│              │            │ [↖][✋][💬][◐]  [100% ▾]     │  ← floating Dock │              │
└──────────────┴────────────┴──────────────────────────────┴─────────────────┴──────────────┘
```

- **Five editor views** [V]: Canvas, CMS, Localization, Analytics, Settings. Switch via the view menu at the very top-left ("Canvas ▾") or shortcuts ⌥1…⌥5 (Canvas ⌥1, CMS ⌥2, Localization ⌥3, Analytics ⌥4, Settings ⌥5) [V].
- **Top bar / toolbar** [V academy "framer-interface"]: "inserts layers and assets, names the project, shows the active branch, and provides preview and publish controls."
- **Left sidebar** [V]: switches between **Pages, Layers, Assets**.
- **Right sidebar** [V]: "changes with your selection"; holds **Agent** and **Style** tabs (Framer 3.0) [V help "how-to-use-agents": "select Agent in the right-hand Properties panel"].
- **Canvas** [V]: freeform, infinite; breakpoints of each page shown side by side; the area around page frames is not published and can hold explorations.
- **Bottom toolbar ("Dock")** [V help "using the canvas"]: selection, pan, comments, then the zoom menu on the right; [V academy] also a **theme toggle** that "previews light and dark content".

### 1.2 Top bar (toolbar) — exact contents

Measured from the framer.com/design and /collaborate mockups [M]: bar items are 30px tall, background = app background (#111 dark), items separated by 10px gaps (left group) and 10px gaps (right group); tool buttons are 30×30 with 5px gap; all buttons radius 8px.

**Left group** (in order):
1. **View / project menu button** [M]: Framer logo glyph (10×16) + label **"Canvas"** + 8×8 down-chevron, padding 0 10px, gap 8px, bg #212121, radius 8px. Clicking opens the main menu (Help center calls it "the Framer logo in the top-left corner"; contains submenus such as **View → Show Guides**, Help → Keyboard Shortcuts) [V help "layout-grids"; Help→Keyboard Shortcuts is V-snippet only — the help article 404'd, claim rests on a search snippet]. The label reflects the current view (Canvas / CMS / Localization / Analytics / Settings) [R — inferred from label + 5 views].
2. **Tool group** [M] — four 30×30 icon buttons named in the mockup **Insert, Layout, Text, Vector**:
   - **Insert (+)** → opens the Insert panel (shortcut **I**) [V]. Insert panel lists layouts/sections, components, CMS lists, forms, media, icons, library components (⌘/ opens Library) [V for Library/CMS lists; R for exact categories].
   - **Layout** → dropdown of layout primitives: **Frame (F), Stack (S), Grid (⇧G), Rows (⇧R), Columns (⇧C), Masonry (⇧M)** [V shortcuts; grouping under this button is R].
   - **Text (T)** [V shortcut].
   - **Vector** → dropdown: **Rectangle (R), Oval (O), Rounded (U), Path/Pen (P)** plus Image (⇧I), Video (⇧V) likely live under Insert [V shortcuts; grouping R].
3. **Project title + branch** [M]: text "**Site**" (project name) · "·" separator · branch pill "**main**" (pill bg rgba(153,153,153,0.1), radius 5px). Clicking the branch pill opens the **Branches popover** [V help branches: "Click the branch indicator in the top bar. By default, it displays 'main'. Select New Branch."]. Note: the task brief puts project name "center"; the 2026 mockup places it **left-aligned right after the tools** [M]. Treat center vs. left as [R]; the mockup shows it in the left group.

**Right group** (in order) [M]:
1. **Team / avatars** (30×30) with a number chip "**12**" (count of collaborators; chip bg #242424 with a 2px #111 ring to separate from the avatar stack). Colored avatar = currently viewing, greyed = viewed previously; hover shows last-access time; hover → **eye icon** = Follow collaborator [V help live-collaboration].
2. **Preview ▶** — 30×30 icon button (bg #242424, radius 8). Shortcut **⌘P** [V]. *Conflict:* Help says "Click the Play button in the top-left corner of the editor" — this likely refers to the per-breakpoint ▶ on the canvas. The 2026 mockup puts the global Preview button in the right group next to Invite [M]. Implement both.
3. **Invite** — text button, 30px tall, padding 0 10px, bg #242424, white 12px text, radius 8px [M].
4. **Publish** — text button, same metrics, **bg #0099FF**, white text [M]. Shortcut **⌘⇧P** = Publish Site [V]. On a branch, publishing creates a branch preview URL (popover shows e.g. `stale-gift…new-pricing.framer.app`, "3m ago · by <name>", "32 changes", **Update** button) [M collaborate].

### 1.3 Left panel

Measured [M]: width **260px**, inner horizontal padding **10px** (content width 240px), background **#111** (dark), divider to canvas 1px **#212121**.

- **Tab bar** [M]: row with padding 10px 0; three pill tabs **Pages | Layers | Assets**, each 30px tall, padding 0 10px, radius 8px; active tab bg **#212121** with white text, inactive transparent with **#999** text. Shortcuts: Show Pages **⌥⇧1**, Show Layers **⌥⇧2**, Show Assets **⌥⇧3** [V]. Collapse Layers **⌥L** [V].
- **Search** [M]: block padding 10px 0; input 30px tall, padding 0 10px, gap 10px (icon + placeholder "Search…"), bg **#242424**, radius 8px.
- **Section header** [M]: 50px tall row, padding 0 5px, title (e.g. "Pages") in 12px, a "+" button at the right (10×10 glyph).
- **Rows** [M]: 30px tall (240px wide), padding 0 15px 0 10px, gap 10px; 6px disclosure caret, 12×12 type icon, 12px label. Active row bg **#242424**, radius 8px; hover = same color at lower emphasis [R].

### 1.4 Right panel

Measured [M]: width **260px**, padding 0 10px 10px, background **#111**.

- **Tab bar**: pill tabs **Agent | Style** (30px, padding 0 10px, radius 8px; active bg #242424). Shortcuts: **A** = Show Agent, **E** = Show Style [V].
- Under Style, sections are separated by **50px-tall section headers** (title at 5px left padding, optional 10×10 "+" at right). Property rows are **30px tall**, label column starts at **15px** left padding, 10px gap between label and control. Section body bottom padding 15px; rows separated by 10px vertical gap [M].
- When **Comment mode** is on, the right panel is replaced by a **Comments** panel (see §7) [M].

### 1.5 Canvas

- Canvas background **#171717** (dark) [M]. Light theme [R]: approx #F5F5F5–#F3F3F3.
- Page breakpoint frames sit side by side with **20px gap** in the mockup (mockup is scaled; real gap is larger, ~[R] 40–100px) [M/R].
- Default page width **1200px** (desktop-first) [V]. Default breakpoint widths: **Desktop 1200, Tablet 810, Phone 390** [V/M]. A breakpoint's width is the **minimum viewport width** at which it applies [V].

### 1.6 Breakpoint label row (above each page frame)

Measured [M]: a pill above each breakpoint frame, radius **10px**, containing:
`[▶ preview 20×20, bg rgba(255,255,255,.1), r4]  Desktop  1200  ⟶spacer⟶  [+ 20×20, bg rgba(255,255,255,.1), r5]`
- Inactive: pill bg **rgba(255,255,255,0.05)**, label white/#999.
- Blue-tinted state: pill bg **rgba(0,153,255,0.1)** with **1px rgba(0,153,255,0.2)** border; name "**Desktop**" in **#0099FF 12px weight 600**, width "**1200**" in **#0099FF 12px regular** [M, **state ambiguous**: the mockup layer is named "Agent 4 seconds start", so this may be the *Agent working on this breakpoint* animation state rather than plain selection; the /collaborate mockup (no agent activity) shows both pills grey]. "Blue label text = selected breakpoint" is [R].
- **▶** opens Preview at that breakpoint's width [V help preview].
- **+** adds a breakpoint: Tablet, Phone, or Custom; new breakpoint inherits from the **Primary** breakpoint [V academy breakpoints].
- Clicking the label selects the breakpoint frame; the right panel then shows breakpoint settings incl. **Layout grid** (columns/rows, gap, margins, width) [V help layout-grids] and the breakpoint width. The primary breakpoint is marked "**Primary**" [R wording; V that a primary breakpoint exists — plugin API `isPrimaryBreakpoint`].
- Properties overridden on a non-primary breakpoint are highlighted (blue label) and can be reset [R color; behavior V for variants, R for breakpoints].

### 1.7 Bottom floating toolbar ("Dock")

Measured [M]: floating centered at canvas bottom, bg **#111**, radius **18px**, 1px border **#212121**, padding ~5px [R], items:
1. **Select** (30×30, active bg #242424, radius 8) — V shortcut? (no single-letter "V" listed in official table; Esc/clicking returns to select) [R for "V"].
2. **Pan / Hand** (30×30). Space-drag also pans [V]. (Official table has no "H" binding for hand — [R] "H" is a Figma-ism; don't rely on it.)
3. **Comment** (30×30) — shortcut **C** [V].
4. **Theme** (30×30) — toggles canvas preview of light/dark **color styles** (site content theme), not necessarily the editor chrome [V help "light and dark mode options": "use the light/dark mode button in the Canvas menu or press ⌃⌘N"; academy: "the theme toggle previews light and dark content"].
5. **Zoom** field — 70px wide, 30px tall, padding 0 8px, bg #242424, radius 8, shows "**100%**" + chevron; menu: Zoom In, Zoom Out, Zoom to Fit, Zoom to Selection, Zoom to 100%, preset percentages [V help canvas].

### 1.8 Component editing mode

- Creating/opening a component opens it **on its own canvas** (separate from the page) [V academy creating-components]. Canvas breadcrumb shows location (Framer improved "the Canvas breadcrumb" in Sep 2026) [V updates]; e.g. `Home › NavItem` [R exact format].
- Accent switches from blue to **purple** for component context: component layer icons, instance selection outlines, variant override labels ("Framer highlights the overridden property in purple") [V for overrides; R for exact hue]. Candidate purples from Framer's token set: **#8855FF** (classic Framer component purple, R), **#6600FF (#60F)** and **#9900FF (#90F)** appear in framer.com tokens [M token set, usage R].
- Variants are laid out as separate frames on the component canvas, each with a label pill (like breakpoint pills) — "Primary", "Variant 2", "Hover", "Pressed" — and placeholders/buttons "**+ Variant**" and (on hover of a variant) "**+ Hover**" / "**+ Pressed**" [R labels; V that hover/press branch from a specific variant]. Clicking "+" next to a variant adds a variant (inherits from Primary even when duplicated from another variant) [V].
- Purple **"Update"** button appears in Assets next to library components with updates [V].

### 1.9 Design tokens (dark theme = measured; light theme = recall)

**Typography** [M]:
| Token | Value |
|---|---|
| UI font | **Inter Variable** (`"Inter Variable", sans-serif`) |
| Base size | **12px**, line-height **1.2em** |
| Weight | variation axes `"opsz" 14, "wght" 450` (regular UI text); headers/emphasis `wght 600` |
| OpenType features | **`"cv01" on, "cv05" on, "cv09" on, "cv11" on`** (Inter alternates: open digits/1, l with tail, flat-top 3, single-storey a) |
| Small labels | 10px used in mockup for chips/badges [M] |
| Default text color | **#999** (secondary) |
| Property labels | **#CCC** |
| Values / primary text | **#FFF** |

**Colors — dark** [M]:
| Role | Value |
|---|---|
| App / panel background | **#111111** |
| Canvas background | **#171717** |
| Dividers / panel borders | **#212121**; inside comment cards rgba(255,255,255,0.08) |
| Control bg (inputs, active tab, Invite, active row, zoom) | **#242424** (some active tabs **#212121**) |
| Hovered card / popover bg | **#1F1F1F** |
| Popover item active | **#333333** |
| Send button / subtle button | **#2E2E2E** |
| Segmented "off" chip | rgba(153,153,153,0.1) |
| Accent (selection, Publish, blue breakpoint pill state) | **#0099FF** |
| Accent tint bg / border | rgba(0,153,255,0.10) / rgba(0,153,255,0.20) |
| Darker accent (pressed) | **#0055FF** (#05F in token set) [M token / R usage] |
| Component accent | purple, ~#8855FF [R] (#60F/#90F in token set) |
| Comments panel bg | **#080808** |
| Success green | #4CD963 (token set) [M token / R usage] |
| Danger | #FF0022 / #FF0066 (token set) [M token / R usage] |

**Colors — light** [R, not measured; do not treat as truth]: panel #FFFFFF, canvas #F3F3F3/#F5F5F5, control bg #F3F3F3, dividers #EEEEEE, primary text #000/#111, labels #333–#666, secondary #999, accent unchanged #0099FF. Calibrate from screenshots.

**Radii** [M]: controls/buttons/tabs/rows **8px**; small chips **5px**; preview/plus mini buttons 4–5px; breakpoint pill **10px**; popovers **13px**; agent prompt box **15px**; Dock and app window **18px**; comment cards **20px** (uses CSS `corner-shape: squircle` when supported).

**Sizes** [M]: control height **30px**; panel width **260px**; panel padding **10px**; section header **50px**; label inset **15px**; label↔control gap **10px**; dual-field width (e.g. value + unit dropdown) 62px; zoom field 70px; icons in rows 12px; top-bar icons 18px; mini buttons 20px.

**Selection & canvas chrome** [R unless noted]:
- Selection outline 1px **#0099FF**; 8 resize handles = small white squares (~6–8px) with 1px blue border; hover outline 1px blue (lighter/thinner than selection).
- Component instances/primary: purple outline + purple handles.
- Size badge below selection showing `W × H` (blue pill, white text).
- Smart guides and Alt/Option distance measurements: red/pink lines with value pills [R — Framer's exact color unverified; Figma uses #F24822-ish red].
- Stack padding/gap hover visualization: hatched/tinted areas, draggable [R].

---

## 2. Layers panel

Verified behaviors are sparse in official docs; most of this section is [R] and needs live verification.

### 2.1 Tree
- Hierarchical tree of the current page: top level = breakpoint frames (Desktop/Tablet/Phone), each containing the same layer tree (breakpoints are variants of one page) [V plugin API: frames can be breakpoints; R for display].
- Indentation ~12–16px per level [R]; row height 30px [M from pages list; R for layers].
- Layer order: top of list = frontmost (highest z) for absolute layers; for Stacks, list order = flow order (top = first child) [R].
- Bring to Front `]`, Send to Back `[`, Bring Forward ⌘⌥↑, Send Backward ⌘⌥↓ [V].
- Collapse all: **⌥L** [V].

### 2.2 Icons per layer type [R — glyph details unverified]
| Layer type | Icon |
|---|---|
| Frame | `#`-like frame glyph / square |
| Stack (vertical) | three stacked horizontal bars |
| Stack (horizontal) | three side-by-side vertical bars |
| Grid | 2×2 grid |
| Text | "T" |
| Image (frame with image fill) | landscape/mountain glyph |
| Video | play-rectangle |
| Vector / Path / Shape | pen-nib or shape glyph |
| Component instance | 4-diamond component glyph, **purple** |
| Component (primary) / variant (inside component canvas) | filled component glyph, purple |
| Code component | `</>` glyph |
| CMS collection list | database/list glyph |
| Page (Pages panel) | page glyph; Home = house glyph; CMS page = CMS glyph; folder = folder glyph [M names: "Home", "Page", "CMS", "Folder"] |

### 2.3 Interactions
- Click row = select layer (synced with canvas selection); hover row = canvas hover outline [R].
- Shift-click = range select; ⌘-click = toggle in multi-selection [R].
- Disclosure caret to expand/collapse; ⌥-click caret = expand/collapse recursively [R].
- Drag to reorder and to reparent (drop on row = into, between rows = sibling; blue insertion line, blue highlight on target container) [R].
- **Rename**: double-click name, or **⌘R** [V shortcut]; **Auto-Rename ⌥R** (AI/auto names from content) [V].
- **Lock ⌘L** and **Hide ⌘;** [V]; on hover, row shows lock and eye toggles at the right [R]; hidden rows dimmed, locked rows show a lock icon persistently [R].
- Search: Find Content **⌘F** (canvas content search) and **⌘⇧F** Text Search [V]; layers-panel filter input at top [R for layers tab; V search exists in Pages tab mockup].
- Right-click context menu: Copy/Paste/Duplicate, Create Component (⌥⌘K), Replace With…, Remove Wrapper (⌘⌫), Add Frame (⌘↩) / Add Stack (⌘⌥↩), Lock/Hide, Unlink (instances from another project), Copy URL / Copy Import (assets) [V for the named actions; menu composition R].
- Primary breakpoint label/indicator: "Primary" shown on the primary breakpoint [R].

---

## 3. Style (properties) panel

The right panel's **Style** tab. Content is contextual to the selection (frame, stack, text, image, instance, breakpoint, page, nothing). Below is the **order observed in the 2026 mockup** [M] plus every section Framer exposes [V where cited]. Rows: 30px; label left (15px inset, #CCC); control right.

### 3.0 General conventions
- **Section headers** (50px): title (12px, white, weight ~600 [R]) + optional **"+"** on the right [M]. "+" adds the section (e.g. Layout → turns frame into Stack; Effects → add effect). Once present, the header shows **"−"** (or a ⋯/trash) to remove it [R]. Sections with no content are shown as header-only rows (e.g. "Layout +") [M].
- **Optional properties** inside a section show the label plus an **"Add…"** button instead of a control (mockup: `Min Max  Add…`, `Border Add…`, `Shadows Add…`, `Filters Add…`) [M]. Clicking opens a popover editor; once set, the row displays a summary (e.g. "1px Solid") and a remove affordance [R].
- **Segmented controls** for binary/small enums, e.g. `Visible [Yes | No]` [M]; also Stack direction, Wrap, Overflow axis [R].
- **Value + mode** composite (e.g. `Width [200][Fixed ▾]`): left numeric field, right 62px dropdown (#242424, radius 8, padding 0 8px) [M].
- **Override highlighting**: a property changed on a non-primary variant shows a **purple label**; click label → "Reset" [V]. Same idea for breakpoint overrides (blue label) [R].
- **Variable binding**: inside a component, hovering a bindable property reveals a **"+" icon** on that row; click → "Set Variable" menu listing compatible existing variables and "New Variable…" (creates a component variable of that type and binds it) [V "click the plus icon and create a variable"; menu wording R]. A bound row shows the variable name as a purple chip in place of the control; clicking the chip lets you unbind/"Detach" [R].

### 3.1 Alignment toolbar (top row, 50px) [M]
Eight icon buttons, in order: **Align Left, Align Horizontal Center, Align Right, Align Top, Align Vertical Middle, Align Bottom, Distribute Horizontally, Distribute Vertically** (icons ~14–16px). Shortcuts: ⌥A, ⌥H, ⌥D, ⌥W, ⌥V, ⌥S, ⌃⌥H, ⌃⌥V [V]. Single selection aligns to parent; multi-selection aligns to selection bounds [R].

### 3.2 Component instance header (only for instances) [V/R]
- Component name with purple component icon, and a way to open the source: **double-click instance** or an "Edit Component" action / ⋯ menu [R label]. Instances from other projects prompt **"Unlink Instance"** / **"Unlink & Replace All"** when you try to edit [V].
- **Variant** dropdown ("each instance gets a control in the Style panel for switching Variants") [V].
- One row per **component variable** in the component's defined order: text field (Text), Yes/No segmented (Boolean), number field/slider (Number), color swatch (Color), image picker (Image), link field (Link), dropdown (Enum/Variant), event picker (Event), instance slot (Component Instance) [V types exist — see §4; row UI R].
- Instances still have Position / Size / (Styles subset) sections below [R].

### 3.3 Breakpoint / page frame settings (when a breakpoint is selected) [V/R]
- Breakpoint name + width (min viewport width) [V].
- **Layout grid**: Grid type (Columns / Rows), Gap, Margins, Width — per breakpoint; guides toggled via menu View → Show Guides (⌃G) [V].
- Page-level: background Fill, Selection color [V feature list], **Layout Template** assignment (shared shell: nav/footer) [V academy layout-templates], Page Effects (scroll/entrance effects; Agent-editable since Jul 2026) [R/3rd party].

### 3.4 Link [V attributes from plugin API]
`Link  [Add…]` → popover/inline: **URL or Page** picker (internal page incl. CMS item, section anchor/scroll target, email/phone), **Open in New Tab** Yes/No, **Smooth Scroll** (for scroll-to-section), **Click Tracking ID**, **rel** values (e.g. nofollow, noreferrer, sponsored, ugc), **Preserve Params** [V attribute names: link, linkOpenInNewTab, linkSmoothScroll, linkClickTrackingId, linkRelValues, linkPreserveParams]. For text links: **Link style** with states **Hover / Active / Current** [V help text styles]. Shortcut **L** = Link tool [V]. Section placement in panel order [R].

### 3.5 Position [M/V]
Mockup layout: a **142px-tall block** containing a **62×62 pin widget** (square with inner rectangle; click edges to toggle pins) surrounded by four **62×30 inputs** labelled **T, B, L, R** (value + letter suffix) [M]. Below: `Type [Absolute ▾]` [M].
- **Type** options [V]: **Relative** (default inside Stack/Grid; flows with siblings), **Absolute** (measured against parent frame; pin T/R/B/L or center), **Fixed** (measured against viewport; **only for layers directly on the page**) [V], **Sticky** (sticks to set edge within parent section while scrolling) [V].
- Pins: top/right/bottom/left; **centerX/centerY** as percentage (e.g. "50%") [V plugin API]. Pinning both left+right = stretch width [R].
- Rotation lives here or in Transforms [R].
- Z Index (stacking order of positioned elements) [V attribute; panel location R — likely Styles].

### 3.6 Size [M/V]
Mockup: `Width [200][Fixed▾]`, a **12×62 ratio-lock** glyph spanning both rows, `Height [100][Fit▾]`, then `Min Max [Add…]` [M].
Sizing modes [V academy sizing-modes] (**five**):
| Mode | Meaning | Value format (plugin API) |
|---|---|---|
| **Fixed** | pixel value | `200` / `"200px"` |
| **Relative** | % of parent, can exceed 100% | `"50%"` |
| **Fill** | share of remaining space in Stack/Grid; fractional `1fr`, `2fr` | `"1fr"` |
| **Fit** (Fit Content) | hug relative-positioned children incl. padding | `"fit-content"` |
| **Viewport** | vh units for browser-height layouts (e.g. 100vh hero) | `"100vh"` |
- Width and height pick modes independently. Avoid Fit parent + Fill child on the same axis (Framer warns/unresolved) [V].
- **Min / Max**: Min Width, Max Width, Min Height, Max Height (added via "Add…") [V attributes; M UI].
- **Aspect ratio** attribute exists (e.g. 1.5) [V]; UI = ratio lock toggle [M/R].
- Shortcuts: **⇧A Fit Content** (one layer) / wrap multiple in Stack [V], **⌃⌥R Resize to Fit Content** [V]; holding **⌘ while resizing ignores constraints for the drag** [V academy].

### 3.7 Layout [M/V]
Header `Layout +` [M]. Adding it converts the Frame into a layout container (Stack by default) [R default].
- **Type**: **Stack | Grid** (segmented) [V attribute `layout`]. (Framer marketing also lists "Masonry layouts"; insert shortcuts Rows/Columns/Masonry exist [V].)
- **Stack** controls [V attributes]:
  - **Direction**: Horizontal | Vertical (icon segmented) — `stackDirection`.
  - **Distribute** (main axis): **Start, Center, End, Space Between, Space Around, Space Evenly** — `stackDistribution`.
  - **Align** (cross axis): **Start, Center, End** — `stackAlignment` [V]; (baseline [R]).
  - **Wrap**: Yes | No — `stackWrapEnabled`.
  - **Gap**: number — `gap`. Gap can also be dragged on canvas [R].
  - **Padding**: single value with toggle to **per-side (T, R, B, L)** — `padding` [V attr; UI R]. *Note:* the 2026 mockup shows `Padding 20` under **Styles** (for a CMS list element) [M], so padding may appear in Styles for some layer types; in Stacks it is in Layout [R].
- **Grid** controls [V attributes]:
  - **Columns** count (`gridColumnCount`), **Rows** count (`gridRowCount`).
  - **Column width type**: **Fixed | Min** ("minmax"); **Column width** px or **Min width** px (`gridColumnWidthType`, `gridColumnWidth`, `gridColumnMinWidth`).
  - **Row height type**: **Fixed | Auto | Fit** (`gridRowHeightType`, `gridRowHeight`).
  - **Gap**, **Padding**, **Align** (`gridAlignment`).
- **Grid item** (child of a grid) [V]: Fill cell width / height (Yes/No), horizontal / vertical alignment in cell, **Column span** (number or **All**), **Row span**.
- Stack variables: direction, gap, padding, distribution, alignment can be bound to component variables [V academy stack-variables].
- Wrapping shortcuts: **⌘↩ Add Frame** (wrap selection in Frame), **⌘⌥↩ Add Stack** (wrap in Stack), **⌘⌫ Remove Wrapper** (keeps children) [V].

### 3.8 Styles [M]
Mockup order: **Visible** `[Yes|No]`, **Opacity** `0.5`, **Fill** `[■ 999999]`, **Border** `Add…`, **Shadows** `Add…`, **Radius** `20` (with two 8px toggle glyphs: uniform vs per-corner), **Padding** `20` [M]. Full set of style properties [V where noted]:
- **Visible** Yes/No [M] (also ⌘; hide) [V].
- **Opacity** 0–1 (displayed as decimal in mockup, e.g. 0.5) [M]; [R] also accepts %.
- **Fill**: solid color / color style / **linear, radial, conic gradient** / **image** (`backgroundColor`, `backgroundGradient`, `backgroundImage`) [V attrs]. P3 colors supported [V marketing].
- **Overflow**: **Visible, Clip (default), Hidden, Scroll, Auto**; **Overflow X / Overflow Y** independently [V help overflow-clip]. Overscroll behavior option for scroll containers [V help css-styles].
- **Radius**: single value or per-corner (TL, TR, BR, BL) [M toggle glyphs; R per-corner order]; **Squircle corners** (smoothing) [V marketing feature].
- **Border**: width (uniform or per side), style (solid/dashed/dotted [R list]), color [V attr "width, color, and style"].
- **Shadows**: list; each = type (drop/inner [R]), X, Y, Blur, Spread, Color (`ControlType.BoxShadow`) [V type; R fields].
- **Cursor**: default/pointer/… and **Custom cursor** (image or element) [V marketing; V `ControlType.Cursor`].
- **Filters / Blur / Backdrop blur / Blend mode / Z Index / Pointer Events / User Select / Mask** [V help css-styles-support + marketing]. Mask popover (mockup): `Resolution Auto`, `Type Fill`, `Mode Alpha`, `Position Center` [M].
- **Image rendering**: auto | pixelated [V attr].

### 3.9 Text (text layers) [V/R]
Section "Text" with sub-area **Styles** (text style picker; × to remove applied style) [V help text styles]. Controls [V academy text-properties: "font, weight, size, line height, letter spacing, alignment, and wrapping"]:
- **Font** (font picker popover: built-in, Google Fonts, Fontshare, **Custom** tab with **Upload Fonts**) [V]; ⌘T = Select Typeface [V]. Variable fonts: axes sliders (e.g. Weight 300–900, Italic 0–20) [M marketing]. **OpenType** popover: Stylistic Sets 1…20, Character Variants, Alternates, Inferiors, Ligatures (Standard, Discretionary, Historical), Numbers (Tabular, Proportional, Denominators, Numerators, Fractions, Ordinals, Subscript, Superscript) — each Yes/No [M].
- **Weight**, **Size**, **Line height** (×/px/%/em [R]), **Letter spacing** (em/px [R]), **Paragraph spacing** [V via text styles].
- **Alignment**: left, center, right, justify [R justify].
- **Color** (or color style); per-selection color override within a text style [V].
- **Decoration**: none / underline / strikethrough; decoration thickness incl. **em** units [V Jul 2026 changelog], decoration color/offset [R].
- **Transform**: none / uppercase / lowercase / capitalize [R].
- **Balance / wrap** ("Text balance") and **Truncation** (max lines + ellipsis; `textTruncation`) [V].
- **Tag** (semantic): H1–H6, p, etc. — via text style or text panel [V help text-styles-and-semantic-tags exists; R UI].
- **Text Shadow** (2026) [3rd-party report of Jul 2026 update].
- Inline formatting shortcuts: ⌘B, ⌘I, ⌘U [V].
- Text style editor ("Edit Style" dialog): font props + **Breakpoints → Add Breakpoint** with **Desktop (L) / Tablet (M) / Mobile (S)** variants of size, line height, letter spacing, paragraph spacing [V].

### 3.10 Effects [V/M]
Section `Effects +` → add one of: **Appear, Hover, Press, Loop, Drag, Scroll** (Scroll transform, Scroll speed/parallax, Scroll variants, Trigger on scroll), **Text** effects; also **Page transition** effects, **Persistent transition** elements [V academy animation lesson list; menu labels R]. Example **Loop Effect** popover (mockup) [M]:
`Type [Loop | Mirror]`, `Delay 0 s`, `Opacity 1`, `Scale 1`, `Rotate 360 [2D|3D]`, `Skew 0° X 0° Y`, `Offset 0 X 0 Y`, `Off Screen [Play | Pause]`, `Transition [Linear ▾]`.
Transitions editor: spring/tween, easing, duration, delay (`ControlType.Transition`) [V type; R fields]. Powered by Motion (ex-Framer Motion) [V].

### 3.11 Interactions / Events (inside components) [V]
`Interactions +` → New interaction (Tap/Click, Hover, Press, Mouse enter/leave, Appear [R list]) → action **Set Variant** + Transition; or **New Event** (named event variable exposed to parent) [V help event variables].

### 3.12 Overlays [V]
A frame can open an **Overlay** (modal/toast/banner); overlay settings include **"Show On"** (events like Click/Hover from parent component, or **Trigger** — conditions/interactions, part of the Convert add-on) and backdrop with **Enter/Exit backdrop transitions**, safe areas for floating overlays [V help triggers; Jul 2026 changelog].

### 3.13 Cursor — see Styles (3.8).

### 3.14 Transforms [V marketing "3D transforms" / R UI]
Rotate (2D/3D: X, Y, Z), Scale, Skew X/Y, Transform origin, Perspective, Backface visibility [R list]. Rotation attribute in degrees [V].

### 3.15 Scroll section [R]
For page sections/frames: **Scroll section** id (anchor target for links with smooth scroll), scroll offset ("Scroll section offset Y" referenced in a troubleshooting article title [V that it exists]).

### 3.16 Accessibility [V]
Accessibility panel: **Tag** / semantic element (nav, footer, header, section, main, article, aside… [V help semantic-tags]), **Label** (aria-label) [V], **Tab order** customization [V], alt text for images [V], A11Y layer attributes (2026) [3rd-party].

### 3.17 Code overrides [V/R]
`Code Overrides` section: **File** dropdown + **Override** dropdown (functions exported from code files, e.g. `withClass`) [V that overrides exist; R UI labels].

### 3.18 Export [V]
At the **bottom of the right panel**: **Export** → **+** → size **1x / 2x / 3x / 4x**, optional **suffix**, format **PNG / JPG** → **Export** button (desktop app) [V help exporting-assets]. Marketing also mentions SVG export from canvas [M].

### 3.19 CMS-bound elements [M]
Collection list: `Filters Add…`, `Sorting Add…`, `Pagination Add…`, `Limit` [M/V]; `Repeat` property (repeat a designed card per List item) [V Sep 2026].

### 3.20 Numeric input behavior [R — needs live verification]
- Click to focus, type value, **Enter** commits, **Esc** reverts, **Tab** moves to next field.
- **↑/↓** = ±1; **⇧↑/⇧↓** = ±10 (⌥ = ±0.1 for decimals [R]).
- **Drag-scrub**: press-and-drag horizontally on the field/label to scrub values [R — common in Framer, but confirm whether it's the label or the field].
- **Math expressions**: `100/2`, `24*1.5`, `+8` evaluated on commit [R].
- Unit-aware fields: typing `50%`, `1fr`, `100vh`, `fit` switches the sizing mode [R; values valid per API].
- Mixed values (multi-select) show "Mixed" [R].

### 3.21 Color picker [R except where noted]
Popover anchored to the swatch: tabs/segments **Solid | Linear | Radial | Conic | Image** [R names; V that these fill kinds exist]; saturation/brightness square, **hue** slider, **alpha** slider; **eyedropper** (⌃C = Sample Color [V]); hex input + opacity % field; mode dropdown **HEX / RGB / HSL / HSB** [R]; **P3** support [V]; below: **Color Styles** swatch list (project color styles, light/dark values) with "+" to create a style from current color [V styles exist; R placement]. Gradient: draggable stops on a bar, angle input [R].

---

## 4. Components

### 4.1 Creating a component [V]
- Select layer(s) → right-click → **Create Component**, or **⌥⌘K** (Ctrl+Alt+K). *(Not ⌘K — ⌘K is Quick Actions.)* **⌘⇧K = Create From Code** (code component) [V shortcuts].
- Name it; Framer opens the component **on its own canvas** and adds it to **Assets → Components** [V].
- Insert instances: drag from Assets, **⌘K** and type the name, copy/paste an instance, or right-click a layer → **Replace With** → component [V]. Replace instances site-wide supported [V academy].
- The Agent can convert a layer into a component and replace visually matching elements with instances [V].
- Library: Assets → ⋯ → **Add to Library** (workspace-wide); insert via ⌘K → **Browse Library** or **⌘/** [V]; components from library show purple **Update** button when the source changed [V]; ⋯ → **Copy URL**, **Copy Import** (React import) [V]; **Unlink** creates a local editable copy [V].

### 4.2 Primary vs variants [V]
- **Primary variant** holds the layer structure and shared values; every other variant inherits from the Primary — *even when created by duplicating another variant* (no chained inheritance) [V].
- Changing a property on a non-primary variant creates an **override**, highlighted **purple**; click the label → reset to inherit [V].
- **Hover / Press** states **branch from a specific variant**, include the interaction automatically, and are animated in Preview [V]. (Canvas affordance: "+ Hover" / "+ Pressed" chips next to a variant [R labels].)
- Keep layer names/structure aligned between variants so Framer can interpolate position, size, opacity, etc. [V].
- Breakpoint-specific variants inside components are possible ("Breakpoint variants are included where necessary") [V].

### 4.3 Component variables (property controls) [V/R]
Created from a property via the row's **"+"** → **New Variable** [V]. One variable can bind compatible properties on several layers (e.g. one Color var → text + icon color) [V].
Known variable types:
| Type | Instance control | Evidence |
|---|---|---|
| Text (String / Content) | text field (multi-line option) | V (text content) |
| Boolean (Visible) | Yes/No segmented | V ("whether an icon appears") |
| Number | number field / slider (min/max/step) | V ("numeric values") |
| Color | swatch + color picker | V |
| Image (Responsive image) | image picker + alt | V |
| Link | link field (page/URL) | V |
| Variant (enum of variants) | dropdown | V (variant control on instance) |
| Enum / Segmented enum | dropdown / segmented | V (code `ControlType.Enum`/`SegmentedEnum`); native UI R |
| Event (Event Handler) | event picker (e.g. "Open overlay") | V help event variables |
| Component Instance (slot) | instance picker | V for code (`ControlType.ComponentInstance`); native R |
| File, Font, Border, Padding, Gap, BoxShadow, BorderRadius, Cursor, Transition, Date, Array, Object, TrackingId | specialized | V as code ControlTypes; native availability R |
| Stack props (direction, gap, padding, distribution, alignment) | layout controls | V academy stack-variables |
- Component canvas: the **Variables** list appears in the panel when the component (root) is selected, with "+" to add and drag to reorder (order = instance control order) [R].

### 4.4 Instance panel (example: a "NavItem" instance) [R composition, V concepts]
```
NavItem                  ◇ (purple)   [Edit] / ⋯
Variant      [Default        ▾]
Title        [Home              ]
Link         [/            ] ↗
Badge        [Yes | No]
Icon         [■ #0099FF]
Tap          [None           ▾]   (event)
─ Position / Size / Styles … ─
```
Double-click an instance on canvas → enter component editing (or edit inline for text if exposed) [R].

### 4.5 Component editing mode visuals [R mostly]
- Breadcrumb at top of canvas (`Page › Component`); "Back to page" via **⌥Esc** ("Back To Page") [V shortcut].
- Purple selection, purple variant pills; `+ Variant` button at the end of the variant row; variants can be dragged on the component canvas [R].
- Interactions between variants drawn as connector arrows when an interaction is selected [R].

---

## 5. Canvas interactions

### 5.1 Selection [V shortcuts / R details]
- Click = select topmost selectable layer at the clicked "level": first click selects a top-level child of the breakpoint/frame; **double-click drills one level deeper**; double-click text = edit text [R].
- **⌘-click = deep select** (directly select the innermost layer) [R]. ⌘-drag marquee selects inside frames [R].
- **Esc = Select Parent**; **⌘Esc = Select Top Parent**; **↩ Enter = Select All Children**; **⌥Esc = Back To Page** [V].
- **Tab / ⇧Tab = cycle selection** forwards/backwards among siblings [V].
- **⌘A = Select All**; **⌘⇧A = Select All Siblings** [V].
- Shift-click adds/removes from selection; drag on empty canvas = marquee [R].
- Hover = thin blue outline of the layer under cursor; with a selection, hovering another layer while holding ⌥ shows distances [R].

### 5.2 Selection handles & resizing [R]
- 8 handles (corners + edge midpoints); drag edge = resize one axis (switches that axis to **Fixed**); ⇧ = keep aspect ratio; ⌥ = resize from center; **⌘ while resizing = ignore constraints** [V for ⌘].
- Size badge shows W×H (and mode, e.g. "Fill", "Fit") during resize [R].
- **K = Scale tool** (scales children proportionally incl. text) [V shortcut].

### 5.3 Moving [V/R]
- Inside a **Stack**: dragging reorders (insertion indicator line); dragging out of the stack reparents [R].
- In a plain Frame: free (absolute) move with snapping/smart guides [V: plain frame children are absolute by default].
- **⌥⌘-drag (Ctrl+Alt) = move a selected layer** (in crowded areas, without changing selection); holding a modifier controls **reparenting** while dragging [V academy 8 shortcuts — exact modifier semantics R].
- Arrow keys nudge 1px, ⇧+arrow 10px [R]. In Stacks arrows reorder [R].

### 5.4 Smart guides & measurements [R]
- Snapping to edges/centers of siblings/parent with colored guide lines; equal-spacing indicators.
- **Hold ⌥/Option** with a selection and hover another layer (or the parent) to see **distance measurements** (lines + value pills; color believed red/pink — verify).
- Rulers **⌃R**, Guides **⌃G** [V].

### 5.5 Padding / gap handles [R]
Hovering a Stack/Grid shows padding areas and gap areas (tinted/hatched); drag a padding area or the gap handle to change values live; ⌥-drag applies to both opposite sides, ⇧ to all sides [R — verify modifier mapping].

### 5.6 Zoom & pan [V]
- Zoom In **⌘+**, Zoom Out **⌘−** (each step doubles/halves), **Zoom to 100% ⌘0**, **Zoom to Fit ⌘1**, **Zoom to Selection ⌘2** (Mac column of official table); Windows column lists **Shift+0 / Shift+1 / Shift+2** for those three — implement both families [V, oddity flagged].
- **Z** = Zoom tool (canvas) [V]. Pinch zoom on trackpad; ⌘/Ctrl+scroll with mouse [V]. Reverse zoom scroll direction is a preference [V help article exists].
- Pan: hold **Space** + drag; trackpad two-finger scroll; Dock Pan tool [V]. ("H" for hand is not in the official table [R].)
- Default zoom 100% [V].

### 5.7 Breakpoints side by side [V/M]
All breakpoints of the current page render left-to-right (Desktop, Tablet, Phone…); editing an element on the primary propagates to others unless overridden; editing on a non-primary breakpoint creates an override [V concept]. Show Interface toggle **⌘.** hides all chrome [V].

### 5.8 Other canvas tools [V]
Cursor chat **/** (message follows your cursor) [V]; follow collaborator via avatar eye icon [V]; Agent Select **⌃A** (pick canvas layers as Agent context) [V]; Night Mode / light-dark preview **⌃⌘N** [V].

---

## 6. Keyboard shortcuts (complete, from framer.com/shortcuts) [V]

> **Corrections to the brief's guesses** (all verified against framer.com/shortcuts):
> - **Create Component = ⌥⌘K** (not ⌘K). **⌘K = Quick Actions** (command palette). **⌘P = Open Preview** (not a palette).
> - **Wrap in Frame = ⌘↩ ("Add Frame")**, **wrap in Stack = ⌘⌥↩ ("Add Stack")**; **⇧A = Fit Content** (single) / wraps multiple layers in a Stack; **⌘G / ⌘⇧G = Group / Ungroup** are listed under *Vector Editing*.
> - **Hide = ⌘;** and **Lock = ⌘L** (not ⇧⌘H / ⇧⌘L). **⇧⌘H = Version History** on canvas, and **Toggle Highlights** in Preview.
> - **Zoom to 100%/Fit/Selection = ⌘0/⌘1/⌘2** on Mac; the Windows column lists **Shift+0/1/2**. The brief's "Shift 1 / Shift 2" corresponds to the Windows column (and Figma habit) — support both.
> - **Comments = C** ✓, **Grid = ⇧G** ✓, **Frame F / Stack S / Text T** ✓, **Duplicate ⌘D** ✓, **Copy/Paste Style ⌘⌥C / ⌘⌥V** ✓.
> - No official single-key Hand tool ("H") or Select tool ("V") binding is listed.

Scope column: **Canvas** = editor canvas focus; **Text** = while editing text; **Preview** = inside Preview mode; **Agent** = Agent prompt focused; **CMS** = CMS view. Overlapping bindings are resolved by scope — implement a scoped keymap.

| Category | Action | Mac | Windows | Scope |
|---|---|---|---|---|
| Project | New Project | ⌥⌘N | Alt+Ctrl+N | Global |
| Project | Import from Figma | ⌘⇧I | Ctrl+Shift+I | Global |
| Project | Upload Image | ⌥⌘I | Alt+Ctrl+I | Canvas |
| Project | Publish Site | ⌘⇧P | Ctrl+Shift+P | Global |
| Project | Open Site | ⌘⇧O | Ctrl+Shift+O | Global |
| Project | Quick Actions (command palette) | ⌘K | Ctrl+K | Global |
| Project | Version History | ⇧⌘H | Shift+Ctrl+H | Canvas |
| Views | Show Style (right panel tab) | E | E | Canvas |
| Views | Show Agent | A | A | Canvas |
| Views | Show Pages | ⌥⇧1 | Alt+Shift+1 | Canvas |
| Views | Show Layers | ⌥⇧2 | Alt+Shift+2 | Canvas |
| Views | Show Assets | ⌥⇧3 | Alt+Shift+3 | Canvas |
| Views | Collapse Layers | ⌥L | Alt+L | Canvas |
| Views | Show Interface (toggle UI) | ⌘. | Alt+. | Canvas |
| Views | Canvas view | ⌥1 | Alt+1 | Global |
| Views | CMS view | ⌥2 | Alt+2 | Global |
| Views | Localization view | ⌥3 | Alt+3 | Global |
| Views | Analytics view | ⌥4 | Alt+4 | Global |
| Views | Settings view | ⌥5 | Alt+5 | Global |
| Views | Comment mode | C | C | Canvas |
| Views | Library (insert library components) | ⌘/ | Ctrl+/ | Canvas |
| Edit | Undo / Redo | ⌘Z / ⌘⇧Z | Ctrl+Z / Ctrl+Shift+Z | All |
| Edit | Back / Forward (navigation history) | ⌘[ / ⌘] | Ctrl+[ / Ctrl+] | Canvas |
| Edit | Cut / Copy / Paste | ⌘X / ⌘C / ⌘V | Ctrl+X/C/V | Canvas |
| Edit | Copy Style / Paste Style | ⌘⌥C / ⌘⌥V | Ctrl+Alt+C / Ctrl+Alt+V | Canvas |
| Edit | Copy Fill | ⌘⇧C | Ctrl+Shift+C | Canvas |
| Edit | Paste in Place | ⌘⇧V | Ctrl+Shift+V | Canvas |
| Edit | Duplicate | ⌘D | Ctrl+D | Canvas |
| Edit | Delete | ⌫ | Del | Canvas |
| Edit | Rename | ⌘R | Ctrl+R | Canvas (⌘R = Refresh in Preview) |
| Edit | Auto-Rename | ⌥R | Alt+R | Canvas |
| Edit | Lock | ⌘L | Ctrl+L | Canvas |
| Edit | Hide | ⌘; | Ctrl+; | Canvas |
| Edit | Find Content | ⌘F | Ctrl+F | Canvas |
| Edit | Text Search | ⌘⇧F | Ctrl+Shift+F | Canvas (⌘⇧F = Fullscreen in Preview) |
| Selection | Select All | ⌘A | Ctrl+A | Canvas |
| Selection | Select All Siblings | ⌘⇧A | Ctrl+Shift+A | Canvas |
| Selection | Select Parent | Esc | Esc | Canvas |
| Selection | Select Top Parent | ⌘Esc | — | Canvas |
| Selection | Select All Children | ↩ | Enter | Canvas |
| Selection | Back To Page (exit component) | ⌥Esc | Alt+Esc | Canvas |
| Selection | Cycle Selection fwd / back | Tab / ⇧Tab | Tab / Shift+Tab | Canvas |
| Zoom & Guides | Zoom In / Out | ⌘+ / ⌘− | Ctrl++ / Ctrl+- | Canvas |
| Zoom & Guides | Zoom to 100% | ⌘0 | Shift+0 | Canvas |
| Zoom & Guides | Zoom to Fit | ⌘1 | Shift+1 | Canvas |
| Zoom & Guides | Zoom to Selection | ⌘2 | Shift+2 | Canvas |
| Zoom & Guides | Zoom tool | Z | Z | Canvas (Z = Toggle Responsive in Preview) |
| Zoom & Guides | Show Rulers | ⌃R | Ctrl+Shift+R | Canvas |
| Zoom & Guides | Show Guides | ⌃G | Alt+G | Canvas |
| Zoom & Guides | Night Mode (light/dark) | ⌃⌘N | Alt+N | Canvas |
| Tools | Insert (panel) | I | I | Canvas |
| Tools | Frame | F | F | Canvas |
| Tools | Stack | S | S | Canvas |
| Tools | Text | T | T | Canvas |
| Tools | Rounded (rounded rect) | U | U | Canvas |
| Tools | Image | ⇧I | Shift+I | Canvas |
| Tools | Video | ⇧V | Shift+V | Canvas |
| Tools | Rectangle | R | R | Canvas |
| Tools | Oval | O | O | Canvas |
| Tools | Rows | ⇧R | Shift+R | Canvas |
| Tools | Columns | ⇧C | Shift+C | Canvas |
| Tools | Grid | ⇧G | Shift+G | Canvas |
| Tools | Masonry | ⇧M | Shift+M | Canvas |
| Tools | Path (Pen) | P | P | Canvas |
| Tools | Scale | K | K | Canvas |
| Tools | Link | L | L | Canvas |
| Tools | Sample Color (eyedropper) | ⌃C | — | Canvas |
| Tools | Cursor Chat | / | / | Canvas |
| Layout | Add Frame (wrap in Frame) | ⌘↩ | Ctrl+Enter | Canvas (⌘↩ = Send Immediately in Agent) |
| Layout | Add Stack (wrap in Stack) | ⌘⌥↩ | Ctrl+Alt+Enter | Canvas |
| Layout | Remove Wrapper | ⌘⌫ | Ctrl+Del | Canvas |
| Layout | Fit Content (or wrap multiple in Stack) | ⇧A | Shift+A | Canvas |
| Layout | Resize to Fit Content | ⌃⌥R | Ctrl+Alt+R | Canvas |
| Arrange & Align | Bring to Front / Send to Back | ] / [ | ] / [ | Canvas |
| Arrange & Align | Bring Forward / Send Backward | ⌘⌥↑ / ⌘⌥↓ | Ctrl+Alt+Up / Down | Canvas |
| Arrange & Align | Align Left / H-Center / Right | ⌥A / ⌥H / ⌥D | Alt+A / Alt+H / Alt+D | Canvas |
| Arrange & Align | Align Top / V-Middle / Bottom | ⌥W / ⌥V / ⌥S | Alt+W / Alt+V / Alt+S | Canvas |
| Arrange & Align | Distribute Horizontally / Vertically | ⌃⌥H / ⌃⌥V | Alt+Shift+H / Alt+Shift+V | Canvas |
| Vector Editing | Unite / Subtract / Intersect / Exclude | ⌥⇧U / ⌥⇧S / ⌥⇧I / ⌥⇧E | Alt+Shift+U/S/I/E | Canvas |
| Vector Editing | Join | ⌥⇧J | Alt+Shift+J | Canvas |
| Vector Editing | Group / Ungroup | ⌘G / ⌘⇧G | Ctrl+G / Ctrl+Shift+G | Canvas |
| Components | Create Component | ⌥⌘K | Ctrl+Alt+K | Canvas |
| Components | Create From Code | ⌘⇧K | Ctrl+Shift+K | Canvas |
| Typography | Bold / Italic / Underline | ⌘B / ⌘I / ⌘U | Ctrl+B/I/U | Text (⌘I = Inspect in Preview) |
| Typography | Select Typeface | ⌘T | Ctrl+T | Canvas/Text |
| Developer Tools | Save File (code editor) | ⌘S | Ctrl+S | Code editor |
| Developer Tools | Run Recent Plugin | ⌘⌥P | Ctrl+Alt+P | Canvas |
| Developer Tools | Open Development Plugin | ⌘⌥L | Ctrl+Alt+L | Canvas |
| Preview | Open Preview | ⌘P | Ctrl+P | Canvas |
| Preview | Toggle Preview Fullscreen | ⌘⇧F | Ctrl+Shift+F | Preview |
| Preview | Toggle Highlights | ⌘⇧H | Ctrl+Shift+H | Preview |
| Preview | Refresh | ⌘R | Ctrl+R | Preview |
| Preview | Inspect | ⌘I | Ctrl+I | Preview |
| Preview | Toggle Responsive | Z | Z | Preview |
| Preview | Next / Previous Breakpoint | ⌘. / ⌘, | Ctrl+. / Ctrl+, | Preview |
| Preview | Close Preview | Esc | Esc | Preview [V help preview] |
| CMS | Previous / Next Item | ⌥↑ / ⌥↓ | Alt+Up / Alt+Down | CMS |
| Agent | Show Agent | A | A | Canvas |
| Agent | New Chat | ⌘J | Ctrl+J | Global |
| Agent | Agent Select (pick layers as context) | ⌃A | Ctrl+Alt+A | Canvas |
| Agent | Send Prompt / New line | ↩ / ⇧↩ | Enter / Shift+Enter | Agent |
| Agent | Send Immediately | ⌘↩ | Ctrl+Enter | Agent |
| Agent | Close / Blur input | Esc | Esc | Agent |
| Agent | Previous / Next prompt (history) | ⌥↑ / ⌥↓ | Alt+Up / Alt+Down | Agent |
| Agent | Undo / Redo (in input) | ⌘Z / ⌘⇧Z | Ctrl+Z / Ctrl+Shift+Z | Agent |
| Branching | Merge to Main | ⌘⇧M | Ctrl+Shift+M | Global |

Other verified input behaviors: Space-drag pan; ⌘/Ctrl+scroll zoom; pinch zoom; ⌘ while resizing ignores constraints; ⌥⌘-drag moves a selected layer in crowded areas [V]. Full in-app list: main menu → Help → Keyboard Shortcuts [V-snippet: help article 404'd; from search snippet].
Unverified/common (do not ship as "Framer-exact" without checking) [R]: arrow nudge 1/10px, ⌘-click deep select, ⌥-hover distances, ⇧-resize keep ratio, ⌥-resize from center, ⌘⇧> / ⌘⇧< font size steps, ⌘⌥G.

---

## 7. Comments

### 7.1 Framer comments [V/M]
- Enter Comment mode with **C** or the Dock's Comment button [V]. "Press C and comment directly on the canvas. **Pin feedback to any element, reply in threads, and resolve notes** as changes are made." [V framer.com/collaborate]
- Viewers (role) can comment and review without editing [V].
- Click on canvas → comment pin dropped at that point, attached to the element beneath (moves with it) → composer popover (text field, @mention [R], Post) [R composer details].
- Pins: round avatar/number markers on the canvas; hover expands preview; click opens thread popover with replies and a **Resolve** (✓) action [R visuals; V resolve].
- **Comments panel** replaces the right panel in comment mode [M]: width 260px, padding 0 15px 50px, bg #080808, 50px header "Comments", divider rgba(255,255,255,.08); list of comment cards (padding 10px, radius 20px squircle; hover/selected bg #1F1F1F), each with avatar, **author name**, relative time ("2m ago"), message text, divider, and "**2 replies**" link [M]. Filters (open/resolved, page) [R].
- Pages panel shows per-page counts (badge) — in the collaborate mockup these badges are **branch counts** with a popover listing branches touching that page (`typography 3m`, `newsletter 2d`) [M]; comment count badges per page [R].

### 7.2 Claude Design element-anchored comments [V thin]
In Claude Design you switch the canvas to **Comment mode**, click an element, and type a short request; the comment is **pinned to that element** so you need not describe its location, and Claude reads pending comments as targeted edit instructions. Docs note comments can occasionally disappear before Claude reads them (workaround: paste into chat); threads/resolve semantics are not documented.

### 7.3 Recommendation for codesigner
Combine both: Framer-style pins/threads/resolve UI, anchored to a **stable element identity** (source file + element id/AST path, with a fallback screen-position), plus a "**Send to agent**" action that turns one or many open comments into an Agent task (scoped to the anchored elements as context, like Framer's Agent context tool).

---

## 8. Pages panel and Assets panel

### 8.1 Pages panel [V/M]
- Header "Pages" with **+** (opens type menu) [V]. Search field above [M].
- **Page types** [V]:
  - **Web Pages** — published, responsive, breakpoints; rows labelled by **path** (`/about`, `/pricing`) [M]; **Home** has a house icon, labelled "Home", cannot be deleted [V/M].
  - **CMS Pages** — one template per collection generating a page per item; shown as a child row with CMS icon labelled like "**Product Pages**" / "**Notes Pages**" under the collection's index path (e.g. `/notes` → "Notes Pages") [M]; URL pattern like `/blog/:slug` [R display].
  - **Design Pages** — private freeform canvases, not published (mockups, social graphics, explorations) [V].
- **Folders**: path rows with children, e.g. `/legal` (folder icon) → `/privacy`, `/terms`, `/accessibility` (indented sub-rows) [M].
- Row affordances: hover → ⋯ menu (or right-click): **Customize URL, Duplicate, Delete** [V]; double-click name → rename (auto-converted to valid URL path) [V]. Active page row bg #242424 [M]. Per-page **branch badge** with count → popover of branches (170px, radius 13, bg #1F1F1F; rows 30px, active #333) [M].
- Draft/unpublished page badge [R — not found in 2026 docs; CMS items have a Status field (draft/published) V].
- **Layout Templates** apply a shared shell to pages [V].
- 404 page support [V help article].

### 8.2 Assets panel [V/R]
- Sections [V/R]: **Components** (local, plus library; folders; ⋯ → Add to Library / Copy URL / Copy Import / Unlink; purple **Update** button), **Styles** (header "+" → **Color** / **Text** [V for Text]; color styles with Light/Dark values and ⋯ → **Remove Dark Style** [V]; text styles listed by tag/name; **Link styles** [V academy]), **Images / Media** [R], **Fonts** (custom fonts are uploaded via font picker → Custom tab [V]; Assets listing R), **Vectors / Vector sets** (Framer Icon Set, custom sets) [V marketing], **Code** files (code components & overrides) [R placement].
- Theme: color styles define light & dark values; Dock Theme toggle / ⌃⌘N previews dark values on canvas [V].

---

## 9. Agent tab and Branching (context for the Framer 3 UI)

### 9.1 Agent tab [V/M]
- Right panel tab **Agent** (shortcut **A**); prompt box at the bottom: bg **#1F1F1F**, radius **15px**, multi-line input, **bottom bar (20px)** with **model picker** (e.g. "GPT 6 Sol", Sonnet, Opus, Fable; reasoning levels / Fast mode on some models) and action buttons; **Send** button 20×20 (#2E2E2E, radius 5) [M/V].
- **Context chip** above the input showing the selected layer (e.g. "Hero Section") — select layers on canvas (or **⌃A** Agent Select) to scope the Agent [V/M].
- **@mentions** for pages, CMS collections, styles, assets; **/skills**, **/cms**, **/component**, **/code** slash commands; attachments (images, files, URLs, DESIGN.md) [V framer.com/agents, Skills update].
- Streaming states ("Thinking…"), per-prompt **Revert**, list of layers changed, **Follow** button when the agent works on another page, "Mark as Bad" [V help + 3rd-party].
- **New Chat ⌘J**; one chat per task recommended [V].
- Running a prompt from **main** auto-creates a branch ("auto-branching: Agents work in branches; manual edits remain") [V].

### 9.2 Branches [V/M]
- Branch pill in top bar ("main") → **Branches popover**: title "Branches" (12px, wght 600), **Search…**, filter **All**, list of branches with relative times (`main 1m`, `home-2026 3m`), **+ New Branch**, rename, creator shown [V/M].
- **Changes** list (pages/collections/components changed: `Home`, `/pricing`, `Locales`, `Glossary`, `Updates`, `Shaders`, `Vectors`) and primary button **Apply to Main** / **Merge to main** (⌘⇧M) [M/V]. Help wording: **Review Changes** → diff → **Apply** [V].
- Branch from a branch; merge child into parent; revert an applied branch from version history (moves changes back to a draft) [V].
- Publishing a branch creates a **branch preview URL**; main publishes separately [V]. Multiplayer cursors are branch-scoped [V].

---

## 10. Mapping to a SvelteKit / Tailwind v4 / shadcn-svelte editor

Principle: copy Framer's *interaction model and chrome* 1:1 (that is what the user will judge), but make every edit a **source-code edit** to `.svelte` files, Tailwind classes and `app.css` tokens.

### 10.1 KEEP / ADAPT / DROP

| Framer feature | Decision | codesigner equivalent / notes |
|---|---|---|
| Overall chrome: top bar, 260px side panels, pill tabs, Dock, breakpoint pills, dark #111/#171717 theme, Inter 12px/450 with cv01/05/09/11, 30px controls, 8px radii, #0099FF accent | **KEEP** | Implement as design tokens in the editor's own CSS. Provide light theme (calibrate from screenshots). |
| Canvas: zoom/pan, selection model (click / dbl-click deeper / Esc parent / Enter children / Tab cycle), handles, smart guides, ⌥ distances, padding/gap drag | **KEEP** | Selection maps to DOM elements in the live SvelteKit render (iframe), resolved to source nodes via compiled source maps / data-attributes injected in dev (e.g. `data-cs-id="src/routes/+page.svelte:42:3"`). |
| Breakpoints side by side (Desktop 1200 / Tablet 810 / Phone 390, + Custom) | **KEEP/ADAPT** | Breakpoint = Tailwind responsive variant. (a) **Ranges match**: Framer breakpoints and Tailwind media queries are both *min-width*; the only difference is which breakpoint the others inherit from. (b) **Faithful default = Desktop-primary**: write unprefixed classes for Desktop, then `max-lg:` / `max-md:` overrides for Tablet / Phone, so edits on Desktop flow down exactly as in Framer (valid in Tailwind v4). (c) **Mobile-first option** (base + `md:` + `lg:`) matches typical shadcn/hand-written code but **breaks Framer propagation** (edits on the Desktop pill no longer reach smaller breakpoints) — make it a per-project choice and say so in the UI. (d) **Widths**: Framer uses 1200/810/390, Tailwind defaults are `lg` 1024 / `md` 768; pills must display the project's real `--breakpoint-*` values from `@theme`, or (on opt-in) set those tokens to 810/1200 — otherwise a pill labelled 1200 writes classes that switch at 1024. Custom breakpoints → `--breakpoint-*` / `@custom-variant` in `app.css`. Override highlighting = a class exists at that variant. |
| Layers panel (tree, icons, rename, lock/hide, drag reorder/reparent, search) | **KEEP** | Tree = Svelte template AST (elements, components, `{#if}`/`{#each}` blocks shown as special rows). Rename = `data-name`/comment or component name; lock/hide are editor-only state (hide could optionally emit `hidden`). Drag = AST move. |
| Style panel sections: Position, Size (Fixed/Relative/Fill/Fit/Viewport + min/max), Layout (Stack/Grid, direction, distribute, align, wrap, gap, padding), Styles (visible, opacity, fill, overflow, radius, border, shadows, cursor, blur, blend, z), Text, Transforms, Accessibility, Link | **KEEP** | Each control round-trips to Tailwind classes: Stack→`flex flex-col/flex-row`, Distribute→`justify-*`, Align→`items-*`, Wrap→`flex-wrap`, Gap→`gap-*`, Padding→`p-*/px-*/pt-*…`, Grid→`grid grid-cols-N`, minmax→`grid-cols-[repeat(auto-fill,minmax(Xpx,1fr))]`, Fill(1fr)→`flex-1`/`basis-0 grow` or `w-full` in grid, Fit→`w-fit`, Relative→`w-1/2`/`w-[50%]`, Viewport→`h-screen`/`h-[100vh]`/`h-dvh`, Fixed→`w-[200px]` or spacing scale `w-50`, Overflow Clip→`overflow-clip` (Framer default!), Position→`relative/absolute/fixed/sticky` + `top-*` etc., Radius→`rounded-*`, Shadows→`shadow-*`, Opacity→`opacity-*`, Cursor→`cursor-*`, Blur→`blur-*`/`backdrop-blur-*`. Prefer theme scale values; fall back to arbitrary values `[...]`. Show the token name in the field when a value matches a token. |
| Numeric inputs (scrub, arrows, math), color picker (hex/rgb/hsl/P3, alpha, eyedropper, swatches) | **KEEP** | Swatches = CSS variables from `app.css` (`--color-*`, shadcn `--primary`, `--background`…). OKLCH support needed (Tailwind v4 + shadcn use `oklch()`); show HEX by default like Framer, add OKLCH mode. |
| Pages panel (Home icon, paths, folders, Design Pages, CMS template pages) | **ADAPT** | Pages = SvelteKit **routes** from `src/routes/**/+page.svelte`. Home = `/`. Folders = route directories; layout groups `(group)` shown as folders; `+layout.svelte` ≈ **Layout Template**. **Dynamic routes** `[slug]`, `[...rest]`, `[[optional]]` ≈ **CMS Pages**: show as "Blog Posts" style child rows with a CMS-like icon; each has a **sample param values** list (e.g. `slug = hello-world`) editable in the row's ⋯ / settings, used to render the canvas (and optionally `load` mock data). Design Pages = editor-only scratch canvases stored in `.codesigner/` (not routes). "+ Page" creates a route folder + `+page.svelte`. Rename = rename folder (with link refactor warning). |
| Assets: Components | **ADAPT** | `.svelte` components in `src/lib/components/**`, including `src/lib/components/ui/*` (shadcn-svelte). Instances = component usages. Create Component (⌥⌘K) = extract selection into new `.svelte` file with props. |
| Component variants (Primary/variants, Hover/Pressed) | **ADAPT** | shadcn-svelte uses **`tailwind-variants` `tv()`** (`variants: { variant: { default, destructive, outline, secondary, ghost, link }, size: { default, sm, lg, icon } }`). Map Framer **Variant** dropdown → `tv` variant keys; Primary = `defaultVariants`; variant overrides (purple) = classes in that variant's slot that differ from base; **Hover/Pressed** = `hover:`/`active:` (and `focus-visible:`, `disabled:`, `data-[state=open]:`) classes — show as "+ Hover / + Pressed / + Focus" pseudo-variant frames on the component canvas. Multi-dimension variants (variant × size) need a matrix view (Framer has only one variant axis — an extension). |
| Component variables (Text, Boolean, Number, Color, Image, Link, Enum, Event, Component instance) | **ADAPT** | Svelte 5 **props** (`let { title = 'Home', badge = false, href, icon, onclick, children } = $props()`): Text→`string`, Boolean→`boolean`, Number→`number`, Color→string/CSS var, Image→`src` string, Link→`href`, Enum/Variant→union type / `tv` VariantProps, Event→callback prop (`onclick`), Component instance/slot→**snippets** (`children`, named `Snippet` props). "+" bind icon on a property = "Expose as prop" refactor. Instance panel controls generated from prop types (TS types / JSDoc). |
| Color styles / Text styles / Link styles | **ADAPT** | Color styles → CSS custom properties in `app.css` (`@theme { --color-brand: … }` + shadcn `:root` / `.dark` blocks for light/dark — maps directly to Framer's Light/Dark color style values; the Dock **Theme** toggle = toggle `.dark` on the canvas). Text styles → `@utility` / `@layer components` classes (e.g. `.text-h1`) or `@theme` font-size tokens with responsive variants (Framer L/M/S breakpoints → responsive prefixes). |
| Fonts | **ADAPT** | `@font-face` / `@fontsource` packages, `--font-*` theme tokens. Font picker tabs: Project fonts / Google (via fontsource) / Custom upload → `static/fonts`. |
| Breakpoint layout grid / guides | **KEEP (editor-only)** | Overlay only; persisted in `.codesigner/` settings. |
| Comments (pins, threads, resolve) | **KEEP + extend** | Anchored to source element ids; stored in `.codesigner/comments.json` or git notes; "Send to agent" (Claude-Design-style). |
| Agent tab (right panel), context chip, @mentions, model picker, revert per prompt, auto-branching | **KEEP/ADAPT** | Agent = Claude (Agent SDK) editing the repo; context = selected elements' source locations; @ = routes/components/tokens; revert = git commit per prompt; auto-branch = git branch/worktree per agent task. |
| Branches pill, Branches popover, Changes list, Apply/Merge to main | **ADAPT** | Git **branches / worktrees**. "Changes" = `git diff --stat` grouped by route/component/token; **Apply to Main** = merge (fast-forward or merge commit) or **open PR**. Branch-from-branch = normal git. |
| Publish button | **ADAPT** | **Publish ▾** = Commit (message prefilled) / Push / Open PR / Merge. Keep blue #0099FF primary button and ⌘⇧P. Branch preview URL → optional `vite preview`/deploy preview link if a provider is configured. |
| Preview ▶ (⌘P), per-breakpoint ▶, Toggle Responsive, Inspect | **KEEP** | Open the real dev server route in a preview window/iframe at the breakpoint width. |
| Version history (⇧⌘H) | **ADAPT** | Git log of the current file/route with visual diff. |
| Quick Actions (⌘K) | **KEEP** | Command palette: insert components, run commands, go to route. |
| Insert panel (I) | **ADAPT** | Insert HTML primitives, shadcn-svelte components (installed + installable via CLI), project components, Lucide icons, layout presets (Stack/Grid/Rows/Columns). |
| Effects (Appear, Hover, Press, Loop, Drag, Scroll), page transitions, Motion | **DROP (for now)** | Later: map to Svelte transitions/`animate`, Tailwind `transition-*`/`animate-*`, or a motion library. Keep Hover/Pressed *state styling* (CSS) — that is not an "effect". |
| Interactions / Events / Overlays / Triggers (Convert add-on) | **DROP (for now)** | Overlays → shadcn Dialog/Sheet/Popover components edited as components; event wiring is code. |
| Code overrides / code components editor | **DROP** | The whole project *is* code; open file in user's IDE instead (⌘-click "Open in editor"). |
| CMS (collections, list fields, filters/sorting/pagination UI) | **DROP** | Dynamic data comes from `load` functions; only keep **sample param values / mock data** for `[param]` routes. |
| Hosting, domains, staging & versions, firewall, custom headers, redirects | **DROP** | Out of scope (git + user's own deploy). |
| SEO / site settings (titles, OG images, sitemap, robots, JSON-LD) | **DROP** (maybe later: `<svelte:head>` editor) | |
| Localization of site content | **DROP** | (later: paraglide-js integration) |
| Analytics, A/B tests, forms backend, Convert add-on | **DROP** | |
| Plugins marketplace, Community, templates, remix | **DROP** | |
| Live multiplayer (cursors, cursor chat, follow) | **DROP v1** | Single-user desktop app; git handles collaboration. |
| Vector editing (pen, boolean ops), shaders, vector sets | **DROP v1** | Icons via Lucide/`@lucide/svelte`; SVG inserted as-is. |
| Design Pages (freeform, non-published canvases) | **KEEP (light)** | Scratch canvases for exploration stored outside `src/routes`. |
| Export (PNG/JPG 1x–4x) | **KEEP (cheap)** | Screenshot of element via the preview browser. |
| Accessibility section (tag, aria-label, tab order, alt) | **KEEP** | Direct attribute edits — natural fit for code. |

### 10.2 Implementation notes that affect fidelity
1. **Scoped keymap** is mandatory (several Framer bindings are reused across Canvas/Text/Preview/Agent — see §6).
2. **Overflow default**: Framer frames default to `overflow: clip`; Tailwind elements default to visible. Do not silently add `overflow-clip` to existing code — show the Framer default only for newly inserted frames.
3. **Plain Frame = absolute children** in Framer; in real HTML, children flow. When the user drags freely inside a non-flex parent, emit `relative` on parent + `absolute top-[..] left-[..]` on child, and surface this clearly (Framer's Type = Absolute row).
4. **Fixed position only on page-level layers** in Framer — in code it is allowed anywhere; we may relax this but keep the hint.
5. **Fill vs Fit conflicts**: replicate Framer's warning when a Fit parent has a Fill child on the same axis.
6. **Purple vs blue**: use blue (#0099FF) for page/breakpoint context and purple for component context (variants, instance selection, prop bindings, overrides), exactly like Framer.
7. **Branch pill** shows the git branch / worktree; dirty state indicator; Publish button label can change to "Commit"/"Create PR" depending on state while keeping Framer's blue button look.

---

## 11. Open questions / verification checklist (do before freezing the UI)

Capture live screenshots of the current Framer editor (desktop app, both themes) and confirm:
1. Light-theme palette (all [R]).
2. Component purple hex; selection handle size/shape; hover outline style; size badge style.
3. Smart guide and ⌥-distance colors and label style; padding/gap overlay visuals and drag modifiers.
4. Numeric input scrub target (label vs field), arrow/shift steps, math expression support.
5. Layer-type icons (draw from screenshots; Framer icons are custom 12px glyphs).
6. Exact Style-panel section order for frame / stack / text / image / instance (mockup shows Position → Size → Layout → Styles; Link, Effects, Transforms, Accessibility, Code Overrides, Export positions unverified).
7. Variable-binding affordance (plus icon position, chip appearance), instance panel header ("Edit" button wording).
8. Component canvas: variant pill labels, "+ Variant", "+ Hover/Pressed" wording and placement.
9. Whether project name/branch is centered or left-aligned in the shipping app (mockup: left group).
10. Whether the Dock Theme toggle switches editor chrome or only canvas content (docs say content preview; ⌃⌘N "Night Mode").
11. Draft badge on pages (not found in 2026 docs).
12. Real (unscaled) spacing between breakpoint frames on canvas.
13. Breakpoint pill states: which visual = selected vs. hovered vs. "Agent working here" (the blue-tint [M] values may belong to the Agent state).
14. Tailwind breakpoint strategy per project (Desktop-primary `max-*` vs mobile-first) and pill width source (`--breakpoint-*`).
