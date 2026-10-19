<script lang="ts">
	import { onMount } from 'svelte';
	import type { Breakpoint, DropTarget, GuestToHost, NodeId, Rect } from '@codesigner/protocol';
	import { Ellipsis, Play, Plus, RotateCw, TriangleAlert } from '@lucide/svelte';
	import { editor, isDrawTool } from '#lib/state/editor.svelte.js';
	import { drawLayer, insertComponent, insertImage, moveLayer } from '#lib/state/commands.js';
	import { invoke } from '#lib/api.js';
	import { BridgeClient } from './bridge-client';
	import { breakpointLabel } from './breakpoints';
	import { measure } from './measure';
	import { m } from '#lib/paraglide/messages.js';

	type Props = {
		breakpoint: Breakpoint;
		x: number;
		url: string | null;
	};

	let { breakpoint, x, url }: Props = $props();

	let host: HTMLDivElement;
	let gesture: HTMLDivElement;
	let webview: (HTMLElement & Record<string, any>) | null = null;
	let client: BridgeClient | null = null;
	let loadError = $state<string | null>(null);
	let loading = $state(true);
	let svelteDev = $state(false);
	let metadataTimedOut = $state(false);
	$effect(() => {
		if (!url) return;
		const timer = setTimeout(() => (metadataTimedOut = true), 10000);
		return () => clearTimeout(timer);
	});

	const frameId = $derived(breakpoint.id);
	const scale = $derived(editor.camera.scale);
	const isPrimary = $derived(breakpoint.primary ?? false);
	/** Framer's component canvas: variants and states of one component. */
	const isComponentCanvas = $derived(frameId === 'component');

	// Hover / Pressed cells: force the pseudo-classes on each cell's root (re-applied after every DOM change).
	let forceTimer: ReturnType<typeof setTimeout> | null = null;
	function forceStates() {
		if (forceTimer) clearTimeout(forceTimer);
		forceTimer = setTimeout(() => {
			const id = webview?.getWebContentsId?.();
			if (!id) return;
			void invoke('canvas:force-states', id, [
				{ selector: '[data-codesigner-state="hover"] > *', states: ['hover'] },
				{ selector: '[data-codesigner-state="active"] > *', states: ['hover', 'active'] },
				{ selector: '[data-codesigner-state="focus"] > *', states: ['focus', 'focus-visible'] }
			]);
		}, 150);
	}
	const designMode = $derived(editor.mode === 'design' && editor.effectiveTool === 'select');
	/** Comment tool (C): click to pin a comment on an element. */
	const commenting = $derived(editor.mode === 'design' && editor.effectiveTool === 'comment' && !isComponentCanvas);
	/** A draw tool (S / F / T / ⇧G) is active: drag or click to insert a layer. */
	const drawing = $derived(editor.mode === 'design' && isDrawTool(editor.effectiveTool) && !isComponentCanvas);
	const selectedRects = $derived(editor.selectedRects[frameId] ?? {});
	const selectedComponent = $derived(editor.selected?.kind === 'instance');
	const hoverRect = $derived(editor.hoverRect?.frameId === frameId ? editor.hoverRect.rect : null);
	/** ⌥ distances from the selection to the hovered layer (Framer's red measurement lines). */
	const measures = $derived.by(() => {
		if (!editor.altHeld || !hoverRect || editor.selection.frameId !== frameId || !editor.hover) return [];
		const first = editor.selection.ids[0];
		const from = first ? selectedRects[first] : null;
		return from && !editor.selection.ids.includes(editor.hover.id) ? measure(from, hoverRect) : [];
	});

	function onMessage(message: GuestToHost) {
		switch (message.type) {
			case 'ready':
				loading = false;
				loadError = null;
				svelteDev = svelteDev || message.svelteDev;
				editor.frameReady = { ...editor.frameReady, [frameId]: true };
				client?.send({ type: 'init', frameId, scope: editor.scope, mode: editor.mode });
				if (editor.darkPreview) client?.send({ type: 'set-dark', dark: true });
				editor.onFrameNavigated(frameId, message.url, message.title);
				client?.send({ type: 'request-tree' });
				editor.syncHighlights();
				editor.syncAnchors(frameId);
				break;
			case 'tree':
				if (message.root?.children.length) svelteDev = true;
				editor.setTree(frameId, message.root);
				if (isComponentCanvas) forceStates();
				break;
			case 'rects':
				editor.setRects(frameId, message.hover, message.selected, message.parents, message.focus, message.anchors);
				break;
			case 'dom-changed':
				if (message.reason === 'hmr') {
					client?.send({ type: 'clear-preview' });
					editor.onHmr();
					void editor.reresolveSelection();
				}
				client?.send({ type: 'request-tree' });
				break;
			case 'navigated':
				editor.onFrameNavigated(frameId, message.url, message.title);
				client?.send({ type: 'request-tree' });
				break;
			case 'text-edited':
				void editor.onTextEdited(frameId, message.id, message.text, message.original, message.cancelled);
				break;
			case 'scrolled':
				if (!message.consumed) {
					editor.camera = { ...editor.camera, x: editor.camera.x - message.dx, y: editor.camera.y - message.dy };
				}
				break;
		}
	}

	onMount(() => {
		// Created imperatively so `partition` is set before `src` (it can't change after the first navigation).
		const el = document.createElement('webview') as HTMLElement & Record<string, any>;
		el.setAttribute('partition', 'persist:preview');
		el.setAttribute('allowpopups', '');
		el.setAttribute('preload', editor.appInfo?.guestPreload ?? '');
		el.style.width = '100%';
		el.style.height = '100%';
		el.style.display = 'flex';
		el.style.background = 'white';
		el.addEventListener('dom-ready', () => {
			try {
				el.setZoomLevel(0);
			} catch {
				// not attached
			}
		});
		el.addEventListener('did-start-loading', () => (loading = true));
		el.addEventListener('did-fail-load', (event: any) => {
			if (event.errorCode === -3 || !event.isMainFrame) return; // aborted navigations are normal
			loading = false;
			loadError = `${event.errorDescription || 'Failed to load'} (${event.validatedURL})`;
		});
		el.addEventListener('did-stop-loading', () => (loading = false));
		if (url) el.setAttribute('src', url);
		host.prepend(el);
		webview = el;
		client = new BridgeClient(frameId, el as any);
		client.subscribe(onMessage);
		editor.registerFrame(frameId, client);
		return () => {
			editor.unregisterFrame(frameId);
			client = null;
			el.remove();
		};
	});

	// Load the dev server URL once it is known (or changes, e.g. switching branches).
	let loadedOrigin: string | null = null;
	$effect(() => {
		if (!webview || !url) return;
		const origin = new URL(url).origin;
		if (origin !== loadedOrigin) {
			loadedOrigin = origin;
			loadError = null;
			webview.setAttribute('src', url);
		}
	});

	export function reload() {
		loadError = null;
		try {
			webview?.reload();
		} catch {
			if (url) webview?.setAttribute('src', url);
		}
	}

	export function openDevTools() {
		try {
			webview?.openDevTools();
		} catch {
			// not attached
		}
	}

	// ------------------------------------------------------------ gestures
	const toGuest = (event: MouseEvent) => {
		const rect = gesture.getBoundingClientRect();
		return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
	};

	let hoverSeq = 0;
	let lastHit: NodeId[] = [];
	async function onpointermove(event: PointerEvent) {
		if (dragArm) return void dragMove(event);
		if (drawing) {
			const p = toGuest(event);
			if (drawStart) {
				drawBox = { x: Math.min(drawStart.x, p.x), y: Math.min(drawStart.y, p.y), width: Math.abs(p.x - drawStart.x), height: Math.abs(p.y - drawStart.y) };
			} else void previewDrop(p.x, p.y);
			return;
		}
		if (!client || !designMode) return;
		const seq = ++hoverSeq;
		const { x, y } = toGuest(event);
		const path = await client.hit(x, y);
		if (seq !== hoverSeq) return;
		lastHit = path;
		// Hover shows what a click would select: the innermost layer, or with ⌘ the container.
		const id = editor.pick(path, (event.metaKey || event.ctrlKey) && !event.altKey ? 'container' : 'click', frameId);
		editor.setHover(frameId, id);
	}

	function onpointerleave() {
		hoverSeq++;
		dropSeq++;
		if (!drawStart) dropPreview = null;
		editor.setHover(frameId, null);
	}

	async function onclick(event: MouseEvent) {
		if (commenting && client) return void startComment(event);
		if (!client || !designMode || suppressClick) return;
		const { x, y } = toGuest(event);
		const path = await client.hit(x, y);
		lastHit = path;
		const container = event.metaKey || event.ctrlKey;
		if (editor.textEditing) {
			// Clicking anywhere commits the text being typed; a click inside it keeps editing.
			if (editor.textEditing.frameId === frameId && path.includes(editor.textEditing.id)) return;
			editor.endTextEdit();
		}
		// The first click of a double-click may still be selecting.
		if (event.detail >= 2) await selecting;
		const current = editor.selected;
		// Double-clicking the selected instance of one of the project's components opens it, like Framer.
		if (!container && event.detail >= 2 && current?.kind === 'instance' && editor.selection.frameId === frameId && path.at(-1) === current.id && !isComponentCanvas) {
			if (editor.openComponent(current)) return;
		}
		// Double-clicking the selected text layer edits it in place, like Framer.
		if (!container && event.detail >= 2 && current?.textEditable && editor.selection.frameId === frameId && path.includes(current.id)) {
			void editor.startTextEdit(frameId, current.id);
			return;
		}
		// Clicking the dimmed page around a component edited in place goes back to the page, like Framer.
		if (path.length === 0 && editor.inPlace && !isComponentCanvas) return editor.exitInPlace();
		selecting = editor.selectFromHit(frameId, path, container ? 'container' : 'click', event.shiftKey);
		await selecting;
	}
	let selecting: Promise<void> = Promise.resolve();

	// ------------------------------------------------------------ drawing
	let dropPreview = $state<DropTarget | null>(null);
	let drawStart: { x: number; y: number } | null = null;
	let drawBox = $state<Rect | null>(null);
	let suppressClick = false;
	let dropSeq = 0;
	$effect(() => {
		if (!drawing) {
			dropPreview = null;
			drawBox = null;
			drawStart = null;
		}
	});

	async function previewDrop(x: number, y: number) {
		const seq = ++dropSeq;
		const target = (await client?.dropTarget(x, y)) ?? null;
		if (seq === dropSeq && drawing) dropPreview = target;
	}

	// ---------------------------------------------------- drag to reorder
	/** Armed on pointerdown inside the selected layer; becomes a drag after a few pixels. */
	let dragArm: { id: NodeId; start: { x: number; y: number }; rect: Rect } | null = null;
	let dragging = $state<{ id: NodeId; rect: Rect; dx: number; dy: number } | null>(null);
	let dragTarget = $state<DropTarget | null>(null);

	function armDrag(event: PointerEvent): boolean {
		const info = editor.selected;
		if (!designMode || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || editor.textEditing) return false;
		if (editor.selection.frameId !== frameId || editor.selection.ids.length !== 1 || !info?.loc || !info.editable) return false;
		const rect = selectedRects[info.id];
		const p = toGuest(event);
		if (!rect || p.x < rect.x || p.y < rect.y || p.x > rect.x + rect.width || p.y > rect.y + rect.height) return false;
		dragArm = { id: info.id, start: p, rect };
		gesture.setPointerCapture(event.pointerId);
		return true;
	}

	let dragSeq = 0;
	async function dragMove(event: PointerEvent) {
		if (!dragArm || !client) return;
		const p = toGuest(event);
		const dx = p.x - dragArm.start.x;
		const dy = p.y - dragArm.start.y;
		if (!dragging && Math.hypot(dx, dy) * scale < 4) return;
		dragging = { id: dragArm.id, rect: dragArm.rect, dx, dy };
		editor.setHover(frameId, null);
		const seq = ++dragSeq;
		const target = await client.dropTarget(p.x, p.y, dragArm.id);
		if (seq === dragSeq && dragging) dragTarget = target;
	}

	async function dragEnd(event: PointerEvent) {
		const wasDragging = !!dragging;
		const arm = dragArm;
		dragArm = null;
		dragging = null;
		dragSeq++;
		const target = dragTarget;
		dragTarget = null;
		if (!wasDragging || !arm || !client) return;
		suppressClick = true;
		setTimeout(() => (suppressClick = false), 0);
		const p = toGuest(event);
		const final = (await client.dropTarget(p.x, p.y, arm.id)) ?? target;
		if (final) void moveLayer(frameId, final);
	}

	function onpointerdown(event: PointerEvent) {
		if (armDrag(event)) return;
		if (!drawing || event.button !== 0) return;
		event.preventDefault();
		gesture.setPointerCapture(event.pointerId);
		drawStart = toGuest(event);
		drawBox = { ...drawStart, width: 0, height: 0 };
		void previewDrop(drawStart.x, drawStart.y);
	}

	async function onpointerup(event: PointerEvent) {
		if (dragArm) return void dragEnd(event);
		if (!drawing || !drawStart || !client) return;
		const start = drawStart;
		const box = drawBox;
		drawStart = null;
		drawBox = null;
		suppressClick = true;
		setTimeout(() => (suppressClick = false), 0);
		const tool = editor.effectiveTool;
		if (!isDrawTool(tool)) return;
		const target = await client.dropTarget(start.x, start.y);
		dropPreview = null;
		editor.tool = 'select'; // like Framer, a tool draws one layer
		if (!target) {
			editor.toast(m.draw_no_container());
			return;
		}
		const size = box && box.width >= 6 && box.height >= 6 ? { width: box.width, height: box.height } : null;
		void drawLayer(tool, frameId, target, size);
	}

	// ------------------------------------------ components from Assets
	function ondragover(event: DragEvent) {
		if (!editor.draggingAsset || isComponentCanvas) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
		const p = toGuest(event);
		void previewComponentDrop(p.x, p.y);
	}
	let componentDropSeq = 0;
	let componentDrop = $state<DropTarget | null>(null);
	async function previewComponentDrop(x: number, y: number) {
		const seq = ++componentDropSeq;
		const target = (await client?.dropTarget(x, y)) ?? null;
		if (seq === componentDropSeq && editor.draggingAsset) componentDrop = target;
	}
	async function ondrop(event: DragEvent) {
		const asset = editor.draggingAsset;
		editor.draggingAsset = null;
		componentDropSeq++;
		componentDrop = null;
		if (!asset || !client) return;
		event.preventDefault();
		const p = toGuest(event);
		const target = await client.dropTarget(p.x, p.y);
		if (!target) return void editor.toast(m.draw_no_container());
		if ('component' in asset) void insertComponent(asset.component, frameId, target);
		else void insertImage(asset.image, frameId, target);
	}
	$effect(() => {
		if (!editor.draggingAsset) componentDrop = null;
	});

	// ------------------------------------------------------------ comments
	async function startComment(event: MouseEvent) {
		if (!client) return;
		editor.openComment = null;
		const p = toGuest(event);
		const path = await client.hit(p.x, p.y);
		const id = editor.pick(path, 'click', frameId);
		const [info] = id ? await client.describe([id]) : [];
		if (!info?.loc) return void editor.toast(m.comment_no_layer());
		const twins = await client.findLoc({ ...info.loc, tag: info.componentTag ?? info.tag });
		const r = info.rect;
		draftPoint = p;
		draftBody = '';
		editor.commentDraft = {
			frameId,
			anchor: {
				file: info.loc.file,
				line: info.loc.line,
				column: info.loc.column,
				tag: info.componentTag ?? info.tag,
				occurrence: Math.max(0, twins.indexOf(info.id)),
				text: info.text,
				name: info.name,
				x: r.width ? Math.min(1, Math.max(0, (p.x - r.x) / r.width)) : 0.5,
				y: r.height ? Math.min(1, Math.max(0, (p.y - r.y) / r.height)) : 0.5
			}
		};
	}

	/** Pins of this page with their position in this frame (guest px). */
	const pins = $derived.by(() => {
		if (!commenting) return [];
		const rects = editor.pinRects[frameId] ?? {};
		return editor.pageComments
			.map((comment, i) => {
				const r = rects[comment.id];
				return r ? { comment, n: i + 1, x: r.x + comment.anchor.x * r.width, y: r.y + comment.anchor.y * r.height } : null;
			})
			.filter((p) => p !== null);
	});
	/** Where the comment being written was clicked (guest px). */
	let draftPoint = $state<{ x: number; y: number } | null>(null);
	const drafting = $derived(commenting && editor.commentDraft?.frameId === frameId && !!draftPoint);
	let draftBody = $state('');
	let replyBody = $state('');

	function onwheel(event: WheelEvent) {
		if (event.ctrlKey || event.metaKey || !client) return; // zoom is handled by the canvas
		event.preventDefault();
		event.stopPropagation();
		const { x, y } = toGuest(event);
		client.send({ type: 'scroll-at', x, y, dx: event.deltaX / scale, dy: event.deltaY / scale });
	}

	function oncontextmenu(event: MouseEvent) {
		event.preventDefault();
	}

	// --------------------------------------------- padding / gap handles
	type HandleKind = 'top' | 'right' | 'bottom' | 'left' | 'gap';
	/** The one selected layer, when the canvas handles can style it (resize, padding, gap). */
	const styleTarget = $derived.by(() => {
		const info = editor.selected;
		if (!designMode || dragging || !editor.styleCommands || editor.selection.frameId !== frameId || editor.selection.ids.length !== 1) return null;
		if (!info?.editable || !info.loc || isComponentCanvas || editor.textEditing) return null;
		// A component that doesn't take `class` would ignore the edit: style it inside ("Edit component").
		if (info.kind === 'instance') {
			const tag = info.componentTag ?? '';
			const component = editor.components.find((c) => c.exportedAs.includes(tag) || c.name === tag || c.file === info.definitionFile);
			if (!component?.acceptsClass) return null;
		}
		const rect = selectedRects[info.id];
		return rect ? { info, rect } : null;
	});
	const handleLayer = $derived.by(() => {
		if (!styleTarget) return null;
		const { info, rect } = styleTarget;
		if (rect.width * scale < 60 || rect.height * scale < 36) return null;
		const c = info.computed;
		const layout = /flex|grid/.test(c.display);
		const p = c.padding;
		if (!layout && !(p.top || p.right || p.bottom || p.left)) return null;
		return { info, rect, padding: p, layout };
	});
	/** Bands (guest px) where each handle sits: the padding on each side, and the first gap between children. */
	const handles = $derived.by(() => {
		if (!handleLayer) return [];
		const { rect: r, padding: p, info } = handleLayer;
		const out: { kind: HandleKind; band: Rect; vertical: boolean; value: number }[] = [
			{ kind: 'top', band: { x: r.x + p.left, y: r.y, width: r.width - p.left - p.right, height: p.top }, vertical: false, value: p.top },
			{ kind: 'bottom', band: { x: r.x + p.left, y: r.y + r.height - p.bottom, width: r.width - p.left - p.right, height: p.bottom }, vertical: false, value: p.bottom },
			{ kind: 'left', band: { x: r.x, y: r.y + p.top, width: p.left, height: r.height - p.top - p.bottom }, vertical: true, value: p.left },
			{ kind: 'right', band: { x: r.x + r.width - p.right, y: r.y + p.top, width: p.right, height: r.height - p.top - p.bottom }, vertical: true, value: p.right }
		];
		const kids = info.childOffsets ?? [];
		if (handleLayer.layout && kids.length >= 2) {
			const [a, b] = kids;
			const row = b.x >= a.x + a.width - 1;
			const gap = row ? b.x - (a.x + a.width) : b.y - (a.y + a.height);
			if (gap >= 0) {
				out.push({
					kind: 'gap',
					band: row
						? { x: r.x + a.x + a.width, y: r.y + Math.min(a.y, b.y), width: gap, height: Math.max(a.height, b.height) }
						: { x: r.x + Math.min(a.x, b.x), y: r.y + a.y + a.height, width: Math.max(a.width, b.width), height: gap },
					vertical: row,
					value: Math.round(gap)
				});
			}
		}
		return out;
	});

	let handleDrag = $state<{ kind: HandleKind; value: number } | null>(null);
	let handleHover = $state<HandleKind | null>(null);

	function onhandledown(event: PointerEvent, handle: (typeof handles)[number]) {
		event.stopPropagation();
		event.preventDefault();
		const el = event.currentTarget as HTMLElement;
		el.setPointerCapture(event.pointerId);
		const start = { x: event.clientX, y: event.clientY };
		const sign = handle.kind === 'bottom' || handle.kind === 'right' ? -1 : 1;
		let value = handle.value;
		const move = (e: PointerEvent) => {
			const delta = (handle.vertical ? e.clientX - start.x : e.clientY - start.y) / scale;
			const raw = Math.max(0, handle.value + (handle.kind === 'gap' ? delta : sign * delta));
			value = e.altKey ? Math.round(raw) : Math.round(raw / 4) * 4;
			handleDrag = { kind: handle.kind, value };
			if (handle.kind === 'gap') editor.styleCommands?.gap(value, false);
			else editor.styleCommands?.padding(e.shiftKey ? 'all' : handle.kind, value, false);
		};
		const up = (e: PointerEvent) => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			handleDrag = null;
			if (value === handle.value) return editor.clearPreview();
			if (handle.kind === 'gap') editor.styleCommands?.gap(value, true);
			else editor.styleCommands?.padding(e.shiftKey ? 'all' : handle.kind, value, true);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	// ------------------------------------------------------ resize handles
	/** Framer: drag an edge or corner of the selection to give it a fixed size. */
	type ResizeKind = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
	const RESIZE_CURSOR: Record<ResizeKind, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
	const resizeZones = $derived.by(() => {
		if (!styleTarget || handleDrag) return [];
		const r = styleTarget.rect;
		if (r.width * scale < 12 || r.height * scale < 12) return [];
		const t = 8 / scale; // hit thickness: 8 screen px across the outline
		const c = 12 / scale; // corner hit size
		const zones: { kind: ResizeKind; box: Rect }[] = [
			{ kind: 'n', box: { x: r.x + c / 2, y: r.y - t / 2, width: r.width - c, height: t } },
			{ kind: 's', box: { x: r.x + c / 2, y: r.y + r.height - t / 2, width: r.width - c, height: t } },
			{ kind: 'w', box: { x: r.x - t / 2, y: r.y + c / 2, width: t, height: r.height - c } },
			{ kind: 'e', box: { x: r.x + r.width - t / 2, y: r.y + c / 2, width: t, height: r.height - c } },
			{ kind: 'nw', box: { x: r.x - c / 2, y: r.y - c / 2, width: c, height: c } },
			{ kind: 'ne', box: { x: r.x + r.width - c / 2, y: r.y - c / 2, width: c, height: c } },
			{ kind: 'sw', box: { x: r.x - c / 2, y: r.y + r.height - c / 2, width: c, height: c } },
			{ kind: 'se', box: { x: r.x + r.width - c / 2, y: r.y + r.height - c / 2, width: c, height: c } }
		];
		return zones;
	});
	let resizing = $state<{ width: number; height: number } | null>(null);

	function onresizedown(event: PointerEvent, kind: ResizeKind) {
		if (!styleTarget || event.button !== 0) return;
		event.stopPropagation();
		event.preventDefault();
		const el = event.currentTarget as HTMLElement;
		el.setPointerCapture(event.pointerId);
		const start = { x: event.clientX, y: event.clientY, width: styleTarget.rect.width, height: styleTarget.rect.height };
		const horizontal = kind.includes('e') || kind.includes('w');
		const vertical = kind.includes('n') || kind.includes('s');
		let size: { width: number | null; height: number | null } = { width: null, height: null };
		const move = (e: PointerEvent) => {
			const dx = ((e.clientX - start.x) / scale) * (kind.includes('w') ? -1 : 1);
			const dy = ((e.clientY - start.y) / scale) * (kind.includes('n') ? -1 : 1);
			const snap = (v: number) => Math.max(0, e.altKey ? Math.round(v) : Math.round(v / 4) * 4);
			let width = horizontal ? snap(start.width + dx) : null;
			let height = vertical ? snap(start.height + dy) : null;
			// ⇧ on a corner keeps the proportions, following the axis that moved most.
			if (e.shiftKey && width !== null && height !== null && start.width > 0 && start.height > 0) {
				const ratio = start.width / start.height;
				if (Math.abs(dx) * start.height >= Math.abs(dy) * start.width) height = snap(width / ratio);
				else width = snap(height * ratio);
			}
			size = { width, height };
			resizing = { width: width ?? Math.round(start.width), height: height ?? Math.round(start.height) };
			editor.styleCommands?.size(width, height, false);
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			resizing = null;
			const changed = (size.width !== null && size.width !== Math.round(start.width)) || (size.height !== null && size.height !== Math.round(start.height));
			if (!changed) return editor.clearPreview();
			editor.styleCommands?.size(size.width, size.height, true);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	function onresizedouble(kind: ResizeKind) {
		if (kind.includes('e') || kind.includes('w')) editor.styleCommands?.fit('width');
		if (kind.includes('n') || kind.includes('s')) editor.styleCommands?.fit('height');
	}

	const label = $derived(breakpointLabel(breakpoint));
	/** On-screen pill width is small: keep only the essentials. */
	const compact = $derived(breakpoint.width * scale < 190);

	// ------------------------------------------------------ breakpoint menu
	let menu = $state<'add' | 'more' | null>(null);
	let menuEl = $state<HTMLDivElement | null>(null);
	let customWidth = $state('');
	let widthDraft = $state('');
	$effect(() => {
		if (menu === 'more') widthDraft = String(breakpoint.width);
	});
	const PRESETS = [
		{ name: 'Desktop', width: 1440 },
		{ name: 'Laptop', width: 1280 },
		{ name: 'Tablet', width: 810 },
		{ name: 'Tablet portrait', width: 768 },
		{ name: 'Phone', width: 390 },
		{ name: 'Small phone', width: 360 }
	];
	const presets = $derived(PRESETS.filter((p) => !editor.breakpoints.some((b) => b.width === p.width)));
	$effect(() => {
		if (!menu) return;
		const close = (event: PointerEvent) => {
			if (menuEl && !menuEl.contains(event.target as Node) && !(event.target as HTMLElement).closest?.('[data-bp-toggle]')) menu = null;
		};
		const onKey = (event: KeyboardEvent) => event.key === 'Escape' && (menu = null);
		window.addEventListener('pointerdown', close, true);
		window.addEventListener('keydown', onKey, true);
		return () => {
			window.removeEventListener('pointerdown', close, true);
			window.removeEventListener('keydown', onKey, true);
		};
	});
</script>

<div
	class="absolute top-0 left-0 origin-top-left"
	style="width:{breakpoint.width}px; height:{breakpoint.height}px; --inv:{1 / scale}; z-index:{menu ? 40 : 'auto'};
		transform: translate({editor.camera.x + x * scale}px, {editor.camera.y}px) scale({scale});"
>
	<!-- Breakpoint label pill, kept at a constant on-screen size -->
	<div
		class="absolute bottom-full left-0 z-40 origin-bottom-left pb-2"
		style="width:{breakpoint.width * scale}px; transform: scale({1 / scale});"
	>
		<div
			class="flex h-7 items-center gap-2 rounded-[10px] px-1 text-[12px]
				{isComponentCanvas ? 'bg-component-tint text-component' : editor.activeFrameId === frameId ? 'bg-accent-tint text-accent' : 'bg-black/[0.04] text-label dark:bg-white/[0.05]'}"
		>
			<button
				type="button"
				class="flex size-5 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/5 {compact ? 'hidden' : ''}"
				aria-label={m.frame_preview()}
				title={m.frame_preview()}
				onclick={() => url && window.open(url)}
			>
				<Play class="size-3" />
			</button>
			<button type="button" class="flex min-w-0 items-center gap-2" onclick={() => (editor.activeFrameId = frameId)}>
				<span class="font-semibold {isComponentCanvas ? 'text-component' : editor.activeFrameId === frameId ? 'text-accent' : 'text-fg'}">{label}</span>
				{#if isComponentCanvas}
					<span class="opacity-70">{m.component_canvas_label()}</span>
				{:else}
					<span class="tabular-nums">{breakpoint.width}</span>
					{#if isPrimary}<span class="text-muted">{m.frame_primary()}</span>{/if}
				{/if}
			</button>
			<span class="flex-1"></span>
			{#if loading && !loadError}
				<span class="size-1.5 animate-pulse rounded-full bg-accent"></span>
			{/if}
			<button
				type="button"
				class="flex size-5 shrink-0 items-center justify-center rounded-[4px] hover:bg-black/5 {compact ? 'hidden' : ''}"
				aria-label={m.frame_reload()}
				title={m.frame_reload()}
				onclick={reload}
			>
				<RotateCw class="size-3" />
			</button>
			{#if !isComponentCanvas}
			<button
				type="button"
				class="flex size-5 items-center justify-center rounded-[5px] hover:bg-black/5 {menu === 'more' ? 'bg-black/5' : ''}"
				data-bp-toggle
				aria-label={m.breakpoint_options()}
				title={m.breakpoint_options()}
				onclick={() => (menu = menu === 'more' ? null : 'more')}
			>
				<Ellipsis class="size-3" />
			</button>
			<button
				type="button"
				class="flex size-5 items-center justify-center rounded-[5px] hover:bg-black/5 {menu === 'add' ? 'bg-black/5' : ''}"
				data-bp-toggle
				aria-label={m.frame_add_breakpoint()}
				title={m.frame_add_breakpoint()}
				onclick={() => (menu = menu === 'add' ? null : 'add')}
			>
				<Plus class="size-3" />
			</button>
			{/if}
		</div>

		{#if menu}
			<div
				bind:this={menuEl}
				class="absolute top-full right-0 mt-1 w-56 rounded-popover bg-popover p-1 text-[12px] text-fg shadow-popover"
				role="menu"
			>
				{#if menu === 'add'}
					<p class="px-2.5 pt-1 pb-1.5 text-[11px] text-muted">{m.frame_add_breakpoint()}</p>
					{#each presets as preset (preset.width)}
						<button type="button" role="menuitem" class="flex h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left hover:bg-accent hover:text-white"
							onclick={() => { menu = null; void editor.addBreakpoint(preset.width, preset.name); }}>
							<span class="flex-1">{preset.name}</span>
							<span class="tabular-nums opacity-60">{preset.width}</span>
						</button>
					{/each}
					<form class="flex items-center gap-1.5 px-1.5 pt-1.5 pb-1" onsubmit={(e) => { e.preventDefault(); const w = Number(customWidth); if (w > 0) { menu = null; customWidth = ''; void editor.addBreakpoint(w); } }}>
						<input class="h-[26px] min-w-0 flex-1 rounded-control bg-control px-2 tabular-nums outline-none placeholder:text-muted" placeholder={m.breakpoint_custom_width()} inputmode="numeric" bind:value={customWidth} />
						<button type="submit" class="h-[26px] rounded-control bg-accent px-2 text-white">{m.action_add()}</button>
					</form>
				{:else}
					<form class="flex items-center gap-2 px-2.5 py-1" onsubmit={(e) => { e.preventDefault(); const w = Number(widthDraft); if (w > 0) { menu = null; void editor.resizeBreakpoint(frameId, w); } }}>
						<span class="flex-1 text-label">{m.breakpoint_width()}</span>
						<input class="h-[26px] w-20 rounded-control bg-control px-2 text-right tabular-nums outline-none" inputmode="numeric" bind:value={widthDraft} />
					</form>
					{#if !isPrimary}
						<button type="button" role="menuitem" class="flex h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left hover:bg-accent hover:text-white"
							onclick={() => { menu = null; void editor.setPrimaryBreakpoint(frameId); }}>
							{m.breakpoint_make_primary()}
						</button>
						<button type="button" role="menuitem" class="flex h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-danger hover:bg-danger hover:text-white"
							onclick={() => { menu = null; void editor.removeBreakpoint(frameId); }}>
							{m.breakpoint_remove()}
						</button>
					{/if}
				{/if}
			</div>
		{/if}
	</div>

	<div
		bind:this={host}
		class="relative h-full w-full overflow-hidden bg-white"
		style="box-shadow: 0 0 0 calc(1px * var(--inv)) rgba(0,0,0,0.06), 0 calc(4px * var(--inv)) calc(24px * var(--inv)) rgba(0,0,0,0.06);"
	>
		<!-- Gesture layer: in Design mode it captures pointer input so clicks select instead of interacting. -->
		<div
			bind:this={gesture}
			class="absolute inset-0 z-10"
			style="pointer-events:{designMode || drawing || commenting || editor.draggingAsset ? 'auto' : 'none'}; cursor:{drawing || commenting ? 'crosshair' : designMode ? 'default' : 'auto'}"
			role="presentation"
			{ondragover}
			{ondrop}
			ondragleave={() => ((componentDropSeq++), (componentDrop = null))}
			{onpointerdown}
			{onpointerup}
			{onpointermove}
			{onpointerleave}
			{onclick}
			{onwheel}
			{oncontextmenu}
		></div>

		<!-- Overlays -->
		<div class="pointer-events-none absolute inset-0 z-20">
			{#each pins as pin (pin.comment.id)}
				{@const open = editor.openComment === pin.comment.id && (editor.openCommentFrame ?? editor.primaryFrameId) === frameId}
				{@const flip = (pin.x + 290 / scale) > breakpoint.width}
				<button
					type="button"
					class="pointer-events-auto absolute flex size-6 items-center justify-center rounded-full rounded-bl-none text-[11px] font-semibold text-white shadow-md
						{pin.comment.resolved ? 'bg-faint' : open ? 'bg-accent-strong ring-2 ring-white' : 'bg-accent'}"
					style="left:{pin.x}px; top:{pin.y}px; transform: translateY(-100%) scale(var(--inv)); transform-origin: bottom left;"
					aria-label={m.comment_open({ n: pin.n })}
					data-comment={pin.comment.id}
					onclick={(e) => {
						e.stopPropagation();
						editor.commentDraft = null;
						replyBody = '';
						editor.openCommentFrame = frameId;
						editor.openComment = open ? null : pin.comment.id;
					}}
				>
					{pin.n}
				</button>
				{#if open}
					{@const c = pin.comment}
					<div class="pointer-events-auto absolute z-10 flex w-[260px] flex-col gap-2 rounded-popover bg-popover p-3 text-[12px] text-fg shadow-popover"
						style="left:{pin.x}px; top:{pin.y}px; transform: translate({flip ? 'calc(-100% * var(--inv) - 8px * var(--inv))' : 'calc(18px * var(--inv))'}, 0) scale(var(--inv)); transform-origin: top left;"
						role="dialog" aria-label={m.comment_thread()}>
						<p class="truncate text-[10.5px] text-muted">{c.anchor.name} · {c.anchor.file}:{c.anchor.line}</p>
						{#each c.messages as msg, i (i)}
							<div>
								<p class="text-[11px] font-semibold text-fg-strong">{msg.author} <span class="font-normal text-muted">{new Date(msg.at).toLocaleString()}</span></p>
								<p class="whitespace-pre-wrap">{msg.body}</p>
							</div>
						{/each}
						<form class="flex gap-1" onsubmit={(e) => { e.preventDefault(); void editor.replyComment(c.id, replyBody); replyBody = ''; }}>
							<input class="h-7 min-w-0 flex-1 rounded-[6px] bg-control px-2 outline-none placeholder:text-muted" placeholder={m.comment_reply()} bind:value={replyBody} />
						</form>
						<div class="flex items-center gap-1">
							<button type="button" class="h-7 rounded-[6px] bg-control px-2 hover:bg-control-hover" onclick={() => editor.resolveComment(c.id, !c.resolved)}>{c.resolved ? m.comment_reopen() : m.comment_resolve()}</button>
							<button type="button" class="h-7 rounded-[6px] px-2 text-label hover:bg-control" onclick={() => editor.copyForAgent([c])}>{m.comment_copy_agent()}</button>
							<span class="flex-1"></span>
							<button type="button" class="h-7 rounded-[6px] px-2 text-danger hover:bg-danger/10" onclick={() => editor.deleteComment(c.id)}>{m.comment_delete()}</button>
						</div>
					</div>
				{/if}
			{/each}
			{#if drafting && draftPoint}
				<span class="absolute size-6 rounded-full rounded-bl-none bg-accent shadow-md"
					style="left:{draftPoint.x}px; top:{draftPoint.y}px; transform: translateY(-100%) scale(var(--inv)); transform-origin: bottom left;"></span>
				<form class="pointer-events-auto absolute z-10 flex w-[260px] flex-col gap-2 rounded-popover bg-popover p-3 text-[12px] shadow-popover"
					style="left:{draftPoint.x}px; top:{draftPoint.y}px; transform: translate(calc(18px * var(--inv)), 0) scale(var(--inv)); transform-origin: top left;"
					onsubmit={(e) => { e.preventDefault(); void editor.addComment(draftBody); }}>
					<p class="truncate text-[10.5px] text-muted">{editor.commentDraft?.anchor.name}</p>
					<!-- svelte-ignore a11y_autofocus -->
					<textarea class="min-h-16 resize-none rounded-[6px] bg-control px-2 py-1.5 outline-none placeholder:text-muted" placeholder={m.comment_placeholder()} bind:value={draftBody} autofocus
						onkeydown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void editor.addComment(draftBody); }
							if (e.key === 'Escape') editor.commentDraft = null;
						}}></textarea>
					<div class="flex justify-end gap-1">
						<button type="button" class="h-7 rounded-[6px] px-2 text-label hover:bg-control" onclick={() => (editor.commentDraft = null)}>{m.action_cancel()}</button>
						<button type="submit" class="h-7 rounded-[6px] bg-accent px-2.5 text-white disabled:opacity-50" disabled={!draftBody.trim()}>{m.comment_post()}</button>
					</div>
				</form>
			{/if}
			{#if measures.length}
				{#each measures as line, i (i)}
					{@const vertical = line.x1 === line.x2}
					<div class="absolute bg-[#f43f5e]"
						style="left:{Math.min(line.x1, line.x2)}px; top:{Math.min(line.y1, line.y2)}px;
							width:{vertical ? 'calc(1px * var(--inv))' : Math.abs(line.x2 - line.x1) + 'px'};
							height:{vertical ? Math.abs(line.y2 - line.y1) + 'px' : 'calc(1px * var(--inv))'};"></div>
					<span class="absolute rounded-[4px] bg-[#f43f5e] px-1 py-px text-[10px] font-medium whitespace-nowrap text-white tabular-nums"
						style="left:{(line.x1 + line.x2) / 2}px; top:{(line.y1 + line.y2) / 2}px; transform: translate(-50%, -50%) scale(var(--inv));">
						{line.value}
					</span>
				{/each}
			{/if}
			{#each handles as handle (handle.kind)}
				{@const active = handleDrag?.kind === handle.kind || handleHover === handle.kind}
				{@const b = handle.band}
				{#if active}
					<div class="absolute" style="left:{b.x}px; top:{b.y}px; width:{Math.max(b.width, 0)}px; height:{Math.max(b.height, 0)}px;
						background: repeating-linear-gradient(-45deg, rgba(244,63,94,.28) 0 calc(2px * var(--inv)), rgba(244,63,94,.08) 0 calc(6px * var(--inv)));"></div>
				{/if}
				<button
					type="button"
					class="pointer-events-auto absolute rounded-full bg-[#f43f5e] shadow-[0_0_0_calc(1px*var(--inv))_white]"
					style="left:{b.x + b.width / 2}px; top:{b.y + b.height / 2}px; transform: translate(-50%, -50%);
						width:calc({handle.vertical ? 4 : 16}px * var(--inv)); height:calc({handle.vertical ? 16 : 4}px * var(--inv));
						cursor:{handle.vertical ? 'ew-resize' : 'ns-resize'};"
					aria-label={handle.kind === 'gap' ? m.label_gap() : `${m.label_padding()} ${handle.kind}`}
					data-handle={handle.kind}
					onpointerdown={(e) => onhandledown(e, handle)}
					onpointerenter={() => (handleHover = handle.kind)}
					onpointerleave={() => (handleHover = null)}
				></button>
				{#if active}
					<span class="absolute rounded-[4px] bg-[#f43f5e] px-1 py-px text-[10px] font-medium text-white tabular-nums"
						style="left:{b.x + b.width / 2}px; top:{b.y + b.height / 2}px; transform: translate({handle.vertical ? '8px' : '-50%'}, {handle.vertical ? '-50%' : '6px'}) scale(var(--inv)); transform-origin: left top;">
						{handleDrag?.kind === handle.kind ? handleDrag.value : handle.value}
					</span>
				{/if}
			{/each}
			{#each resizeZones as zone (zone.kind)}
				<div
					class="pointer-events-auto absolute"
					style="left:{zone.box.x}px; top:{zone.box.y}px; width:{zone.box.width}px; height:{zone.box.height}px; cursor:{RESIZE_CURSOR[zone.kind]};"
					role="slider"
					tabindex="-1"
					aria-label={m.label_resize()}
					aria-valuenow={Math.round(styleTarget?.rect.width ?? 0)}
					data-resize={zone.kind}
					onpointerdown={(e) => onresizedown(e, zone.kind)}
					ondblclick={() => onresizedouble(zone.kind)}
				></div>
			{/each}
			{#if (drawing && dropPreview) || componentDrop}
				{@const target = (componentDrop ?? dropPreview)!}
				{@const p = target.parentRect}
				<div class="absolute" style="left:{p.x}px; top:{p.y}px; width:{p.width}px; height:{p.height}px; box-shadow: inset 0 0 0 calc(1px * var(--inv)) var(--cd-accent); background: var(--cd-accent-tint);"></div>
				{#if target.line}
					{@const l = target.line}
					{@const vertical = l.height > l.width}
					<div class="absolute bg-accent" style="left:{l.x}px; top:{l.y}px; width:{vertical ? 'calc(2px * var(--inv))' : l.width + 'px'}; height:{vertical ? l.height + 'px' : 'calc(2px * var(--inv))'};"></div>
				{/if}
			{/if}
			{#if dragging}
				{@const g = dragging.rect}
				{#if dragTarget}
					{@const p = dragTarget.parentRect}
					<div class="absolute" style="left:{p.x}px; top:{p.y}px; width:{p.width}px; height:{p.height}px; box-shadow: inset 0 0 0 calc(1px * var(--inv)) var(--cd-accent);"></div>
					{#if dragTarget.line}
						{@const l = dragTarget.line}
						{@const vertical = l.height > l.width}
						<div class="absolute bg-accent" style="left:{l.x}px; top:{l.y}px; width:{vertical ? 'calc(2px * var(--inv))' : l.width + 'px'}; height:{vertical ? l.height + 'px' : 'calc(2px * var(--inv))'};"></div>
					{/if}
				{/if}
				<div class="absolute opacity-80" style="left:{g.x + dragging.dx}px; top:{g.y + dragging.dy}px; width:{g.width}px; height:{g.height}px; box-shadow: inset 0 0 0 calc(1.5px * var(--inv)) var(--cd-accent); background: var(--cd-accent-tint);"></div>
			{/if}
			{#if drawBox && (drawBox.width > 2 || drawBox.height > 2)}
				<div class="absolute" style="left:{drawBox.x}px; top:{drawBox.y}px; width:{drawBox.width}px; height:{drawBox.height}px; box-shadow: inset 0 0 0 calc(1px * var(--inv)) var(--cd-accent); background: var(--cd-accent-tint);">
					<span class="absolute top-full left-1/2 rounded-[4px] bg-accent px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white tabular-nums"
						style="transform: translateX(-50%) scale(var(--inv)); transform-origin: top center; margin-top: calc(6px * var(--inv));">
						{Math.round(drawBox.width)} × {Math.round(drawBox.height)}
					</span>
				</div>
			{/if}
			{#if !isComponentCanvas && editor.focusRects[frameId]?.length}
				<svg class="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
					<path fill="rgba(0,0,0,0.4)" fill-rule="evenodd"
						d="M0 0H100000V100000H0Z {editor.focusRects[frameId].map((r) => `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}Z`).join(' ')}" />
				</svg>
			{/if}
			{#if designMode && !dragging}
				{#each Object.entries(editor.parentRects[frameId] ?? {}) as [id, rect] (id)}
					<div class="absolute" style="left:{rect.x}px; top:{rect.y}px; width:{rect.width}px; height:{rect.height}px;
						box-shadow: inset 0 0 0 calc(1px * var(--inv)) color-mix(in srgb, var(--cd-accent) 45%, transparent);"></div>
				{/each}
			{/if}
			{#if hoverRect && designMode && !Object.keys(selectedRects).includes(editor.hover?.id ?? '')}
				<div
					class="absolute"
					style="left:{hoverRect.x}px; top:{hoverRect.y}px; width:{hoverRect.width}px; height:{hoverRect.height}px;
						box-shadow: inset 0 0 0 calc(1px * var(--inv)) var(--cd-accent);"
				></div>
			{/if}
			{#each Object.entries(selectedRects) as [id, rect] (id)}
				{@const color = selectedComponent ? 'var(--cd-component)' : 'var(--cd-accent)'}
				<div
					class="absolute"
					style="left:{rect.x}px; top:{rect.y}px; width:{rect.width}px; height:{rect.height}px;
						box-shadow: inset 0 0 0 calc(1.5px * var(--inv)) {color};"
				>
					{#each ['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'] as corner (corner)}
						<span
							class="absolute bg-white {corner}"
							style="width:calc(7px * var(--inv)); height:calc(7px * var(--inv)); margin:calc(0.5px * var(--inv));
								box-shadow: 0 0 0 calc(1px * var(--inv)) {color}; translate: calc(-0px) 0;"
						></span>
					{/each}
					<span
						class="absolute top-full left-1/2 mt-1 origin-top rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap text-white tabular-nums"
						style="background:{color}; transform: translateX(-50%) scale(var(--inv)); margin-top: calc(6px * var(--inv));"
					>
						{resizing ? `${resizing.width} × ${resizing.height}` : `${Math.round(rect.width)} × ${Math.round(rect.height)}`}
					</span>
				</div>
			{/each}
		</div>

		{#if !url}
			<div class="absolute inset-0 z-30 flex items-center justify-center bg-white text-[14px] text-muted" style="font-size:calc(14px * var(--inv))">
				{m.frame_waiting_server()}
			</div>
		{:else if loadError}
			<div class="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-white p-8 text-center" style="font-size:calc(13px * var(--inv))">
				<TriangleAlert class="text-warning" style="width:calc(24px * var(--inv)); height:calc(24px * var(--inv))" />
				<p class="max-w-[80%] text-label">{loadError}</p>
				<button type="button" class="rounded-control bg-control px-3 py-1.5 hover:bg-control-hover" onclick={reload}>{m.action_retry()}</button>
			</div>
		{:else if !svelteDev && metadataTimedOut && isPrimary}
			<div class="absolute right-2 bottom-2 z-30 rounded-control bg-warning/90 px-2 py-1 text-white" style="font-size:calc(11px * var(--inv)); transform-origin: bottom right;">
				{m.frame_no_dev_metadata()}
			</div>
		{/if}
	</div>
</div>
