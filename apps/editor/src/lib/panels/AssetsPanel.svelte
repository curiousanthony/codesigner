<script lang="ts">
	import type { DesignToken } from '@codesigner/protocol';
	import { Component, ChevronRight, Search, Palette } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { invoke, errorMessage } from '#lib/api.js';
	import { m } from '#lib/paraglide/messages.js';

	let query = $state('');
	let open = $state<Record<string, boolean>>({ components: true, colors: true });
	let editing = $state<{ name: string; scope: 'light' | 'dark' } | null>(null);
	let draft = $state('');
	let expandedToken = $state<string | null>(null);

	const q = $derived(query.trim().toLowerCase());
	const groups = $derived.by(() => {
		const map = new Map<string, typeof editor.components>();
		for (const c of editor.components) {
			if (q && !c.name.toLowerCase().includes(q)) continue;
			map.set(c.group, [...(map.get(c.group) ?? []), c]);
		}
		return [...map.entries()];
	});

	const colorTokens = $derived(
		(editor.tokens?.tokens ?? []).filter(
			(t) => t.type === 'color' && !t.name.startsWith('--color-') && (!q || t.name.includes(q))
		)
	);
	const otherTokens = $derived(
		(editor.tokens?.tokens ?? []).filter(
			(t) => t.type !== 'color' && !t.scopes.every((s) => s.startsWith('@theme')) && (!q || t.name.includes(q))
		)
	);

	/** Resolves a var() chain to a concrete value for the swatch. */
	function resolve(token: DesignToken, dark: boolean): string {
		const byName = new Map((editor.tokens?.tokens ?? []).map((t) => [t.name, t]));
		let value = dark ? (token.darkValue ?? token.value) : token.value;
		for (let i = 0; i < 8 && value; i++) {
			const alias = value.match(/^\s*var\((--[\w-]+)\)\s*$/)?.[1];
			if (!alias) break;
			const next = byName.get(alias);
			value = next ? (dark ? (next.darkValue ?? next.value) : next.value) : null;
		}
		return value ?? 'transparent';
	}

	function startEdit(token: DesignToken, scope: 'light' | 'dark') {
		editing = { name: token.name, scope };
		draft = (scope === 'dark' ? token.darkValue : token.value) ?? '';
	}

	async function commit() {
		if (!editing || !editor.worktree) return;
		const { name, scope } = editing;
		editing = null;
		const token = editor.tokens?.tokens.find((t) => t.name === name);
		const current = scope === 'dark' ? token?.darkValue : token?.value;
		if (draft.trim() === '' || draft.trim() === current) return;
		try {
			editor.tokens = await invoke('tokens:edit', editor.worktree, { name, value: draft.trim(), scope });
		} catch (error) {
			editor.toast(errorMessage(error), 'error');
		}
	}
</script>

{#snippet header(key: string, title: string, count: number)}
	<button type="button" class="flex h-[42px] w-full items-center gap-1.5 pl-1.5 text-left" onclick={() => (open[key] = !open[key])}>
		<ChevronRight class="size-3 text-muted transition-transform {open[key] ? 'rotate-90' : ''}" />
		<h3 class="flex-1 font-semibold text-fg-strong">{title}</h3>
		<span class="text-[11px] text-muted tabular-nums">{count}</span>
	</button>
{/snippet}

{#snippet valueCell(token: DesignToken, scope: 'light' | 'dark')}
	{@const raw = scope === 'dark' ? token.darkValue : token.value}
	{#if editing?.name === token.name && editing.scope === scope}
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="h-6 w-full min-w-0 rounded-[6px] bg-control px-1.5 font-mono text-[10.5px] outline-none"
			bind:value={draft}
			autofocus
			onkeydown={(e) => {
				if (e.key === 'Enter') void commit();
				if (e.key === 'Escape') editing = null;
			}}
			onblur={() => void commit()}
		/>
	{:else}
		<button
			type="button"
			class="h-6 w-full min-w-0 truncate rounded-[6px] bg-control/60 px-1.5 text-left font-mono text-[10.5px] text-label hover:bg-control"
			title={raw ?? m.assets_token_unset()}
			onclick={() => startEdit(token, scope)}
		>
			{raw ?? '—'}
		</button>
	{/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col">
	<div class="px-2.5 pb-1">
		<label class="flex h-[30px] items-center gap-2 rounded-control bg-control px-2.5 text-muted">
			<Search class="size-3.5 shrink-0" />
			<input class="w-full bg-transparent text-fg outline-none placeholder:text-muted" placeholder={m.search_placeholder()} bind:value={query} />
		</label>
	</div>

	<div class="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
		{@render header('components', m.assets_components(), editor.components.length)}
		{#if open.components}
			{#each groups as [group, components] (group)}
				<p class="px-2 pt-1.5 pb-1 text-[11px] text-muted">{group}</p>
				{#each components as component (component.file)}
					<div class="flex h-[30px] items-center gap-2 rounded-control px-2 hover:bg-row-hover" title={component.importPath}>
						<Component class="size-3.5 shrink-0 text-component" strokeWidth={1.75} />
						<span class="min-w-0 flex-1 truncate">{component.name}</span>
						{#if component.variants.length}
							<span class="text-[10px] text-muted">{component.variants.map((v) => v.options.length).reduce((a, b) => a + b, 0)} {m.assets_variants()}</span>
						{/if}
					</div>
				{/each}
			{:else}
				<p class="px-2 py-2 text-muted">{m.assets_no_components()}</p>
			{/each}
		{/if}

		{@render header('colors', m.assets_colors(), colorTokens.length)}
		{#if open.colors}
			{#if editor.tokens?.file}
				<p class="truncate px-2 pb-1 text-[10px] text-muted">{editor.tokens.file}</p>
			{/if}
			{#each colorTokens as token (token.name)}
				{@const expanded = expandedToken === token.name}
				<div class="rounded-control {expanded ? 'bg-row-hover' : ''}">
					<button
						type="button"
						class="flex h-[30px] w-full items-center gap-2 rounded-control px-2 text-left hover:bg-row-hover"
						title={token.description ?? token.name}
						onclick={() => (expandedToken = expanded ? null : token.name)}
					>
						<span class="relative size-4 shrink-0 overflow-hidden rounded-[5px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]">
							<span class="absolute inset-y-0 left-0 w-1/2" style="background:{resolve(token, false)}"></span>
							<span class="absolute inset-y-0 right-0 w-1/2" style="background:{resolve(token, true)}"></span>
						</span>
						<span class="min-w-0 flex-1 truncate">{token.name.slice(2)}</span>
						{#if token.alias}<span class="truncate text-[10px] text-muted">→ {token.alias.slice(2)}</span>{/if}
					</button>
					{#if expanded}
						<div class="flex flex-col gap-1 px-2 pb-2">
							{#each [['light', m.assets_light()], ['dark', m.assets_dark()]] as const as [scope, label] (scope)}
								<div class="grid grid-cols-[40px_1fr] items-center gap-1.5">
									<span class="text-[11px] text-label">{label}</span>
									{@render valueCell(token, scope)}
								</div>
							{/each}
							{#if token.description}<p class="pt-1 text-[10px] text-muted">{token.description}</p>{/if}
						</div>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col items-center gap-2 px-4 py-6 text-center text-muted">
					<Palette class="size-5" />
					<p>{m.assets_no_tokens()}</p>
				</div>
			{/each}
		{/if}

		{#if otherTokens.length}
			{@render header('other', m.assets_other_tokens(), otherTokens.length)}
			{#if open.other}
				{#each otherTokens as token (token.name)}
					<div class="grid min-h-[30px] grid-cols-[1fr_96px] items-center gap-1 rounded-control px-2 hover:bg-row-hover">
						<span class="truncate" title={token.name}>{token.name.slice(2)}</span>
						{@render valueCell(token, 'light')}
					</div>
				{/each}
			{/if}
		{/if}
	</div>
</div>
