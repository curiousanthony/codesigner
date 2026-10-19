<script lang="ts">
	import type { RouteInfo } from '@codesigner/protocol';
	import { Check, ChevronDown, File, FileCode2, House } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { routeLabel } from '#lib/state/routes.js';
	import { m } from '#lib/paraglide/messages.js';

	/** Framer's page switcher at the top of the Layers panel (the Pages tab stays the full list). */
	let open = $state(false);
	const pages = $derived(editor.routes.filter((r) => !r.isLayoutOnly));
	const current = $derived(editor.currentRoute);
	// The component canvas and in-place editing are about one component, not a page.
	const locked = $derived(!!editor.editingComponent || editor.inPlace);

	function pick(route: RouteInfo) {
		open = false;
		editor.openRoute(route);
	}
</script>

<div class="relative px-2.5 pb-1.5">
	<button
		type="button"
		class="flex h-[30px] w-full items-center gap-2 rounded-control px-2 text-left hover:bg-control disabled:opacity-50 disabled:hover:bg-transparent"
		disabled={locked || pages.length === 0}
		aria-haspopup="listbox"
		aria-expanded={open}
		aria-label={m.pages_switch()}
		onclick={() => (open = !open)}
	>
		<span class="min-w-0 flex-1 truncate font-semibold text-fg-strong">{current ? routeLabel(current) : editor.currentPath}</span>
		<ChevronDown class="size-3.5 shrink-0 text-label" />
	</button>
	{#if open}
		<button type="button" class="fixed inset-0 z-40 cursor-default" aria-label={m.action_close()} onclick={() => (open = false)}></button>
		<div class="absolute top-full right-2.5 left-2.5 z-50 max-h-[60vh] overflow-y-auto rounded-popover bg-popover p-1 shadow-popover" role="listbox" aria-label={m.pages_title()}>
			{#each pages as route (route.id)}
				{@const active = current?.id === route.id}
				<button type="button" role="option" aria-selected={active} class="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left hover:bg-control" onclick={() => pick(route)}>
					{#if route.pattern === '/'}<House class="size-3.5 shrink-0 text-label" strokeWidth={1.75} />{:else if route.params.length}<FileCode2 class="size-3.5 shrink-0 text-label" strokeWidth={1.75} />{:else}<File class="size-3.5 shrink-0 text-label" strokeWidth={1.75} />{/if}
					<span class="min-w-0 flex-1 truncate {active ? 'font-medium text-accent' : ''}">{routeLabel(route)}</span>
					{#if active}<Check class="size-3.5 shrink-0 text-accent" />{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
