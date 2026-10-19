<script lang="ts">
	import type { SourceBranch } from '@codesigner/protocol';
	import { Check, Cloud, GitBranch, Search } from '@lucide/svelte';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { m } from '#lib/paraglide/messages.js';

	type Props = {
		branches: SourceBranch[];
		value: string;
		onchange: (name: string) => void;
		/** List height in px. */
		height?: number;
	};

	let { branches, value, onchange, height = 220 }: Props = $props();
	let query = $state('');

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return q ? branches.filter((b) => b.name.toLowerCase().includes(q)) : branches;
	});

	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 31536000],
		['month', 2592000],
		['week', 604800],
		['day', 86400],
		['hour', 3600],
		['minute', 60]
	];
	function ago(date: string): string {
		const seconds = (Date.parse(date) - Date.now()) / 1000;
		if (!Number.isFinite(seconds)) return '';
		const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
		for (const [unit, size] of units) if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
		return format.format(0, 'minute');
	}
</script>

<div class="flex flex-col gap-1.5">
	{#if branches.length > 6}
		<label class="flex h-[30px] items-center gap-2 rounded-control bg-control px-2 text-label">
			<Search class="size-3.5 shrink-0" />
			<input class="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-muted" placeholder={m.branch_search()} bind:value={query} />
		</label>
	{/if}
	<div class="overflow-y-auto rounded-control" style="max-height:{height}px" role="listbox" aria-label={m.branch_start_from()}>
		{#each filtered as branch (branch.name)}
			{@const selected = branch.name === value}
			<button
				type="button"
				role="option"
				aria-selected={selected}
				data-branch={branch.name}
				class="flex h-11 w-full items-center gap-2.5 rounded-[6px] px-2 text-left {selected ? 'bg-accent-tint' : 'hover:bg-control'}"
				onclick={() => onchange(branch.name)}
			>
				{#if branch.remote}
					<Cloud class="size-3.5 shrink-0 text-muted" />
				{:else}
					<GitBranch class="size-3.5 shrink-0 {selected ? 'text-accent' : 'text-label'}" />
				{/if}
				<span class="flex min-w-0 flex-1 flex-col">
					<span class="flex items-center gap-1.5">
						<span class="truncate font-medium {selected ? 'text-accent' : 'text-fg'}" title={branch.name}>{branch.name.replace(/^(origin\/)?design\//, '$1').replace(/^origin\//, '')}</span>
						{#if branch.current}<span class="shrink-0 rounded-[4px] bg-black/[0.05] px-1 text-[10px] text-label dark:bg-white/[0.06]">{m.branch_checked_out()}</span>{/if}
					</span>
					<span class="truncate text-[11px] text-muted">{ago(branch.date)} · {branch.subject}</span>
				</span>
				{#if selected}<Check class="size-3.5 shrink-0 text-accent" />{/if}
			</button>
		{:else}
			<p class="px-2 py-3 text-center text-muted">{m.branch_none_found()}</p>
		{/each}
	</div>
</div>
