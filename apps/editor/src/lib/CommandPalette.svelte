<script lang="ts">
	import type { Component as ComponentType } from 'svelte';
	import { ArrowRight, Component, File, House, Search, Sparkles } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { routeLabel } from '#lib/state/routes.js';
	import { insertComponentHere } from '#lib/state/commands.js';
	import { m } from '#lib/paraglide/messages.js';

	type Props = { run: (command: string) => void; onclose: () => void };
	let { run, onclose }: Props = $props();

	type Item = { id: string; group: string; label: string; hint?: string; shortcut?: string; icon: ComponentType; action: () => void };

	let query = $state('');
	let active = $state(0);
	let list = $state<HTMLDivElement | null>(null);

	const selected = $derived(editor.selection.ids.length > 0);
	const actions = $derived<Item[]>(
		(
			[
				['tool-stack', m.cmdk_stack(), 'S'],
				['tool-frame', m.cmdk_frame(), 'F'],
				['tool-grid', m.cmdk_grid(), '⇧G'],
				['tool-text', m.cmdk_text(), 'T'],
				['tool-comment', m.cmdk_comment(), 'C'],
				...(selected
					? [
							['wrap-stack', m.wrap_stack(), '⇧A'],
							['wrap-frame', m.wrap_frame(), '⌘↵'],
							['duplicate', m.cmdk_duplicate(), '⌘D'],
							['create-component', m.cmdk_create_component(), '⌥⌘K'],
							['copy-style', m.cmdk_copy_style(), '⌥⌘C'],
							['paste-style', m.cmdk_paste_style(), '⌥⌘V'],
							['zoom-selection', m.zoom_selection(), '⌘2']
						]
					: []),
				['undo', m.cmdk_undo(), '⌘Z'],
				['redo', m.cmdk_redo(), '⇧⌘Z'],
				['zoom-fit', m.zoom_fit(), '⌘1'],
				['zoom-reset', m.cmdk_zoom_100(), '⌘0'],
				['toggle-code', m.code_panel(), '⌘J'],
				['toggle-interact', m.cmdk_interact(), '⌘E'],
				['version-history', m.history_title(), '⇧⌘H'],
				['new-branch', m.branch_new(), '⇧⌘B'],
				['open-in-editor', m.action_open_in_code(), '⇧⌘O']
			] as [string, string, string][]
		).map(([id, label, shortcut]) => ({ id, group: m.cmdk_actions(), label, shortcut, icon: Sparkles, action: () => run(id) }))
	);
	const pages = $derived<Item[]>(
		editor.inPlace || editor.editingComponent
			? []
			: editor.routes
					.filter((r) => !r.isLayoutOnly)
					.map((r) => ({ id: `page:${r.id}`, group: m.pages_title(), label: routeLabel(r), icon: r.pattern === '/' ? House : File, action: () => editor.openRoute(r) }))
	);
	const components = $derived<Item[]>(
		editor.editingComponent
			? []
			: editor.components.map((c) => ({
					id: `component:${c.file}:${c.name}`,
					group: m.cmdk_insert(),
					label: c.name,
					hint: c.file.replace(/^src\/lib\/components\//, '').replace(/\/[^/]+$/, ''),
					icon: Component,
					action: () => void insertComponentHere(c)
				}))
	);

	/** Letters in order (fuzzy), best when they start words: "vh" finds "Version history". */
	function score(label: string, q: string): number {
		if (!q) return 1;
		const text = label.toLowerCase();
		if (text.startsWith(q)) return 100;
		if (text.includes(q)) return 50;
		let at = 0;
		let points = 1;
		for (const ch of q) {
			const next = text.indexOf(ch, at);
			if (next < 0) return 0;
			if (next === 0 || /[\s/.-]/.test(text[next - 1])) points += 5;
			at = next + 1;
		}
		return points;
	}
	const results = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const all = [...actions, ...pages, ...components];
		if (!q) return [...actions.slice(0, 8), ...pages.slice(0, 6), ...components.slice(0, 6)];
		return all
			.map((item) => ({ item, s: score(item.label, q) }))
			.filter((r) => r.s > 0)
			.sort((a, b) => b.s - a.s)
			.slice(0, 40)
			.map((r) => r.item);
	});
	$effect(() => {
		void query;
		active = 0;
	});

	function choose(item: Item | undefined) {
		if (!item) return;
		onclose();
		item.action();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') return void (event.preventDefault(), onclose());
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(results.length, 1);
			list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
		} else if (event.key === 'Enter') {
			event.preventDefault();
			choose(results[active]);
		}
	}
</script>

<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-24" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
	<div class="flex max-h-[60vh] w-[520px] flex-col overflow-hidden rounded-popover bg-popover shadow-popover" role="dialog" aria-modal="true" aria-label={m.cmdk_title()}>
		<label class="flex h-11 shrink-0 items-center gap-2.5 border-b border-divider px-3.5">
			<Search class="size-4 shrink-0 text-muted" />
			<!-- svelte-ignore a11y_autofocus -->
			<input class="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted" placeholder={m.cmdk_placeholder()} bind:value={query} {onkeydown} autofocus
				role="combobox" aria-expanded="true" aria-controls="cmdk-list" aria-activedescendant={`cmdk-${active}`} />
			<kbd class="rounded-[4px] bg-control px-1.5 py-0.5 text-[10px] text-muted">esc</kbd>
		</label>
		<div id="cmdk-list" class="min-h-0 overflow-y-auto p-1.5" role="listbox" bind:this={list}>
			{#each results as item, i (item.id)}
				{#if i === 0 || results[i - 1].group !== item.group}
					<p class="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted uppercase">{item.group}</p>
				{/if}
				<button
					type="button"
					id={`cmdk-${i}`}
					data-index={i}
					role="option"
					aria-selected={i === active}
					class="flex h-8 w-full items-center gap-2.5 rounded-[6px] px-2 text-left {i === active ? 'bg-accent text-white' : 'text-fg'}"
					onpointermove={() => (active = i)}
					onclick={() => choose(item)}
				>
					<item.icon class="size-3.5 shrink-0 {i === active ? 'text-white' : item.icon === Component ? 'text-component' : 'text-label'}" />
					<span class="min-w-0 flex-1 truncate">{item.label}</span>
					{#if item.hint}<span class="truncate text-[11px] {i === active ? 'text-white/70' : 'text-muted'}">{item.hint}</span>{/if}
					{#if item.shortcut}<span class="text-[11px] tabular-nums {i === active ? 'text-white/80' : 'text-muted'}">{item.shortcut}</span>{/if}
					{#if i === active && !item.shortcut}<ArrowRight class="size-3.5 shrink-0" />{/if}
				</button>
			{:else}
				<p class="px-3 py-6 text-center text-muted">{m.cmdk_empty()}</p>
			{/each}
		</div>
	</div>
</div>
