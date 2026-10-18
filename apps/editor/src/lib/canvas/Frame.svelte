<script lang="ts">
	import { onMount } from 'svelte';
	import type { Breakpoint, GuestToHost, NodeId } from '@codesigner/protocol';
	import { Play, Plus, RotateCw, TriangleAlert } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { BridgeClient } from './bridge-client';
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
	const designMode = $derived(editor.mode === 'design' && editor.effectiveTool === 'select');
	const selectedRects = $derived(editor.selectedRects[frameId] ?? {});
	const selectedComponent = $derived(editor.selected?.kind === 'instance');
	const hoverRect = $derived(editor.hoverRect?.frameId === frameId ? editor.hoverRect.rect : null);

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
				if (isPrimary) client?.send({ type: 'request-tree' });
				editor.syncHighlights();
				break;
			case 'tree':
				if (message.root?.children.length) svelteDev = true;
				editor.setTree(frameId, message.root);
				break;
			case 'rects':
				editor.setRects(frameId, message.hover, message.selected);
				break;
			case 'dom-changed':
				if (message.reason === 'hmr') {
					client?.send({ type: 'clear-preview' });
					editor.onHmr();
					void editor.reresolveSelection();
				}
				if (isPrimary) client?.send({ type: 'request-tree' });
				break;
			case 'navigated':
				editor.onFrameNavigated(frameId, message.url, message.title);
				if (isPrimary) client?.send({ type: 'request-tree' });
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
		if (!client || !designMode) return;
		const seq = ++hoverSeq;
		const { x, y } = toGuest(event);
		const path = await client.hit(x, y);
		if (seq !== hoverSeq) return;
		lastHit = path;
		const id = editor.pick(path, event.metaKey || event.ctrlKey ? 'deep' : 'click');
		editor.setHover(frameId, id);
	}

	function onpointerleave() {
		hoverSeq++;
		editor.setHover(frameId, null);
	}

	async function onclick(event: MouseEvent) {
		if (!client || !designMode) return;
		const { x, y } = toGuest(event);
		const path = await client.hit(x, y);
		lastHit = path;
		const gesture = event.metaKey || event.ctrlKey ? 'deep' : event.detail >= 2 ? 'double' : 'click';
		await editor.selectFromHit(frameId, path, gesture, event.shiftKey);
	}

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

	const label = $derived(
		breakpoint.id === 'desktop' ? m.breakpoint_desktop() : breakpoint.id === 'tablet' ? m.breakpoint_tablet() : breakpoint.id === 'phone' ? m.breakpoint_phone() : breakpoint.name
	);
</script>

<div
	class="absolute top-0 left-0 origin-top-left"
	style="width:{breakpoint.width}px; height:{breakpoint.height}px; --inv:{1 / scale};
		transform: translate({editor.camera.x + x * scale}px, {editor.camera.y}px) scale({scale});"
>
	<!-- Breakpoint label pill, kept at a constant on-screen size -->
	<div
		class="absolute bottom-full left-0 origin-bottom-left pb-2"
		style="width:{breakpoint.width * scale}px; transform: scale({1 / scale});"
	>
		<div
			class="flex h-7 items-center gap-2 rounded-[10px] px-1 text-[12px]
				{editor.activeFrameId === frameId ? 'bg-accent-tint text-accent' : 'bg-black/[0.04] text-label dark:bg-white/[0.05]'}"
		>
			<button
				type="button"
				class="flex size-5 items-center justify-center rounded-[4px] hover:bg-black/5"
				aria-label={m.frame_preview()}
				title={m.frame_preview()}
				onclick={() => url && window.open(url)}
			>
				<Play class="size-3" />
			</button>
			<button type="button" class="flex min-w-0 items-center gap-2" onclick={() => (editor.activeFrameId = frameId)}>
				<span class="font-semibold {editor.activeFrameId === frameId ? 'text-accent' : 'text-fg'}">{label}</span>
				<span class="tabular-nums">{breakpoint.width}</span>
				{#if isPrimary}<span class="text-muted">{m.frame_primary()}</span>{/if}
			</button>
			<span class="flex-1"></span>
			{#if loading && !loadError}
				<span class="size-1.5 animate-pulse rounded-full bg-accent"></span>
			{/if}
			<button
				type="button"
				class="flex size-5 items-center justify-center rounded-[4px] hover:bg-black/5"
				aria-label={m.frame_reload()}
				title={m.frame_reload()}
				onclick={reload}
			>
				<RotateCw class="size-3" />
			</button>
			<button
				type="button"
				class="flex size-5 items-center justify-center rounded-[5px] hover:bg-black/5"
				aria-label={m.frame_add_breakpoint()}
				title={m.frame_add_breakpoint()}
			>
				<Plus class="size-3" />
			</button>
		</div>
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
			style="pointer-events:{designMode ? 'auto' : 'none'}; cursor:{designMode ? 'default' : 'auto'}"
			role="presentation"
			{onpointermove}
			{onpointerleave}
			{onclick}
			{onwheel}
			{oncontextmenu}
		></div>

		<!-- Overlays -->
		<div class="pointer-events-none absolute inset-0 z-20">
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
						{Math.round(rect.width)} × {Math.round(rect.height)}
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
