<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Props = HTMLButtonAttributes & {
		active?: boolean;
		size?: 'sm' | 'md';
		label: string;
		children: Snippet;
	};

	let { active = false, size = 'md', label, children, class: className = '', ...rest }: Props = $props();
</script>

<button
	type="button"
	aria-label={label}
	title={label}
	aria-pressed={active}
	class="no-drag inline-flex shrink-0 items-center justify-center rounded-control text-fg transition-colors
		{size === 'md' ? 'size-[30px]' : 'size-6'}
		{active ? 'bg-control text-fg-strong' : 'hover:bg-control'}
		disabled:opacity-40 {className}"
	{...rest}
>
	{@render children()}
</button>
