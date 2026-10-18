<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Plus, Minus } from '@lucide/svelte';

	type Props = {
		title: string;
		/** When set, shows "+" (add) or "−" (remove) in the header. */
		action?: 'add' | 'remove' | null;
		onaction?: () => void;
		children?: Snippet;
		headerExtra?: Snippet;
	};

	let { title, action = null, onaction, children, headerExtra }: Props = $props();
</script>

<section class="border-b border-divider px-2.5">
	<header class="flex h-[42px] items-center justify-between pl-1.5">
		<h3 class="text-[12px] font-semibold text-fg-strong">{title}</h3>
		<div class="flex items-center gap-1">
			{@render headerExtra?.()}
			{#if action}
				<button
					type="button"
					class="flex size-6 items-center justify-center rounded-md text-label hover:bg-control hover:text-fg"
					aria-label={action === 'add' ? `Add ${title}` : `Remove ${title}`}
					onclick={onaction}
				>
					{#if action === 'add'}<Plus class="size-3.5" />{:else}<Minus class="size-3.5" />{/if}
				</button>
			{/if}
		</div>
	</header>
	{#if children}
		<div class="flex flex-col gap-2 pb-3.5">
			{@render children()}
		</div>
	{/if}
</section>
