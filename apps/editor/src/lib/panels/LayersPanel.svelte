<script lang="ts">
	import type { Breakpoint, LayerNode } from '@codesigner/protocol';
	import { ChevronRight, Code, Layers, Monitor, Search, Smartphone, Tablet } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { invoke } from '#lib/api.js';
	import { breakpointLabel } from '#lib/canvas/breakpoints.js';
	import LayerIcon from './LayerIcon.svelte';
	import { m } from '#lib/paraglide/messages.js';

	let query = $state('');

	type Row =
		| { type: 'frame'; key: string; bp: Breakpoint; open: boolean; empty: boolean }
		| { type: 'layer'; key: string; frameId: string; node: LayerNode; depth: number; path: string[]; underSelection: boolean };

	// Framer: each breakpoint is a top-level layer; only the primary one starts expanded.
	const frameOpen = (bp: Breakpoint) => editor.expanded[`${bp.id}:@frame`] ?? !!bp.primary;

	/** Ids highlighted in a frame's tree: the selection itself, or its mirror in the other breakpoints. */
	const highlighted = (frameId: string): Set<string> =>
		new Set(editor.selection.frameId === frameId ? editor.selection.ids : (editor.mirrors[frameId] ?? []));

	const rows = $derived.by(() => {
		const out: Row[] = [];
		const q = query.trim().toLowerCase();
		const matches = (node: LayerNode): boolean =>
			node.name.toLowerCase().includes(q) || node.tag.includes(q) || node.children.some(matches);
		for (const bp of editor.breakpoints) {
			const tree = editor.trees[bp.id];
			const selected = highlighted(bp.id);
			const visible = tree ? tree.children.filter((c) => !q || matches(c)) : [];
			if (q && visible.length === 0) continue;
			const open = q ? true : frameOpen(bp);
			out.push({ type: 'frame', key: `${bp.id}:@frame`, bp, open, empty: !tree || tree.children.length === 0 });
			if (!open || !tree) continue;
			const walk = (node: LayerNode, depth: number, path: string[], underSelection: boolean) => {
				for (const child of node.children) {
					if (q && !matches(child)) continue;
					const childPath = [...path, child.id];
					out.push({ type: 'layer', key: `${bp.id}:${child.id}`, frameId: bp.id, node: child, depth, path: childPath, underSelection });
					const childOpen = q ? true : editor.isExpanded(bp.id, child.id);
					if (childOpen && child.children.length) walk(child, depth + 1, childPath, underSelection || selected.has(child.id));
				}
			};
			walk(tree, 1, [], false);
		}
		return out;
	});

	const anyTree = $derived(Object.values(editor.trees).some(Boolean));

	function toggleFrame(bp: Breakpoint) {
		editor.expanded = { ...editor.expanded, [`${bp.id}:@frame`]: !frameOpen(bp) };
	}

	function toggle(frameId: string, id: string, event?: MouseEvent) {
		const open = !editor.isExpanded(frameId, id);
		const ids = [id];
		if (event?.altKey) {
			const node = editor.findNode(id, frameId);
			const walk = (n: LayerNode) => n.children.forEach((c) => (ids.push(c.id), walk(c)));
			if (node) walk(node);
		}
		editor.setExpanded(frameId, ids, open);
	}

	function selectFrame(bp: Breakpoint) {
		editor.clearSelection();
		editor.activeFrameId = bp.id;
	}

	function select(row: Extract<Row, { type: 'layer' }>, event: MouseEvent) {
		const { frameId, node, path } = row;
		const sameFrame = editor.selection.frameId === frameId;
		if ((event.shiftKey || event.metaKey) && sameFrame) {
			const has = editor.selection.ids.includes(node.id);
			const ids = has ? editor.selection.ids.filter((id) => id !== node.id) : [...editor.selection.ids, node.id];
			void editor.select(frameId, ids, { ...editor.selection.paths, [node.id]: path });
		} else {
			void editor.select(frameId, [node.id], { [node.id]: path });
		}
	}

	function openInCode(node: LayerNode) {
		if (!node.loc || !editor.worktree) return;
		void invoke('project:open-in-editor', `${editor.worktree}/${node.loc.file}`, node.loc.line, node.loc.column);
	}

	const frameIcon = (bp: Breakpoint) => (bp.width < 600 ? Smartphone : bp.width < 1024 ? Tablet : Monitor);
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="px-2.5 pb-2">
		<label class="flex h-[30px] items-center gap-2 rounded-control bg-control px-2.5 text-muted">
			<Search class="size-3.5 shrink-0" />
			<input class="w-full bg-transparent text-fg outline-none placeholder:text-muted" placeholder={m.search_placeholder()} bind:value={query} />
		</label>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4" role="tree" aria-label={m.tab_layers()}>
		{#if !anyTree}
			<div class="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted">
				<Layers class="size-5" />
				<p>{editor.devServer?.status === 'ready' ? m.layers_loading() : m.layers_waiting()}</p>
			</div>
		{:else if rows.length === 0}
			<p class="px-2 py-6 text-center text-muted">{m.layers_no_match()}</p>
		{/if}
		{#each rows as row (row.key)}
			{#if row.type === 'frame'}
				{@const FrameIcon = frameIcon(row.bp)}
				{@const active = editor.activeFrameId === row.bp.id && editor.selection.ids.length === 0}
				<div
					class="group flex h-[30px] items-center gap-1.5 rounded-control pr-1.5 pl-1.5
						{active ? 'bg-accent text-white' : editor.activeFrameId === row.bp.id ? 'bg-accent-tint' : 'hover:bg-row-hover'}"
					role="treeitem"
					aria-selected={active}
					aria-expanded={row.open}
					tabindex="-1"
					onclick={() => selectFrame(row.bp)}
					onkeydown={() => {}}
				>
					<button
						type="button"
						class="flex size-3.5 shrink-0 items-center justify-center {row.empty ? 'invisible' : ''}"
						aria-label={m.layers_toggle()}
						onclick={(e) => {
							e.stopPropagation();
							toggleFrame(row.bp);
						}}
					>
						<ChevronRight class="size-3 transition-transform {row.open ? 'rotate-90' : ''} {active ? 'text-white/80' : 'text-muted'}" />
					</button>
					<FrameIcon class="size-3 shrink-0 {active ? 'text-white' : 'text-label'}" strokeWidth={1.75} />
					<span class="min-w-0 flex-1 truncate font-medium">{breakpointLabel(row.bp)}</span>
					<span class="shrink-0 tabular-nums {active ? 'text-white/70' : 'text-muted'}">{row.bp.width}</span>
				</div>
			{:else}
				{@const node = row.node}
				{@const selected = highlighted(row.frameId).has(node.id)}
				{@const primarySelection = selected && editor.selection.frameId === row.frameId}
				{@const hovered = editor.hover?.frameId === row.frameId && editor.hover.id === node.id}
				{@const open = editor.isExpanded(row.frameId, node.id) || !!query}
				<div
					class="group relative flex h-[30px] items-center gap-1.5 rounded-control pr-1.5
						{primarySelection
						? node.isInstance
							? 'bg-component text-white'
							: 'bg-accent text-white'
						: selected
							? node.isInstance
								? 'bg-component-tint'
								: 'bg-accent-tint'
							: row.underSelection
								? 'bg-accent-tint/50'
								: hovered
									? 'bg-row-hover'
									: 'hover:bg-row-hover'}
						{node.hidden ? 'opacity-50' : ''}"
					style="padding-left:{6 + row.depth * 14}px"
					role="treeitem"
					aria-selected={selected}
					aria-expanded={node.children.length ? open : undefined}
					tabindex="-1"
					data-frame={row.frameId}
					onclick={(e) => select(row, e)}
					onkeydown={() => {}}
					onmouseenter={() => editor.setHover(row.frameId, node.id)}
					onmouseleave={() => editor.setHover(row.frameId, null)}
				>
					<button
						type="button"
						class="flex size-3.5 shrink-0 items-center justify-center {node.children.length ? '' : 'invisible'}"
						aria-label={m.layers_toggle()}
						onclick={(e) => {
							e.stopPropagation();
							toggle(row.frameId, node.id, e);
						}}
					>
						<ChevronRight class="size-3 transition-transform {open ? 'rotate-90' : ''} {primarySelection ? 'text-white/80' : 'text-muted'}" />
					</button>
					<span class="shrink-0 {primarySelection ? 'text-white' : node.isInstance ? 'text-component' : 'text-label'}">
						<LayerIcon kind={node.kind} />
					</span>
					<span class="min-w-0 flex-1 truncate {node.isInstance && !primarySelection ? 'text-component' : ''}">{node.name}</span>
					{#if node.repeatCount > 1}
						<span
							class="shrink-0 rounded px-1 text-[10px] tabular-nums {primarySelection ? 'bg-white/20' : 'bg-control text-label'}"
							title={m.layers_repeated({ count: node.repeatCount })}
						>
							×{node.repeatCount}
						</span>
					{/if}
					{#if node.loc}
						<button
							type="button"
							class="hidden size-5 shrink-0 items-center justify-center rounded group-hover:flex {primarySelection ? 'hover:bg-white/20' : 'hover:bg-control'}"
							title={m.action_open_in_code()}
							aria-label={m.action_open_in_code()}
							onclick={(e) => {
								e.stopPropagation();
								openInCode(node);
							}}
						>
							<Code class="size-3" />
						</button>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
</div>
