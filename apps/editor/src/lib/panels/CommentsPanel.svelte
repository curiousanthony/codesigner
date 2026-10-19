<script lang="ts">
	import { MessageCircle, CircleCheck } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { m } from '#lib/paraglide/messages.js';

	const visible = $derived(editor.comments.filter((c) => editor.showResolved || !c.resolved));
	/** Current page first, then the others by page. */
	const groups = $derived.by(() => {
		const map = new Map<string, typeof visible>();
		for (const c of visible) map.set(c.path, [...(map.get(c.path) ?? []), c]);
		return [...map.entries()].sort(([a], [b]) => (a === editor.pagePath ? -1 : b === editor.pagePath ? 1 : a.localeCompare(b)));
	});
	const unresolved = $derived(editor.comments.filter((c) => !c.resolved));
	/** Pins whose element can't be found on the page any more. */
	const outdated = (id: string) => Object.values(editor.pinRects).some((rects) => id in rects && rects[id] === null) && !Object.values(editor.pinRects).some((rects) => rects[id]);
</script>

<div class="flex flex-col">
	<div class="flex items-center gap-2 border-b border-divider px-4 py-2.5">
		<label class="flex flex-1 items-center gap-2 text-[11px] text-label">
			<input type="checkbox" bind:checked={editor.showResolved} onchange={() => editor.syncAnchors()} />
			{m.comment_show_resolved()}
		</label>
		<button type="button" class="h-7 rounded-[6px] bg-control px-2 text-[11px] hover:bg-control-hover disabled:opacity-50" disabled={!unresolved.length}
			title={m.comment_copy_all_hint()} onclick={() => editor.copyForAgent(unresolved)}>
			{m.comment_copy_all({ count: unresolved.length })}
		</button>
	</div>
	{#if editor.tool !== 'comment'}
		<button type="button" class="mx-3 mt-3 rounded-control bg-accent-tint px-2.5 py-2 text-left text-[11px] text-accent" onclick={() => editor.setTool('comment')}>{m.comment_mode_hint()}</button>
	{/if}
	{#each groups as [path, list] (path)}
		<p class="px-4 pt-3 pb-1 text-[11px] font-medium text-muted">{path === editor.pagePath ? m.comment_this_page() : path}</p>
		{#each list as comment (comment.id)}
			<button type="button" class="mx-1.5 flex flex-col gap-0.5 rounded-control px-2.5 py-2 text-left hover:bg-row-hover {editor.openComment === comment.id ? 'bg-accent-tint' : ''}"
				onclick={() => editor.showComment(comment.id)}>
				<span class="flex items-center gap-1.5 text-[11px]">
					{#if comment.resolved}<CircleCheck class="size-3 text-success" />{/if}
					<span class="font-semibold text-fg-strong">{comment.messages[0]?.author}</span>
					<span class="truncate text-muted">· {comment.anchor.name}</span>
					{#if outdated(comment.id)}<span class="ml-auto shrink-0 rounded bg-warning/15 px-1 text-[10px] text-warning" title={m.comment_outdated_hint()}>{m.comment_outdated()}</span>{/if}
				</span>
				<span class="line-clamp-2 text-[12px] text-fg">{comment.messages[0]?.body}</span>
				{#if comment.messages.length > 1}<span class="text-[10.5px] text-muted">{m.comment_replies({ count: comment.messages.length - 1 })}</span>{/if}
			</button>
		{/each}
	{:else}
		<div class="flex flex-col items-center gap-2 px-6 py-12 text-center text-muted">
			<MessageCircle class="size-5" />
			<p>{m.comment_empty()}</p>
		</div>
	{/each}
</div>
