<script lang="ts">
	import { tick } from 'svelte';
	import { ChevronDown, X } from '@lucide/svelte';
	import type { IconInfo, IconLibrary } from '@codesigner/protocol';
	import { m } from '#lib/paraglide/messages.js';

	type Props = {
		/** Name of the icon component currently passed (e.g. `House`), or null. */
		value: string | null;
		/** Loads the project's icon library (cached by the caller). */
		load: () => Promise<IconLibrary | null>;
		label?: string;
		onchange: (icon: { name: string; from: string } | null) => void;
	};

	let { value, load, label, onchange }: Props = $props();
	let open = $state(false);
	let filter = $state('');
	let library = $state.raw<IconLibrary | null | undefined>(undefined);
	let button = $state<HTMLButtonElement | null>(null);
	let search = $state<HTMLInputElement | null>(null);
	let place = $state({ left: 0, top: 0, up: false });

	const WIDTH = 264;
	const HEIGHT = 320;
	const LIMIT = 160;

	const current = $derived(library?.icons.find((i) => i.name === value) ?? null);
	/** Name words match in any order ("arrow up" finds ArrowUpRight); the exact name, then names starting with the query, come first. */
	const matches = $derived.by(() => {
		const icons = library?.icons ?? [];
		const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (!words.length) return icons;
		const query = words.join('');
		const rank = (name: string) => (name === query ? 0 : name.startsWith(query) ? 1 : 2);
		return icons
			.filter((i) => words.every((w) => i.name.toLowerCase().includes(w)))
			.sort((a, b) => rank(a.name.toLowerCase()) - rank(b.name.toLowerCase()));
	});
	const shown = $derived(matches.slice(0, LIMIT));
	const more = $derived(Math.max(0, matches.length - LIMIT));

	$effect(() => {
		// the field shows the current icon's drawing as soon as the library is known
		if (value && library === undefined) void load().then((l) => (library = l));
	});

	async function toggle() {
		open = !open;
		if (!open || !button) return;
		const r = button.getBoundingClientRect();
		const up = r.bottom + HEIGHT + 8 > innerHeight && r.top - HEIGHT - 8 > 0;
		place = { left: Math.max(8, Math.min(r.right - WIDTH, innerWidth - WIDTH - 8)), top: up ? r.top - 4 : r.bottom + 4, up };
		filter = '';
		if (library === undefined) library = await load();
		await tick();
		search?.focus();
	}

	function pick(icon: IconInfo) {
		if (!library) return;
		onchange({ name: icon.name, from: library.from });
		open = false;
	}
</script>

{#snippet glyph(icon: IconInfo, size: string)}
	<svg class="{size} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#each icon.node as [tag, attrs], i (i)}
			<svelte:element this={tag} {...attrs} />
		{/each}
	</svg>
{/snippet}

<div class="relative w-full min-w-0">
	<button
		bind:this={button}
		type="button"
		class="flex h-[30px] w-full min-w-0 items-center gap-2 rounded-control bg-control px-2 hover:bg-control-hover"
		aria-label={label}
		aria-expanded={open}
		onclick={toggle}
	>
		{#if current}{@render glyph(current, 'size-3.5')}{/if}
		<span class="min-w-0 flex-1 truncate text-left {value ? 'text-fg' : 'text-label'}">{value ?? m.icon_none()}</span>
		<ChevronDown class="size-3 shrink-0 text-muted" />
	</button>

	{#if open}
		<button type="button" class="fixed inset-0 z-40 cursor-default" aria-label={m.action_close()} onclick={() => (open = false)}></button>
		<div
			class="fixed z-50 flex flex-col gap-2 rounded-popover bg-popover p-2 shadow-popover"
			style="left:{place.left}px; top:{place.top}px; width:{WIDTH}px; {place.up ? 'transform: translateY(-100%);' : ''}"
			role="dialog"
			tabindex="-1"
			aria-label={label}
			onkeydown={(e) => e.key === 'Escape' && (open = false)}
		>
			<div class="flex gap-1">
				<input
					bind:this={search}
					class="h-7 min-w-0 flex-1 rounded-[6px] bg-control px-2 outline-none"
					placeholder={m.icon_search()}
					bind:value={filter}
					onkeydown={(e) => e.key === 'Enter' && shown[0] && pick(shown[0])}
				/>
				{#if value}
					<button type="button" class="grid size-7 place-items-center rounded-[6px] text-label hover:bg-control" title={m.icon_remove()} aria-label={m.icon_remove()} onclick={() => { onchange(null); open = false; }}>
						<X class="size-3.5" />
					</button>
				{/if}
			</div>
			{#if library === undefined}
				<p class="px-1 py-6 text-center text-[11px] text-muted">{m.icon_loading()}</p>
			{:else if !library}
				<p class="px-1 py-6 text-center text-[11px] text-muted">{m.icon_no_library()}</p>
			{:else}
				<div class="grid max-h-60 min-h-0 grid-cols-8 gap-0.5 overflow-y-auto">
					{#each shown as icon (icon.name)}
						<button
							type="button"
							class="grid aspect-square place-items-center rounded-[6px] {icon.name === value ? 'bg-accent-tint text-accent' : 'text-fg hover:bg-control'}"
							title={icon.name}
							aria-label={icon.name}
							onclick={() => pick(icon)}
						>
							{@render glyph(icon, 'size-4')}
						</button>
					{/each}
				</div>
				{#if !shown.length}
					<p class="px-1 py-4 text-center text-[11px] text-muted">{m.icon_no_match()}</p>
				{:else if more}
					<p class="px-1 text-[10.5px] text-muted">{m.icon_more({ count: more })}</p>
				{/if}
			{/if}
		</div>
	{/if}
</div>
