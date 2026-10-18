<script lang="ts">
	import { page } from '$app/state';
	import { LayoutGrid, FolderKanban, Settings } from '@lucide/svelte';
	import NavItem from '#lib/components/app/nav-item.svelte';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import { Button } from '#lib/components/ui/button/index.js';

	let { data, children } = $props();

	const nav = [
		{ href: '/', text: 'Overview', icon: LayoutGrid },
		{ href: '/projects', text: 'Projects', icon: FolderKanban, badge: '3' },
		{ href: '/settings', text: 'Settings', icon: Settings }
	];
</script>

<div class="flex min-h-screen">
	<aside class="flex w-64 shrink-0 flex-col justify-between border-r bg-sidebar p-3">
		<div class="flex flex-col gap-4">
			<div class="flex items-center gap-2 px-2 py-1.5">
				<div class="size-7 rounded-md bg-primary"></div>
				<span class="text-sm font-semibold">Playground</span>
			</div>
			<nav class="flex flex-col gap-1">
				{#each nav as item (item.href)}
					<NavItem
						{...item}
						variant={page.url.pathname === item.href ? 'active' : 'normal'}
					/>
				{/each}
			</nav>
		</div>
		<div class="flex items-center gap-2 rounded-md p-2">
			<Avatar.Root class="size-8">
				<Avatar.Fallback>DD</Avatar.Fallback>
			</Avatar.Root>
			<div class="flex min-w-0 flex-1 flex-col">
				<span class="truncate text-sm font-medium">{data.user?.name}</span>
				<span class="text-xs text-muted-foreground">Designer</span>
			</div>
			<form method="POST" action="/logout">
				<Button type="submit" variant="ghost" size="sm">Log out</Button>
			</form>
		</div>
	</aside>
	<main class="flex-1 overflow-auto">
		{@render children()}
	</main>
</div>
