/**
 * The in-page bridge. It runs in the canvas page's MAIN world (injected by the
 * guest preload with webFrame.executeJavaScript) because Svelte's dev-mode
 * `__svelte_meta` expandos are invisible from the preload's isolated world.
 *
 * IMPORTANT: this function is serialized with Function#toString and evaluated
 * in the page, so it must be fully self-contained: no imports (type-only
 * imports are fine), no references to module-level values.
 */
import type {
	CanvasMode,
	ComputedSnapshot,
	DropTarget,
	ElementInfo,
	GuestToHost,
	HostToGuest,
	LayerKind,
	LayerNode,
	NodeId,
	Rect,
	SourceLoc,
	StackFrame
} from '@codesigner/protocol';

export interface BridgeConfig {
	toHost: string;
	toGuest: string;
}

export function bridgeMain(config: BridgeConfig) {
	type Meta = { loc: SourceLoc | null; parent: DevFrame | null };
	type DevFrame = {
		type: string;
		file: string;
		line: number;
		column: number;
		componentTag?: string;
		parent: DevFrame | null;
	};
	type Layer =
		| { kind: 'element'; key: Element; loc: SourceLoc }
		| { kind: 'instance'; key: DevFrame; loc: SourceLoc; tag: string; frameIndex: number };
	type LayerRec = {
		id: NodeId;
		layer: Layer;
		els: Element[];
		children: LayerRec[];
	};

	const w = window as unknown as Record<string, unknown>;
	if (w.__codesignerBridge) return;
	w.__codesignerBridge = true;

	let scope: string[] = ['src/routes/'];
	let mode: CanvasMode = 'design';
	let hoverId: NodeId | null = null;
	let selectedIds: NodeId[] = [];
	let parentIds: NodeId[] = [];

	const send = (msg: GuestToHost) =>
		document.dispatchEvent(new CustomEvent(config.toHost, { detail: JSON.stringify(msg) }));

	// ---------------------------------------------------------------- ids
	let seq = 0;
	const idOf = new WeakMap<Element, NodeId>();
	const byId = new Map<NodeId, WeakRef<Element>>();
	const idFor = (el: Element): NodeId => {
		let id = idOf.get(el);
		if (!id) {
			id = 'n' + (++seq).toString(36);
			idOf.set(el, id);
			byId.set(id, new WeakRef(el));
		}
		return id;
	};
	const elFor = (id: NodeId): Element | null => {
		const el = byId.get(id)?.deref() ?? null;
		if (el && !el.isConnected) return null;
		return el;
	};

	// ------------------------------------------------------- svelte meta
	const metaOf = (el: Element): Meta | null => (el as unknown as { __svelte_meta?: Meta }).__svelte_meta ?? null;
	const isUserFile = (file: string | undefined) =>
		!!file && !file.includes('node_modules/') && !file.startsWith('.svelte-kit/') && !file.includes('/.svelte-kit/');
	/** Editing a component in place: the scope is that component only (no route folder). */
	const focusing = () => scope.length > 0 && !scope.some((s) => s.endsWith('/'));
	const inScope = (file: string) => scope.some((s) => (s.endsWith('/') ? file.startsWith(s) : file === s));
	const framesOf = (meta: Meta): DevFrame[] => {
		const out: DevFrame[] = [];
		for (let p = meta.parent; p; p = p.parent) out.push(p);
		return out;
	};
	const locKey = (loc: SourceLoc) => `${loc.file}:${loc.line}:${loc.column}`;

	/** Which layer an element belongs to, given the current editing scope. */
	const layerOf = (el: Element): Layer | null => {
		const meta = metaOf(el);
		if (!meta?.loc) return null;
		const file = meta.loc.file;
		if (isUserFile(file) && inScope(file)) return { kind: 'element', key: el, loc: meta.loc };
		const frames = framesOf(meta);
		for (let i = 0; i < frames.length; i++) {
			const f = frames[i];
			if (f.type === 'component' && isUserFile(f.file) && inScope(f.file)) {
				return {
					kind: 'instance',
					key: f,
					loc: { file: f.file, line: f.line, column: f.column },
					tag: f.componentTag ?? 'Component',
					frameIndex: i
				};
			}
		}
		return null;
	};

	const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'HEAD']);
	const skip = (el: Element) => SKIP.has(el.tagName) || el.id === 'codesigner-preview';

	// --------------------------------------------------------- layer tree
	let recs = new Map<NodeId, LayerRec>();
	let treeRoot: LayerRec | null = null;
	let locCounts = new Map<string, number>();
	let treeDirty = true;

	const rebuild = (): LayerRec => {
		const byKey = new Map<unknown, LayerRec>();
		const root: LayerRec = { id: 'root', layer: null as unknown as Layer, els: [], children: [] };
		recs = new Map();
		locCounts = new Map();
		const walk = (node: Element, parent: LayerRec) => {
			for (const child of Array.from(node.children)) {
				if (skip(child)) continue;
				const layer = layerOf(child);
				let next = parent;
				if (layer) {
					let rec = byKey.get(layer.key);
					if (!rec) {
						rec = { id: idFor(child), layer, els: [child], children: [] };
						byKey.set(layer.key, rec);
						recs.set(rec.id, rec);
						parent.children.push(rec);
						const k = locKey(layer.loc);
						locCounts.set(k, (locCounts.get(k) ?? 0) + 1);
					} else if (parent !== rec) {
						rec.els.push(child); // another root of a multi-root component
					}
					next = rec;
				}
				walk(child, next);
			}
		};
		if (document.body) walk(document.body, root);
		treeDirty = false;
		treeRoot = root;
		return root;
	};

	const ensureTree = () => {
		if (treeDirty) rebuild();
	};

	/** Finds the layer record an element id belongs to, rebuilding the index if needed. */
	const recFor = (id: NodeId): LayerRec | null => {
		ensureTree();
		let rec = recs.get(id);
		if (!rec) {
			rebuild();
			rec = recs.get(id);
		}
		return rec ?? null;
	};

	const TEXT_TAGS = /^(h[1-6]|p|span|label|strong|em|small|b|i|blockquote|figcaption|code|dt|dd|th|td|caption|legend)$/;
	const directText = (el: Element) =>
		Array.from(el.childNodes)
			.filter((n) => n.nodeType === Node.TEXT_NODE)
			.map((n) => n.textContent ?? '')
			.join('')
			.replace(/\s+/g, ' ')
			.trim();

	const kindOf = (el: Element, layer: Layer): LayerKind => {
		if (layer.kind === 'instance') return 'component';
		const tag = el.localName;
		if (tag === 'img' || tag === 'picture' || tag === 'video') return 'image';
		if (tag === 'svg') return 'icon';
		if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input';
		if (tag === 'a') return 'link';
		if (tag === 'button') return 'button';
		const cs = getComputedStyle(el);
		if (cs.display.includes('grid')) return 'grid';
		if (cs.display.includes('flex')) return cs.flexDirection.startsWith('column') ? 'stack-v' : 'stack-h';
		if (TEXT_TAGS.test(tag) || (el.children.length === 0 && directText(el))) return 'text';
		return 'frame';
	};

	const SEMANTIC: Record<string, string> = {
		nav: 'Nav',
		header: 'Header',
		main: 'Main',
		aside: 'Aside',
		section: 'Section',
		footer: 'Footer',
		form: 'Form',
		ul: 'List',
		ol: 'List',
		li: 'List Item',
		article: 'Article',
		table: 'Table',
		img: 'Image',
		svg: 'Icon',
		input: 'Input',
		textarea: 'Text Area',
		select: 'Select',
		button: 'Button',
		a: 'Link',
		hr: 'Divider'
	};

	/** The component-canvas cell (variant × state) an element is the root of, if any. */
	const cellOf = (el: Element): HTMLElement | null => {
		const parent = el.parentElement;
		return parent?.hasAttribute('data-codesigner-context') ? parent : null;
	};
	const cellContext = (el: Element): Record<string, string> | null => {
		const cell = cellOf(el);
		if (!cell) return null;
		try {
			const context = JSON.parse(cell.getAttribute('data-codesigner-context') ?? '{}') as Record<string, string>;
			const state = cell.getAttribute('data-codesigner-state');
			return state ? { ...context, state } : context;
		} catch {
			return null;
		}
	};

	const nameOf = (el: Element, layer: Layer, kind: LayerKind): string => {
		const label = cellOf(el)?.getAttribute('data-codesigner-label');
		if (label) return label;
		if (layer.kind === 'instance') return layer.tag;
		const tag = el.localName;
		const text = directText(el);
		if (kind === 'text' && text) return text.length > 40 ? text.slice(0, 40) + '…' : text;
		if (tag === 'img') return (el as HTMLImageElement).alt || 'Image';
		if (SEMANTIC[tag]) return SEMANTIC[tag];
		if (kind === 'stack-h' || kind === 'stack-v') return 'Stack';
		if (kind === 'grid') return 'Grid';
		return 'Frame';
	};

	const toNode = (rec: LayerRec): LayerNode => {
		const el = rec.els[0];
		const kind = kindOf(el, rec.layer);
		const hidden = (el as HTMLElement).offsetParent === null && getComputedStyle(el).position !== 'fixed';
		return {
			id: rec.id,
			name: nameOf(el, rec.layer, kind),
			kind,
			tag: el.localName,
			loc: rec.layer.loc,
			isInstance: rec.layer.kind === 'instance',
			repeatCount: locCounts.get(locKey(rec.layer.loc)) ?? 1,
			hidden: hidden || undefined,
			children: rec.children.map(toNode)
		};
	};

	// --------------------------------------------------------- geometry
	const unionRect = (els: Element[]): Rect | null => {
		let x1 = Infinity,
			y1 = Infinity,
			x2 = -Infinity,
			y2 = -Infinity;
		for (const el of els) {
			if (!el.isConnected) continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 && r.height === 0 && els.length > 1) continue;
			x1 = Math.min(x1, r.left);
			y1 = Math.min(y1, r.top);
			x2 = Math.max(x2, r.right);
			y2 = Math.max(y2, r.bottom);
		}
		if (x1 === Infinity) return null;
		return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
	};

	const rectFor = (id: NodeId): Rect | null => {
		const rec = recFor(id);
		if (rec) return unionRect(rec.els);
		const el = elFor(id);
		return el ? unionRect([el]) : null;
	};

	const px = (v: string) => parseFloat(v) || 0;

	const snapshot = (el: Element): ComputedSnapshot => {
		const cs = getComputedStyle(el);
		const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
		return {
			display: cs.display,
			position: cs.position,
			inset: { top: cs.top, right: cs.right, bottom: cs.bottom, left: cs.left },
			flexDirection: cs.flexDirection,
			flexWrap: cs.flexWrap,
			justifyContent: cs.justifyContent,
			alignItems: cs.alignItems,
			gap: cs.gap,
			rowGap: cs.rowGap,
			columnGap: cs.columnGap,
			gridTemplateColumns: cs.gridTemplateColumns,
			width: cs.width,
			height: cs.height,
			minWidth: cs.minWidth,
			maxWidth: cs.maxWidth,
			minHeight: cs.minHeight,
			maxHeight: cs.maxHeight,
			padding: {
				top: px(cs.paddingTop),
				right: px(cs.paddingRight),
				bottom: px(cs.paddingBottom),
				left: px(cs.paddingLeft)
			},
			margin: {
				top: px(cs.marginTop),
				right: px(cs.marginRight),
				bottom: px(cs.marginBottom),
				left: px(cs.marginLeft)
			},
			borderRadius: cs.borderRadius,
			borderWidth: cs.borderTopWidth,
			borderColor: cs.borderTopColor,
			borderStyle: cs.borderTopStyle,
			backgroundColor: cs.backgroundColor,
			color: cs.color,
			opacity: cs.opacity,
			overflow: cs.overflow,
			boxShadow: cs.boxShadow,
			filter: cs.filter,
			backdropFilter: cs.backdropFilter,
			fontFamily: cs.fontFamily,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			lineHeight: cs.lineHeight,
			letterSpacing: cs.letterSpacing,
			textTransform: cs.textTransform,
			fontStyle: cs.fontStyle,
			textDecorationLine: cs.textDecorationLine,
			textAlign: cs.textAlign,
			parentDisplay: parent?.display ?? 'block',
			parentFlexDirection: parent?.flexDirection ?? 'row'
		};
	};

	const serializeFrames = (meta: Meta): StackFrame[] =>
		framesOf(meta).map((f) => ({
			type: f.type,
			file: f.file,
			line: f.line,
			column: f.column,
			componentName: f.componentTag
		}));

	const childOffsets = (rec: LayerRec | null, el: Element): Rect[] => {
		const display = getComputedStyle(el).display;
		if (!rec || !/flex|grid/.test(display)) return [];
		const box = el.getBoundingClientRect();
		return rec.children
			.map((c) => unionRect(c.els))
			.filter((r): r is Rect => !!r && (r.width > 0 || r.height > 0))
			.map((r) => ({ x: r.x - box.x, y: r.y - box.y, width: r.width, height: r.height }));
	};

	const describe = (id: NodeId): ElementInfo | null => {
		const rec = recFor(id);
		const el = rec?.els[0] ?? elFor(id);
		if (!el) return null;
		const layer = rec?.layer ?? layerOf(el);
		const meta = metaOf(el);
		const kind = layer ? kindOf(el, layer) : 'frame';
		const frames = meta ? framesOf(meta) : [];
		// Frames written in the same file as the layer, before leaving it, tell us about {#each}.
		const outer = layer?.kind === 'instance' ? frames.slice(layer.frameIndex + 1) : frames;
		const inEach = !!layer && outer.some((f) => f.type === 'each' && f.file === layer.loc.file);
		const onlyText = layer?.kind === 'element' && !/^(br|img|input|hr)$/.test(el.localName) && inlineOnly(el);
		return {
			id: rec?.id ?? idFor(el),
			kind: layer?.kind ?? 'element',
			tag: el.localName,
			name: layer ? nameOf(el, layer, kind) : el.localName,
			className: el.getAttribute('class') ?? '',
			text: ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
			rect: (rec ? unionRect(rec.els) : unionRect([el])) ?? { x: 0, y: 0, width: 0, height: 0 },
			loc: layer?.loc ?? meta?.loc ?? null,
			componentTag: layer?.kind === 'instance' ? layer.tag : null,
			definitionFile: layer?.kind === 'instance' ? (meta?.loc?.file ?? null) : null,
			stack: meta ? serializeFrames(meta) : [],
			computed: snapshot(el),
			repeatCount: layer ? (locCounts.get(locKey(layer.loc)) ?? 1) : 1,
			inEach,
			textEditable: !!onlyText,
			editable: !!layer,
			readonlyReason: layer ? null : meta ? 'Rendered outside your source files' : 'No source information',
			childCount: rec?.children.length ?? el.children.length,
			slot: el.getAttribute('data-slot'),
			context: cellContext(el),
			childOffsets: childOffsets(rec, el)
		};
	};

	// --------------------------------------------------------- hit test
	const pathAt = (x: number, y: number): NodeId[] => {
		const hit = document.elementFromPoint(x, y);
		const chain: Element[] = [];
		let prevKey: unknown = null;
		for (let cur: Element | null = hit; cur && cur !== document.documentElement; cur = cur.parentElement) {
			// An inline <svg> is one layer, like in Framer: its paths aren't picked one by one.
			if (cur instanceof SVGElement && !(cur instanceof SVGSVGElement)) continue;
			const layer = layerOf(cur);
			if (!layer) continue;
			// The bold word of a paragraph is part of the paragraph's text (still reachable in the Layers panel).
			if (richBlock(cur)) {
				chain.length = 0;
				prevKey = null;
			}
			if (layer.key === prevKey) {
				chain[chain.length - 1] = cur; // keep the outermost element of the layer
			} else {
				chain.push(cur);
				prevKey = layer.key;
			}
		}
		ensureTree();
		// Map each element to its layer record id (the record's first element).
		const ids: NodeId[] = [];
		for (const el of chain.reverse()) {
			const id = idFor(el);
			if (recs.has(id)) {
				ids.push(id);
				continue;
			}
			const layer = layerOf(el);
			let found: NodeId | null = null;
			for (const rec of recs.values()) {
				if (rec.layer.key === layer?.key) {
					found = rec.id;
					break;
				}
			}
			ids.push(found ?? id);
		}
		return ids;
	};

	/**
	 * Layers rendered from a source location. With a tag, only layers of that tag
	 * (component name for instances): mid hot-reload the old DOM still has another
	 * element on that line.
	 */
	const findLoc = (loc: SourceLoc): NodeId[] => {
		rebuild();
		const key = locKey(loc);
		const out: NodeId[] = [];
		for (const rec of recs.values()) {
			if (locKey(rec.layer.loc) !== key) continue;
			const tag = rec.layer.kind === 'instance' ? rec.layer.tag : rec.els[0]?.localName;
			if (!loc.tag || tag === loc.tag) out.push(rec.id);
		}
		return out;
	};

	// ------------------------------------------------------ text editing
	/** Inline formatting a text layer can hold and still be typed over (rich text). */
	const INLINE = /^(strong|b|em|i|u|s|a|br|span|code|small|mark|sub|sup)$/;
	/** Only text and inline formatting below `el`. */
	const inlineOnly = (el: Element): boolean =>
		Array.from(el.childNodes).every((n) => n.nodeType === Node.TEXT_NODE || (n instanceof HTMLElement && INLINE.test(n.localName) && inlineOnly(n)));
	/** A paragraph whose own text runs around inline formatting: picked and edited as one text layer, like in Framer. */
	const richBlock = (el: Element) =>
		el.children.length > 0 && Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) && inlineOnly(el);

	const escapeText = (text: string) =>
		text.replace(/\u00a0/g, ' ').replace(/&(?=[#a-zA-Z0-9]+;)|[<{}]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '{': '&#123;', '}': '&#125;' })[ch]!);
	const escapeAttr = (value: string) => value.replace(/[&"{}]/g, (ch) => ({ '&': '&amp;', '"': '&quot;', '{': '&#123;', '}': '&#125;' })[ch]!);
	/** Attributes the canvas adds and the source never had. */
	const OWN_ATTR = /^(contenteditable|spellcheck|data-codesigner-.*)$/;

	/**
	 * The edited content as Svelte markup. Elements that were there before the
	 * edit keep their tag and attributes; the ones Chrome made while typing are
	 * normalized (b → strong, i → em, styled spans unwrapped).
	 */
	const serialize = (root: Element, originals: WeakSet<Element>): string => {
		const walk = (parent: Node): string =>
			Array.from(parent.childNodes)
				.map((n) => {
					if (n.nodeType === Node.TEXT_NODE) return escapeText(n.textContent ?? '');
					if (!(n instanceof HTMLElement)) return '';
					let tag = n.localName;
					const original = originals.has(n);
					if (tag === 'br') return '<br />';
					if (!INLINE.test(tag) || (!original && tag === 'span')) return walk(n);
					if (!original) tag = tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag;
					const inner = walk(n);
					if (!inner && !original) return '';
					const attrs = Array.from(n.attributes)
						.filter((a) => !OWN_ATTR.test(a.name) && (original || a.name === 'href'))
						.map((a) => {
							const value = a.name === 'class' ? a.value.split(/\s+/).filter((c) => c && !/^svelte-/.test(c)).join(' ') : a.value;
							return a.name === 'class' && !value ? '' : ` ${a.name}="${escapeAttr(value)}"`;
						})
						.join('');
					return `<${tag}${attrs}>${inner}</${tag}>`;
				})
				.join('');
		return walk(root).replace(/(<br \/>)+$/, '');
	};

	/** Puts back the exact nodes (and their attributes) a layer had, so the inline layers keep their source info. */
	const keepNodes = (root: Element) => {
		const elements = [root, ...Array.from(root.querySelectorAll('*'))];
		const children = elements.map((e) => [e, Array.from(e.childNodes), Array.from(e.attributes).map((a) => [a.name, a.value])] as const);
		const texts: [Text, string][] = [];
		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push([n as Text, (n as Text).data]);
		return () => {
			for (const [e, kids, attrs] of children) {
				e.replaceChildren(...kids);
				if (e === root) continue;
				for (const a of Array.from(e.attributes)) e.removeAttribute(a.name);
				for (const [name, value] of attrs) e.setAttribute(name, value);
			}
			for (const [t, data] of texts) t.data = data;
		};
	};

	let editing: {
		el: HTMLElement;
		id: NodeId;
		original: string;
		originals: WeakSet<Element>;
		before: string;
		rich: boolean;
		restore: () => void;
		/** The selection a link is being asked for (the host's URL field has the focus meanwhile). */
		linking: Range | null;
	} | null = null;
	/** The last committed edit, to put back if the host refuses it. */
	let lastEdit: { id: NodeId; restore: () => void } | null = null;

	const finishEdit = (cancel: boolean) => {
		if (!editing) return;
		const { el, id, original, originals, before, rich, restore } = editing;
		editing = null;
		el.removeEventListener('keydown', onEditKey, true);
		el.removeEventListener('input', pushRects);
		el.removeEventListener('paste', onEditPaste);
		el.removeEventListener('blur', onEditBlur);
		el.removeAttribute('contenteditable');
		const markup = serialize(el, originals);
		const text = (el.innerText ?? '').replace(/\n+$/, '');
		const unchanged = markup === before;
		if (cancel) restore();
		else lastEdit = { id, restore };
		getSelection()?.removeAllRanges();
		const asRich = rich || /</.test(markup);
		send({ type: 'text-edited', id, text: cancel ? original : text, original, cancelled: cancel || unchanged, ...(asRich ? { markup } : {}) });
		if (cancel) send({ type: 'dom-changed', reason: 'mutation' });
	};
	function onEditBlur() {
		// The host's link field took the focus: keep editing until it answers.
		if (editing?.linking) return;
		finishEdit(false);
	}
	function onEditPaste(event: ClipboardEvent) {
		event.preventDefault();
		document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
	}
	function onEditKey(event: KeyboardEvent) {
		event.stopPropagation(); // keep the app's own shortcuts out of the way while typing
		if (event.key === 'Escape') {
			event.preventDefault();
			finishEdit(true);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (event.shiftKey) document.execCommand('insertLineBreak');
			else finishEdit(false);
		} else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && editing) {
			event.preventDefault();
			const range = getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).cloneRange() : null;
			if (!range || range.collapsed) return;
			editing.linking = range;
			const a = (range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest('a');
			const r = range.getBoundingClientRect();
			send({ type: 'text-link-request', id: editing.id, href: a && editing.el.contains(a) ? a.getAttribute('href') : null, rect: { x: r.x, y: r.y, width: r.width, height: r.height } });
		}
	}
	/** The host answered a link request: back to typing with the same selection, linked (or not). */
	const applyLink = (href: string | null) => {
		if (!editing?.linking) return;
		const range = editing.linking;
		editing.linking = null;
		editing.el.focus();
		getSelection()?.removeAllRanges();
		getSelection()?.addRange(range);
		if (href === '') document.execCommand('unlink');
		else if (href) document.execCommand('createLink', false, href);
		pushRects();
	};
	const startEdit = (id: NodeId) => {
		finishEdit(false);
		const el = (recFor(id)?.els[0] ?? elFor(id)) as HTMLElement | null;
		if (!el) return;
		const originals = new WeakSet(Array.from(el.querySelectorAll('*')));
		editing = { el, id, original: el.textContent ?? '', originals, before: serialize(el, originals), rich: el.children.length > 0, restore: keepNodes(el), linking: null };
		el.setAttribute('contenteditable', 'true');
		document.execCommand('styleWithCSS', false, 'false');
		el.addEventListener('keydown', onEditKey, true);
		el.addEventListener('input', pushRects);
		el.addEventListener('paste', onEditPaste);
		el.addEventListener('blur', onEditBlur);
		el.focus();
		const range = document.createRange();
		range.selectNodeContents(el);
		getSelection()?.removeAllRanges();
		getSelection()?.addRange(range);
	};

	// ------------------------------------------------------- smart guides
	/** The containing block of an absolute layer and the other visible layers in it (guest px), for snapping while it moves. */
	const snapTargets = (id: NodeId): { parent: Rect | null; siblings: Rect[] } => {
		const rec = recFor(id);
		const el = rec?.els[0] as HTMLElement | undefined;
		if (!el) return { parent: null, siblings: [] };
		const container = (getComputedStyle(el).position === 'fixed' ? null : el.offsetParent) ?? document.documentElement;
		const parent = container === document.documentElement ? { x: 0, y: 0, width: innerWidth, height: innerHeight } : unionRect([container]);
		const siblings: Rect[] = [];
		for (const other of recs.values()) {
			if (other === rec || other.els.some((e) => e.contains(el) || el.contains(e))) continue;
			const first = other.els[0] as HTMLElement | undefined;
			if (!first || !container.contains(first) || !visible(first)) continue;
			// Layers right inside the container, or positioned like the moving one: what a designer lines things up with.
			if (first.parentElement !== container && first.offsetParent !== container) continue;
			const r = unionRect(other.els);
			if (r && r.width > 0 && r.height > 0) siblings.push(r);
		}
		return { parent, siblings: siblings.slice(0, 200) };
	};

	// ------------------------------------------------------- drop target
	/** Elements that can't take a drawn child (void, text-level and interactive tags). */
	const LEAF = /^(img|input|br|hr|svg|path|p|span|h[1-6]|a|button|label|textarea|select|option|video|audio|canvas|iframe|strong|em|b|i|small|code|pre|li)$/;
	const visible = (el: Element) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed';

	/** The container under a point and where a new child would go, following its flow (row, column or grid). */
	const dropTarget = (x: number, y: number, exclude?: NodeId): DropTarget | null => {
		const path = pathAt(x, y);
		const dragged = exclude ? recFor(exclude) : null;
		// A dragged layer can't go inside itself, and moves stay within its file.
		const within = (rec: LayerRec) => !!dragged && dragged.els.some((d) => rec.els.some((e) => d === e || d.contains(e)));
		for (let i = path.length - 1; i >= 0; i--) {
			let rec = recFor(path[i]);
			if (!rec || within(rec)) continue;
			if (dragged && rec.layer.loc.file !== dragged.layer.loc.file && !/\+layout\.svelte$/.test(rec.layer.loc.file)) continue;
			// Empty space of a layout around the page: draw into the page, not into every page of the layout.
			if (/\+layout\.svelte$/.test(rec.layer.loc.file)) {
				const pages = rec.children.filter((c) => /\+page\.svelte$/.test(c.layer.loc.file) && c.layer.kind === 'element');
				if (pages.length === 1 && !LEAF.test(pages[0].els[0].localName)) rec = pages[0];
			}
			const el = rec.els[0];
			const file = rec.layer.loc.file;
			if (dragged && file !== dragged.layer.loc.file) continue;
			const kids = rec.children.filter((c) => c !== dragged && c.layer.loc.file === file && c.els.some(visible));
			// A component usage only takes children when it already renders markup from this file (a snippet).
			if (rec.layer.kind === 'instance' ? kids.length === 0 : LEAF.test(el.localName)) continue;
			const cs = getComputedStyle(el);
			const grid = cs.display.includes('grid');
			const row = !grid && cs.display.includes('flex') && cs.flexDirection.startsWith('row');
			const parentRect = unionRect(rec.els) ?? { x: 0, y: 0, width: 0, height: 0 };
			const parent = { ...rec.layer.loc, tag: rec.layer.kind === 'instance' ? rec.layer.tag : el.localName };
			if (kids.length === 0) return { parentId: rec.id, parent, anchor: null, parentRect, line: null };
			const rects = kids.map((k) => unionRect(k.els.filter(visible)) ?? parentRect);
			let index = rects.findIndex((r) =>
				grid ? y < r.y || (y <= r.y + r.height && x < r.x + r.width / 2) : row ? x < r.x + r.width / 2 : y < r.y + r.height / 2
			);
			let before = index >= 0;
			if (!before) index = rects.length - 1;
			// Repeats of one source location ({#each}) take no siblings in between: snap to the run's edges.
			const key = locKey(kids[index].layer.loc);
			let first = index;
			let last = index;
			while (first > 0 && locKey(kids[first - 1].layer.loc) === key) first--;
			while (last < kids.length - 1 && locKey(kids[last + 1].layer.loc) === key) last++;
			if (first !== last && (before ? index !== first : index !== last)) {
				const middle = (first + last + 1) / 2;
				if ((before ? index : index + 1) < middle) [index, before] = [first, true];
				else [index, before] = [last, false];
			}
			const r = rects[index];
			const t = 2;
			const line: Rect =
				row || grid
					? { x: (before ? r.x : r.x + r.width) - t / 2, y: r.y, width: t, height: r.height }
					: { x: r.x, y: (before ? r.y : r.y + r.height) - t / 2, width: r.width, height: t };
			return {
				parentId: rec.id,
				parent,
				anchor: { target: kids[index].layer.loc, position: before ? 'before' : 'after' },
				parentRect,
				line
			};
		}
		return null;
	};

	// ------------------------------------------------------ comment pins
	let anchors: { id: string; loc: SourceLoc; occurrence: number; text: string }[] = [];
	const textOf = (el: Element) => ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
	/** Each pin's element: its source location (and repeat), else an element with the same text; null when gone. */
	const anchorRects = (): Record<string, Rect | null> => {
		ensureTree();
		const out: Record<string, Rect | null> = {};
		for (const a of anchors) {
			const key = locKey(a.loc);
			const tagOf = (r: LayerRec) => (r.layer.kind === 'instance' ? r.layer.tag : r.els[0]?.localName);
			// A layer added above can take the old line:column: only trust it if it's still the same element.
			const same = (r: LayerRec | undefined) => !!r && tagOf(r) === a.loc.tag && (!a.text || textOf(r.els[0]) === a.text);
			const twins = [...recs.values()].filter((r) => locKey(r.layer.loc) === key);
			let rec: LayerRec | undefined = [twins[a.occurrence], twins[0]].find(same);
			if (!rec && a.text) {
				// The location moved (lines added above): same text, preferring the same file and tag.
				const byText = [...recs.values()].filter((r) => r.els[0] && textOf(r.els[0]) === a.text);
				rec =
					byText.find((r) => r.layer.loc.file === a.loc.file && tagOf(r) === a.loc.tag) ??
					byText.find((r) => r.layer.loc.file === a.loc.file) ??
					byText.find((r) => tagOf(r) === a.loc.tag);
			}
			out[a.id] = rec ? unionRect(rec.els) : null;
		}
		return out;
	};

	// ------------------------------------------------------- highlights
	let rectsQueued = false;
	const pushRects = () => {
		if (rectsQueued) return;
		rectsQueued = true;
		// rAF keeps overlays in sync with paint; the timer covers throttled background views.
		let done = false;
		const run = () => {
			if (done) return;
			done = true;
			rectsQueued = false;
			// Editing a component in place: the rest of the page is dimmed around its instances.
			if (!hoverId && selectedIds.length === 0 && anchors.length === 0 && !focusing()) return;
			let focus: Rect[] | undefined;
			if (focusing()) {
				ensureTree();
				focus = (treeRoot?.children ?? []).map((rec) => unionRect(rec.els)).filter((r): r is Rect => !!r && r.width > 0 && r.height > 0);
			}
			const selected: Record<NodeId, Rect> = {};
			for (const id of selectedIds) {
				const r = rectFor(id);
				if (r) selected[id] = r;
			}
			const parents: Record<NodeId, Rect> = {};
			for (const id of parentIds) {
				const r = rectFor(id);
				if (r) parents[id] = r;
			}
			send({ type: 'rects', hover: hoverId ? rectFor(hoverId) : null, selected, parents, focus, ...(anchors.length ? { anchors: anchorRects() } : {}) });
		};
		requestAnimationFrame(run);
		setTimeout(run, 100);
	};

	// --------------------------------------------------------- preview
	const originalClass = new Map<Element, string | null>();
	const previewStyle = () => {
		let style = document.getElementById('codesigner-preview') as HTMLStyleElement | null;
		if (!style) {
			style = document.createElement('style');
			style.id = 'codesigner-preview';
			document.head.appendChild(style);
		}
		return style;
	};

	const twinElements = (id: NodeId): Element[] => {
		const rec = recFor(id);
		if (!rec) return [];
		const key = locKey(rec.layer.loc);
		const out: Element[] = [];
		for (const other of recs.values()) if (locKey(other.layer.loc) === key) out.push(...other.els);
		return out;
	};

	const previewClasses = (ids: NodeId[], remove: string[], add: string[], css?: string) => {
		for (const id of ids) {
			for (const el of twinElements(id)) {
				if (!originalClass.has(el)) originalClass.set(el, el.getAttribute('class'));
				const tokens = (el.getAttribute('class') ?? '').split(/\s+/).filter((t) => t && !remove.includes(t));
				for (const t of add) if (!tokens.includes(t)) tokens.push(t);
				el.setAttribute('class', tokens.join(' '));
			}
		}
		if (css !== undefined) previewStyle().textContent = css;
		pushRects();
	};

	const clearPreview = () => {
		for (const [el, cls] of originalClass) {
			if (!el.isConnected) continue;
			if (cls === null) el.removeAttribute('class');
			else el.setAttribute('class', cls);
		}
		originalClass.clear();
		document.getElementById('codesigner-preview')?.remove();
	};

	// ---------------------------------------------------------- scroll
	const canScroll = (el: Element, dx: number, dy: number) => {
		const cs = getComputedStyle(el);
		const oy = /(auto|scroll|overlay)/.test(cs.overflowY);
		const ox = /(auto|scroll|overlay)/.test(cs.overflowX);
		const yOk = oy && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0);
		const xOk = ox && (dx > 0 ? el.scrollLeft + el.clientWidth < el.scrollWidth - 1 : el.scrollLeft > 0);
		return (dy !== 0 && yOk) || (dx !== 0 && xOk);
	};

	const scrollAt = (x: number, y: number, dx: number, dy: number) => {
		let target: Element | null = document.elementFromPoint(x, y);
		while (target && target !== document.body && !canScroll(target, dx, dy)) target = target.parentElement;
		const scroller = target && target !== document.body ? target : document.scrollingElement;
		if (!scroller) return send({ type: 'scrolled', consumed: false, dx, dy });
		const beforeTop = scroller.scrollTop;
		const beforeLeft = scroller.scrollLeft;
		scroller.scrollBy({ left: dx, top: dy, behavior: 'instant' as ScrollBehavior });
		const consumed = scroller.scrollTop !== beforeTop || scroller.scrollLeft !== beforeLeft;
		send({ type: 'scrolled', consumed, dx, dy });
	};

	// --------------------------------------------------------- messages
	document.addEventListener(config.toGuest, (event) => {
		let msg: HostToGuest;
		try {
			msg = JSON.parse((event as CustomEvent<string>).detail);
		} catch {
			return;
		}
		switch (msg.type) {
			case 'init':
				scope = msg.scope;
				mode = msg.mode;
				treeDirty = true;
				pushRects();
				break;
			case 'set-scope':
				scope = msg.files;
				treeDirty = true;
				send({ type: 'tree', root: toTree() });
				send({ type: 'rects', hover: null, selected: {} }); // clears the dimming when leaving
				pushRects();
				break;
			case 'set-mode':
				mode = msg.mode;
				break;
			case 'hit':
				send({ type: 'hit-result', reqId: msg.reqId, path: pathAt(msg.x, msg.y) });
				break;
			case 'snap-targets':
				send({ type: 'snap-result', reqId: msg.reqId, ...snapTargets(msg.id) });
				break;
			case 'drop-target':
				send({ type: 'drop-result', reqId: msg.reqId, target: dropTarget(msg.x, msg.y, msg.exclude) });
				break;
			case 'describe':
				send({
					type: 'described',
					reqId: msg.reqId,
					elements: msg.ids.map(describe).filter((e): e is ElementInfo => e !== null)
				});
				break;
			case 'find-loc':
				send({ type: 'found-loc', reqId: msg.reqId, ids: findLoc(msg.loc) });
				break;
			case 'highlight':
				hoverId = msg.hover;
				selectedIds = msg.selected;
				parentIds = msg.parents ?? [];
				if (!hoverId && selectedIds.length === 0 && anchors.length === 0 && !focusing()) send({ type: 'rects', hover: null, selected: {} });
				else pushRects();
				break;
			case 'set-anchors':
				anchors = msg.anchors;
				pushRects();
				break;
			case 'request-tree':
				send({ type: 'tree', root: toTree() });
				break;
			case 'preview-classes':
				previewClasses(msg.ids, msg.remove, msg.add, msg.css);
				break;
			case 'clear-preview':
				clearPreview();
				break;
			case 'scroll-at':
				scrollAt(msg.x, msg.y, msg.dx, msg.dy);
				break;
			case 'set-dark':
				document.documentElement.classList.toggle('dark', msg.dark);
				break;
			case 'navigate':
				location.assign(msg.url);
				break;
			case 'edit-text':
				startEdit(msg.id);
				break;
			case 'end-edit-text':
				finishEdit(msg.cancel);
				break;
			case 'force-state':
				// Previously forced elements become "none" so the host can clear them too.
				document.querySelectorAll('[data-codesigner-force]').forEach((el) => el.setAttribute('data-codesigner-force', 'none'));
				if (msg.state !== 'none') for (const id of msg.ids) (recFor(id)?.els ?? []).forEach((el) => el.setAttribute('data-codesigner-force', msg.state));
				break;
			case 'set-text': {
				if (lastEdit?.id === msg.id) {
					lastEdit.restore();
					lastEdit = null;
					break;
				}
				const el = recFor(msg.id)?.els[0] ?? elFor(msg.id);
				if (el) el.textContent = msg.text;
				break;
			}
			case 'text-link':
				applyLink(msg.href);
				break;
		}
	});

	function toTree(): LayerNode {
		const root = rebuild();
		return {
			id: 'root',
			name: document.title || 'Page',
			kind: 'frame',
			tag: 'body',
			loc: null,
			isInstance: false,
			repeatCount: 1,
			children: root.children.map(toNode)
		};
	}

	// ------------------------------------------------------- observers
	let changeTimer: ReturnType<typeof setTimeout> | null = null;
	const onDomChange = (reason: 'mutation' | 'hmr') => {
		treeDirty = true;
		pushRects();
		if (changeTimer) clearTimeout(changeTimer);
		changeTimer = setTimeout(() => send({ type: 'dom-changed', reason }), reason === 'hmr' ? 0 : 120);
	};

	new MutationObserver((records) => {
		// Ignore our own preview edits.
		if (records.every((r) => (r.target as Element).id === 'codesigner-preview' || originalClass.has(r.target as Element)))
			return;
		onDomChange('mutation');
	}).observe(document.documentElement, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: ['class', 'style', 'hidden', 'open']
	});
	addEventListener('scroll', pushRects, { capture: true, passive: true });
	addEventListener('resize', pushRects, { passive: true });

	// HMR notifications from Vite's own client, when present.
	import(/* @vite-ignore */ `${location.origin}/@vite/client`)
		.then((client: { createHotContext?: (path: string) => { on(e: string, cb: (p: unknown) => void): void } }) => {
			const hot = client.createHotContext?.('/@codesigner/bridge');
			hot?.on('vite:afterUpdate', () => onDomChange('hmr'));
		})
		.catch(() => {});

	// SvelteKit client-side navigation.
	const notifyNavigation = () => {
		treeDirty = true;
		setTimeout(() => send({ type: 'navigated', url: location.href, title: document.title }), 50);
	};
	for (const method of ['pushState', 'replaceState'] as const) {
		const original = history[method].bind(history);
		history[method] = (...args: Parameters<History['pushState']>) => {
			const result = original(...args);
			notifyNavigation();
			return result;
		};
	}
	addEventListener('popstate', notifyNavigation);

	const announceReady = () => {
		const svelteDev = !!document.body && Array.from(document.body.querySelectorAll('*')).some((el) => metaOf(el));
		send({ type: 'ready', url: location.href, title: document.title, svelteDev });
	};
	// SvelteKit hydrates asynchronously after load; announce again once it likely has.
	const announceTwice = () => {
		announceReady();
		setTimeout(announceReady, 600);
		setTimeout(announceReady, 2500);
	};
	if (document.readyState === 'complete') announceTwice();
	else addEventListener('load', announceTwice, { once: true });

	void mode;
}
