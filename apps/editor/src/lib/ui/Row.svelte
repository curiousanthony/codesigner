<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		label: string;
		/** Highlights the label (value differs from the inherited/primary one). */
		overridden?: boolean;
		hint?: string;
		children: Snippet;
	};

	let { label, overridden = false, hint, children }: Props = $props();
</script>

<div class="grid min-h-[30px] grid-cols-[76px_1fr] items-center gap-2.5 pl-1.5">
	<span class="truncate {overridden ? 'text-accent' : 'text-label'}" title={hint ?? label}>{label}</span>
	<div class="flex min-w-0 items-center gap-2">
		{@render children()}
	</div>
</div>
