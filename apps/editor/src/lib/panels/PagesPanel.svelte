<script lang="ts">
	import type { RouteInfo } from '@codesigner/protocol';
	import { House, File, FileCode2, Search, RefreshCw, PanelsTopLeft, Lock } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { routeLabel } from '#lib/state/routes.js';
	import { errorMessage, invoke } from '#lib/api.js';
	import { m } from '#lib/paraglide/messages.js';

	let query = $state('');
	let editingParams = $state<string | null>(null);
	let draft = $state<Record<string, string>>({});

	const pages = $derived(
		editor.routes.filter((r) => !r.isLayoutOnly && routeLabel(r).toLowerCase().includes(query.trim().toLowerCase()))
	);
	const layouts = $derived(editor.routes.filter((r) => r.layout));
	const current = $derived(editor.currentRoute);

	const groupOf = (route: RouteInfo) => route.id.match(/\(([^)]+)\)/)?.[1] ?? null;
	const hasParams = (route: RouteInfo) => route.params.some((p) => !p.optional);

	function open(route: RouteInfo) {
		const saved = editor.project?.settings.routeParams[route.id] ?? {};
		const ok = editor.navigate(route, saved);
		if (!ok) {
			editingParams = route.id;
			draft = Object.fromEntries(route.params.map((p) => [p.name, saved[p.name] ?? '']));
		}
	}

	async function applyParams(route: RouteInfo) {
		const values = { ...draft };
		if (editor.navigate(route, values)) editingParams = null;
		try {
			await editor.saveRouteParams(route.id, values);
		} catch (error) {
			editor.toast(errorMessage(error), 'error');
		}
	}

	function openFile(file: string | null) {
		if (file && editor.worktree) void invoke('project:open-in-editor', `${editor.worktree}/${file}`);
	}
</script>

<div class="flex h-full min-h-0 flex-col">
	<div class="px-2.5 pb-1">
		<label class="flex h-[30px] items-center gap-2 rounded-control bg-control px-2.5 text-muted">
			<Search class="size-3.5 shrink-0" />
			<input class="w-full bg-transparent text-fg outline-none placeholder:text-muted" placeholder={m.search_placeholder()} bind:value={query} />
		</label>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
		<div class="flex h-[42px] items-center justify-between pl-1.5">
			<h3 class="font-semibold text-fg-strong">{m.pages_title()}</h3>
			<button type="button" class="flex size-6 items-center justify-center rounded-md text-label hover:bg-control" title={m.pages_refresh()} aria-label={m.pages_refresh()} onclick={() => editor.refreshRoutes()}>
				<RefreshCw class="size-3.5" />
			</button>
		</div>

		{#each pages as route (route.id)}
			{@const active = current?.id === route.id}
			{@const group = groupOf(route)}
			<div
				class="group flex h-[30px] items-center gap-2 rounded-control px-2 {active ? 'bg-control text-fg-strong' : 'hover:bg-row-hover'}"
				role="button"
				tabindex="0"
				onclick={() => open(route)}
				onkeydown={(e) => e.key === 'Enter' && open(route)}
			>
				<span class="shrink-0 text-label">
					{#if route.pattern === '/'}<House class="size-3.5" strokeWidth={1.75} />{:else if route.params.length}<FileCode2 class="size-3.5" strokeWidth={1.75} />{:else}<File class="size-3.5" strokeWidth={1.75} />{/if}
				</span>
				<span class="min-w-0 flex-1 truncate">
					{#each routeLabel(route).split(/(\[[^\]]+\])/) as part, i (i)}
						{#if part.startsWith('[')}<span class="text-accent">{part}</span>{:else}{part}{/if}
					{/each}
				</span>
				{#if route.server}
					<span title={m.pages_server_load()}><Lock class="size-3 text-faint" /></span>
				{/if}
				{#if group}<span class="shrink-0 text-[11px] text-muted">({group})</span>{/if}
			</div>
			{#if editingParams === route.id}
				<form
					class="mx-1 my-1 flex flex-col gap-2 rounded-control border border-divider p-2"
					onsubmit={(e) => {
						e.preventDefault();
						void applyParams(route);
					}}
				>
					<p class="text-[11px] text-label">{m.pages_params_hint()}</p>
					{#each route.params as param (param.name)}
						<label class="grid grid-cols-[64px_1fr] items-center gap-2">
							<span class="truncate text-label">{param.name}</span>
							<input
								class="h-[26px] rounded-[6px] bg-control px-2 outline-none focus:bg-control-hover"
								placeholder={param.optional ? m.pages_optional() : m.pages_required()}
								bind:value={draft[param.name]}
							/>
						</label>
					{/each}
					<div class="flex justify-end gap-1.5">
						<button type="button" class="h-[26px] rounded-[6px] px-2.5 hover:bg-control" onclick={() => (editingParams = null)}>{m.action_cancel()}</button>
						<button type="submit" class="h-[26px] rounded-[6px] bg-accent px-2.5 text-white hover:bg-accent-strong">{m.action_open()}</button>
					</div>
				</form>
			{:else if active && hasParams(route)}
				<button type="button" class="ml-7 h-6 text-[11px] text-accent hover:underline" onclick={() => { editingParams = route.id; draft = { ...(editor.project?.settings.routeParams[route.id] ?? {}) }; }}>
					{m.pages_change_params()}
				</button>
			{/if}
		{/each}

		{#if layouts.length}
			<div class="mt-2 flex h-[42px] items-center pl-1.5">
				<h3 class="font-semibold text-fg-strong">{m.pages_layouts()}</h3>
			</div>
			{#each layouts as route (route.id)}
				<div
					class="flex h-[30px] items-center gap-2 rounded-control px-2 hover:bg-row-hover"
					role="button"
					tabindex="0"
					title={m.action_open_in_code()}
					onclick={() => openFile(route.layout)}
					onkeydown={(e) => e.key === 'Enter' && openFile(route.layout)}
				>
					<PanelsTopLeft class="size-3.5 shrink-0 text-label" strokeWidth={1.75} />
					<span class="min-w-0 flex-1 truncate">{route.id === '/' ? m.pages_root_layout() : route.id}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>
