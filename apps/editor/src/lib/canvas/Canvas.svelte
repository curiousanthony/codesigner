<script lang="ts">
	import { editor } from '#lib/state/editor.svelte.js';
	import Frame from './Frame.svelte';
	import Dock from './Dock.svelte';
	import { m } from '#lib/paraglide/messages.js';

	const GAP = 120;
	let viewport: HTMLDivElement;
	let frames: Record<string, Frame> = $state({});

	const layout = $derived.by(() => {
		let x = 0;
		return editor.breakpoints.map((bp) => {
			const item = { bp, x };
			x += bp.width + GAP;
			return item;
		});
	});

	const worldWidth = $derived(layout.length ? layout.at(-1)!.x + layout.at(-1)!.bp.width : 0);
	const worldHeight = $derived(Math.max(0, ...editor.breakpoints.map((b) => b.height)));
	const url = $derived(editor.frameUrl());

	const MIN = 0.05;
	const MAX = 4;

	function zoomAt(factor: number, cx: number, cy: number) {
		const { x, y, scale } = editor.camera;
		const next = Math.min(MAX, Math.max(MIN, scale * factor));
		const k = next / scale;
		editor.camera = { scale: next, x: cx - (cx - x) * k, y: cy - (cy - y) * k };
	}

	function center() {
		const r = viewport.getBoundingClientRect();
		return { cx: r.width / 2, cy: r.height / 2 };
	}

	export function zoomIn() {
		const { cx, cy } = center();
		zoomAt(1.25, cx, cy);
	}

	export function zoomOut() {
		const { cx, cy } = center();
		zoomAt(0.8, cx, cy);
	}

	export function zoomTo(scale: number) {
		const { cx, cy } = center();
		zoomAt(scale / editor.camera.scale, cx, cy);
	}

	function fitRect(x: number, y: number, width: number, height: number, padding = 80) {
		const r = viewport.getBoundingClientRect();
		const scale = Math.min(MAX, Math.max(MIN, Math.min((r.width - padding * 2) / width, (r.height - padding * 2) / height)));
		editor.camera = { scale, x: (r.width - width * scale) / 2 - x * scale, y: (r.height - height * scale) / 2 - y * scale };
	}

	export function zoomToFit() {
		if (!worldWidth) return;
		fitRect(0, -40, worldWidth, worldHeight + 40);
	}

	export function zoomToSelection() {
		const frameId = editor.selection.frameId;
		const rects = frameId ? Object.values(editor.selectedRects[frameId] ?? {}) : [];
		const offset = layout.find((l) => l.bp.id === frameId)?.x ?? 0;
		if (!rects.length) return zoomToFit();
		const x1 = Math.min(...rects.map((r) => r.x));
		const y1 = Math.min(...rects.map((r) => r.y));
		const x2 = Math.max(...rects.map((r) => r.x + r.width));
		const y2 = Math.max(...rects.map((r) => r.y + r.height));
		fitRect(offset + x1, y1, Math.max(40, x2 - x1), Math.max(40, y2 - y1), 120);
	}

	export function reloadFrames() {
		for (const frame of Object.values(frames)) frame?.reload();
	}

	export function openFrameDevTools() {
		const id = editor.activeFrameId ?? editor.primaryFrameId;
		if (id) frames[id]?.openDevTools();
	}

	function onwheel(event: WheelEvent) {
		event.preventDefault();
		const r = viewport.getBoundingClientRect();
		if (event.ctrlKey || event.metaKey) {
			// Trackpad pinch arrives as ctrl+wheel.
			const factor = Math.exp(-event.deltaY * (event.ctrlKey && !event.metaKey ? 0.01 : 0.003));
			zoomAt(factor, event.clientX - r.left, event.clientY - r.top);
		} else {
			editor.camera = { ...editor.camera, x: editor.camera.x - event.deltaX, y: editor.camera.y - event.deltaY };
		}
	}

	let pan: { x: number; y: number; cx: number; cy: number } | null = $state(null);
	function onpointerdown(event: PointerEvent) {
		const handTool = editor.effectiveTool === 'hand' || event.button === 1;
		if (handTool) {
			event.preventDefault();
			pan = { x: event.clientX, y: event.clientY, cx: editor.camera.x, cy: editor.camera.y };
			(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		} else if (event.target === viewport || (event.target as HTMLElement).dataset.world !== undefined) {
			editor.clearSelection();
		}
	}
	function onpointermove(event: PointerEvent) {
		if (!pan) return;
		editor.camera = { ...editor.camera, x: pan.cx + event.clientX - pan.x, y: pan.cy + event.clientY - pan.y };
	}
	function onpointerup() {
		pan = null;
	}

	// Fit once the frames are known, and again whenever breakpoints are added, removed or resized.
	let fittedFor = '';
	$effect(() => {
		const signature = editor.breakpoints.map((b) => `${b.id}:${b.width}`).join(',');
		if (worldWidth && viewport && signature !== fittedFor) {
			fittedFor = signature;
			requestAnimationFrame(zoomToFit);
		}
	});
</script>

<div
	bind:this={viewport}
	class="relative h-full w-full overflow-hidden bg-canvas"
	style="cursor:{pan ? 'grabbing' : editor.effectiveTool === 'hand' ? 'grab' : 'default'}"
	role="application"
	aria-label={m.canvas_label()}
	{onwheel}
	{onpointerdown}
	{onpointermove}
	{onpointerup}
>
	<!--
		Each frame carries its own translate+scale: Electron mispositions <webview>
		surfaces that sit at an offset inside a scaled ancestor, so no webview may
		be offset within a transformed parent.
	-->
	<div data-world class="absolute inset-0">
		{#each layout as item (item.bp.id)}
			<Frame bind:this={frames[item.bp.id]} breakpoint={item.bp} x={item.x} {url} />
		{/each}
	</div>

	<!-- While panning with the hand tool, a shield keeps webviews from swallowing pointer events. -->
	{#if editor.effectiveTool === 'hand'}
		<div class="absolute inset-0 z-30" style="cursor:{pan ? 'grabbing' : 'grab'}" role="presentation"></div>
	{/if}

	<Dock {zoomIn} {zoomOut} {zoomTo} {zoomToFit} {zoomToSelection} />
</div>
