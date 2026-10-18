<script lang="ts">
	import type { LayerNode } from '@codesigner/protocol';
	import { ChevronRight, Code, Search, Layers } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { invoke } from '#lib/api.js';
	import LayerIcon from './LayerIcon.svelte';
	import { m } from '#lib/paraglide/messages.js';

	let query = $state('');

	type Row = { node: LayerNode; depth: number; path: string[]; underSelection: boolean };

	const selectedIds = $derived(new Set(editor.selection.frameId === editor.primaryFrameId ? editor.selection.ids : []));

	const rows = $derived.by(() => {
		const out: Row[] = [];
		const q = query.trim().toLowerCase();
		const matches = (node: LayerNode): boolean =>
			node.name.toLowerCase().includes(q) || node.tag.includes(q) || node.children.some(matches);
		const walk = (node: LayerNode, depth: number, path: string[], underSelection: boolean) => {
			for (const child of node.children) {
				if (q && !matches(child)) continue;
				const childPath = [...path, child.id];
				out.push({ node: child, depth, path: childPath, underSelection });
				const open = q ? true : editor.expanded[child.id];
				if (open && child.children.length) walk(child, depth + 1, childPath, underSelection || selectedIds.has(child.id));
			}
		};
		if (editor.tree) walk(editor.tree, 0, [], false);
		return out;
	});

	function toggle(id: string, event?: MouseEvent) {
		const open = !editor.expanded[id];
		const next = { ...editor.expanded, [id]: open };
		if (event?.altKey) {
			const node = editor.findNode(id);
			const walk = (n: LayerNode) => n.children.forEach((c) => ((next[c.id] = open), walk(c)));
			if (node) walk(node);
		}
		editor.expanded = next;
	}

	function select(row: Row, event: MouseEvent) {
		const frameId = editor.primaryFrameId;
		if (!frameId) return;
		if (event.shiftKey || event.metaKey) {
			const ids = selectedIds.has(row.node.id)
				? editor.selection.ids.filter((id) => id !== row.node.id)
				: [...editor.selection.ids, row.node.id];
			void editor.select(frameId, ids, { ...editor.selection.paths, [row.node.id]: row.path });
		} else {
			void editor.select(frameId, [row.node.id], { [row.node.id]: row.path });
		}
	}

	function openInCode(node: LayerNode) {
		if (!node.loc || !editor.worktree) return;
		void invoke('project:open-in-editor', `${editor.worktree}/${node.loc.file}`, node.loc.line, node.loc.column);
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="px-2.5 pb-2">
		<label class="flex h-[30px] items-center gap-2 rounded-control bg-control px-2.5 text-muted">
			<Search class="size-3.5 shrink-0" />
			<input class="w-full bg-transparent text-fg outline-none placeholder:text-muted" placeholder={m.search_placeholder()} bind:value={query} />
		</label>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4" role="tree" aria-label={m.tab_layers()}>
		{#if !editor.tree}
			<div class="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted">
				<Layers class="size-5" />
				<p>{editor.devServer?.status === 'ready' ? m.layers_loading() : m.layers_waiting()}</p>
			</div>
		{:else if rows.length === 0}
			<p class="px-2 py-6 text-center text-muted">{query ? m.layers_no_match() : m.layers_empty()}</p>
		{/if}
		{#each rows as row (row.node.id)}
			{@const node = row.node}
			{@const selected = selectedIds.has(node.id)}
			{@const hovered = editor.hover?.id === node.id}
			<div
				class="group relative flex h-[30px] items-center gap-1.5 rounded-control pr-1.5
					{selected ? (node.isInstance ? 'bg-component text-white' : 'bg-accent text-white') : row.underSelection ? 'bg-accent-tint' : hovered ? 'bg-row-hover' : 'hover:bg-row-hover'}
					{node.hidden ? 'opacity-50' : ''}"
				style="padding-left:{6 + row.depth * 14}px"
				role="treeitem"
				aria-selected={selected}
				aria-expanded={node.children.length ? !!editor.expanded[node.id] : undefined}
				tabindex="-1"
				onclick={(e) => select(row, e)}
				onkeydown={() => {}}
				onmouseenter={() => editor.primaryFrameId && editor.setHover(editor.primaryFrameId, node.id)}
				onmouseleave={() => editor.primaryFrameId && editor.setHover(editor.primaryFrameId, null)}
			>
				<button
					type="button"
					class="flex size-3.5 shrink-0 items-center justify-center {node.children.length ? '' : 'invisible'}"
					aria-label={m.layers_toggle()}
					onclick={(e) => {
						e.stopPropagation();
						toggle(node.id, e);
					}}
				>
					<ChevronRight class="size-3 transition-transform {editor.expanded[node.id] || query ? 'rotate-90' : ''} {selected ? 'text-white/80' : 'text-muted'}" />
				</button>
				<span class="shrink-0 {selected ? 'text-white' : node.isInstance ? 'text-component' : 'text-label'}">
					<LayerIcon kind={node.kind} />
				</span>
				<span class="min-w-0 flex-1 truncate {node.isInstance && !selected ? 'text-component' : ''}">{node.name}</span>
				{#if node.repeatCount > 1}
					<span class="shrink-0 rounded px-1 text-[10px] tabular-nums {selected ? 'bg-white/20' : 'bg-control text-label'}" title={m.layers_repeated({ count: node.repeatCount })}>
						×{node.repeatCount}
					</span>
				{/if}
				{#if node.loc}
					<button
						type="button"
						class="hidden size-5 shrink-0 items-center justify-center rounded group-hover:flex {selected ? 'hover:bg-white/20' : 'hover:bg-control'}"
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
		{/each}
	</div>
</div>
