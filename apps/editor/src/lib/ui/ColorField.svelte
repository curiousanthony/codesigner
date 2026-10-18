<script lang="ts">
	import { ChevronDown, Check } from '@lucide/svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { toHexLabel } from './color.js';

	export type ColorOption = { name: string; css: string };

	type Props = {
		/** Current CSS color as rendered (computed style). */
		value: string;
		/** Name of the project token currently applied, if any (e.g. "primary"). */
		token: string | null;
		options: ColorOption[];
		label?: string;
		/** Choose a token by name, or a custom color (hex / any CSS color). */
		onchange: (choice: { token: string } | { custom: string }) => void;
		onclear?: () => void;
	};

	let { value, token, options, label, onchange, onclear }: Props = $props();
	let open = $state(false);
	let filter = $state('');
	let custom = $state('');

	const shownValue = $derived(toHexLabel(value));
	const transparent = $derived(shownValue === 'transparent');

	const shown = $derived(options.filter((o) => o.name.includes(filter.trim().toLowerCase())));
</script>

<div class="relative w-full min-w-0">
	<button
		type="button"
		class="flex h-[30px] w-full min-w-0 items-center gap-2 rounded-control bg-control px-1.5 hover:bg-control-hover"
		aria-label={label}
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span
			class="size-[18px] shrink-0 rounded-[5px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]"
			style="background: {transparent ? 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50% / 8px 8px' : value}"
		></span>
		<span class="min-w-0 flex-1 truncate text-left {token ? 'text-fg' : 'text-label'}">
			{token ?? (transparent ? m.style_none() : shownValue)}
		</span>
		<ChevronDown class="size-3 shrink-0 text-muted" />
	</button>

	{#if open}
		<div
			class="absolute top-full right-0 z-50 mt-1 flex max-h-80 w-56 flex-col rounded-popover bg-popover p-1.5 shadow-popover"
			role="dialog"
			tabindex="-1"
			onkeydown={(e) => e.key === 'Escape' && (open = false)}
		>
			<input
				class="mb-1 h-7 rounded-[6px] bg-control px-2 outline-none"
				placeholder={m.style_search_tokens()}
				bind:value={filter}
			/>
			<div class="min-h-0 flex-1 overflow-y-auto">
				{#each shown as option (option.name)}
					<button
						type="button"
						class="flex h-7 w-full items-center gap-2 rounded-[6px] px-1.5 hover:bg-control"
						onclick={() => {
							onchange({ token: option.name });
							open = false;
						}}
					>
						<span class="size-4 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]" style="background:{option.css}"></span>
						<span class="min-w-0 flex-1 truncate text-left">{option.name}</span>
						{#if option.name === token}<Check class="size-3 text-accent" />{/if}
					</button>
				{:else}
					<p class="px-2 py-2 text-muted">{m.style_no_tokens()}</p>
				{/each}
			</div>
			<form
				class="mt-1 flex gap-1 border-t border-divider pt-1.5"
				onsubmit={(e) => {
					e.preventDefault();
					if (custom.trim()) onchange({ custom: custom.trim() });
					open = false;
				}}
			>
				<input class="h-7 min-w-0 flex-1 rounded-[6px] bg-control px-2 font-mono text-[11px] outline-none" placeholder="#0099FF" bind:value={custom} />
				<button type="submit" class="h-7 rounded-[6px] bg-accent px-2 text-white">{m.action_apply()}</button>
			</form>
			{#if onclear}
				<button type="button" class="mt-1 h-7 rounded-[6px] text-left px-1.5 text-label hover:bg-control" onclick={() => { onclear?.(); open = false; }}>
					{m.style_remove_fill()}
				</button>
			{/if}
		</div>
		<button type="button" class="fixed inset-0 z-40 cursor-default" aria-label={m.action_close()} onclick={() => (open = false)}></button>
	{/if}
</div>
