<script lang="ts" generics="T extends string">
	import type { Component } from 'svelte';

	type Option = { value: T; label: string; icon?: Component };
	type Props = {
		options: Option[];
		value: T | null;
		onchange: (value: T) => void;
		/** Show icons only (labels become tooltips). */
		iconOnly?: boolean;
		disabled?: boolean;
	};

	let { options, value, onchange, iconOnly = false, disabled = false }: Props = $props();
</script>

<div class="flex h-[30px] w-full items-center gap-0.5 rounded-control bg-control p-0.5" class:opacity-50={disabled} role="radiogroup">
	{#each options as option (option.value)}
		{@const selected = option.value === value}
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			aria-label={option.label}
			title={iconOnly ? option.label : undefined}
			{disabled}
			class="flex h-full min-w-0 flex-1 items-center justify-center rounded-[6px] px-1.5 transition-colors
				{selected ? 'bg-control-active text-accent shadow-control' : 'text-label hover:text-fg'}"
			onclick={() => onchange(option.value)}
		>
			{#if option.icon && iconOnly}
				<option.icon class="size-3.5" strokeWidth={1.75} />
			{:else}
				<span class="truncate">{option.label}</span>
			{/if}
		</button>
	{/each}
</div>
