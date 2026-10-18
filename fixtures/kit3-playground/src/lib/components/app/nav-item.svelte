<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const navItemVariants = tv({
		base: 'flex h-9 w-full items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors',
		variants: {
			variant: {
				normal: 'text-sidebar-foreground hover:bg-accent hover:text-accent-foreground',
				active: 'bg-accent text-accent-foreground'
			}
		},
		defaultVariants: { variant: 'normal' }
	});

	export type NavItemVariant = VariantProps<typeof navItemVariants>['variant'];
</script>

<script lang="ts">
	import type { Component } from 'svelte';
	import { cn } from '#lib/utils.js';

	type Props = {
		href: string;
		text: string;
		icon?: Component;
		variant?: NavItemVariant;
		badge?: string;
		class?: string;
	};

	let { href, text, icon: Icon, variant = 'normal', badge, class: className }: Props = $props();
</script>

<a {href} class={cn(navItemVariants({ variant }), className)}>
	{#if Icon}
		<Icon class="size-4 shrink-0" />
	{/if}
	<span class="flex-1 truncate">{text}</span>
	{#if badge}
		<span class="rounded bg-muted px-1.5 text-xs text-muted-foreground">{badge}</span>
	{/if}
</a>
