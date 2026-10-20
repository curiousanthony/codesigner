<script lang="ts">
	import type { DesignToken } from '@codesigner/protocol';
	import { Component, ChevronRight, Search, Palette, Plus } from '@lucide/svelte';
	import { TEXT_SIZES } from '#lib/style/tailwind-map.js';
	import { editor } from '#lib/state/editor.svelte.js';
	import { invoke, errorMessage } from '#lib/api.js';
	import { m } from '#lib/paraglide/messages.js';

	let query = $state('');
	let open = $state<Record<string, boolean>>({ components: true, images: true, typography: true, colors: true });
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

	const images = $derived(editor.images.filter((i) => !q || i.file.toLowerCase().includes(q)));
	/** Thumbnails come from the app's own dev server (static/ at its URL, $lib/assets through Vite). */
	const thumb = (image: (typeof editor.images)[number]) =>
		editor.devServer?.url ? new URL(image.kind === 'static' ? image.src : `/${image.file}`, editor.devServer.url).toString() : '';

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

	// Typography: the theme's fonts and text sizes (Tailwind's defaults unless the theme overrides them).
	const tokenList = $derived(editor.tokens?.tokens ?? []);
	const fonts = $derived.by(() => {
		const themed = tokenList.filter((t) => t.type === 'font' && t.utility?.startsWith('font-')).map((t) => ({ name: t.utility!.slice(5), family: resolve(t, false) }));
		const defaults = [
			{ name: 'sans', family: 'ui-sans-serif, system-ui, sans-serif' },
			{ name: 'serif', family: 'ui-serif, Georgia, serif' },
			{ name: 'mono', family: 'ui-monospace, SFMono-Regular, monospace' }
		].filter((d) => !themed.some((t) => t.name === d.name));
		return [...themed, ...defaults].filter((f) => !q || f.name.includes(q));
	});
	const sizes = $derived.by(() => {
		const themed = new Map(tokenList.filter((t) => /^--text-[\w-]+$/.test(t.name) && !t.name.includes('--line-height') && t.value).map((t) => [t.name.slice(7), t.value!]));
		const names = [...new Set([...TEXT_SIZES.map(([n]) => n), ...themed.keys()])];
		return names
			.map((name) => ({ name, value: themed.get(name) ?? TEXT_SIZES.find(([n]) => n === name)?.[1] ?? '' }))
			.filter((s) => s.value && (!q || s.name.includes(q)));
	});
	const toPx = (v: string) => (v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v));

	async function applyTypography(kind: 'font' | 'size', value: string) {
		if (!editor.selection.ids.length) return editor.toast(m.cmd_select_first());
		// The Style panel owns the class rules (breakpoints, states): make sure it's mounted.
		if (!editor.styleCommands) {
			editor.rightTab = 'style';
			await new Promise((r) => setTimeout(r, 50));
		}
		editor.styleCommands?.typography(kind, value);
	}

	// New color token: light value, dark value when the theme has a dark scope.
	let adding = $state<{ name: string; light: string; dark: string } | null>(null);
	const tokenScopes = $derived<('light' | 'dark')[]>(editor.tokens?.darkSelector ? ['light', 'dark'] : ['light']);
	const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
	async function addToken(event: SubmitEvent) {
		event.preventDefault();
		if (!adding || !editor.worktree || !slug(adding.name)) return;
		const { name, light, dark } = adding;
		try {
			editor.tokens = await invoke('tokens:add', editor.worktree, { name: slug(name), light, dark: editor.tokens?.darkSelector ? dark : null });
			adding = null;
			editor.toast(m.assets_token_added({ name: slug(name) }), 'success');
		} catch (error) {
			editor.toast(errorMessage(error), 'error');
		}
	}

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
					<div
						class="flex h-[30px] cursor-grab items-center gap-2 rounded-control px-2 hover:bg-row-hover"
						title={m.assets_drag_hint({ path: component.importPath })}
						role="listitem"
						draggable="true"
						data-component={component.name}
						ondragstart={(e) => {
							editor.draggingAsset = { component };
							e.dataTransfer?.setData('text/plain', component.name);
							if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
						}}
						ondragend={() => (editor.draggingAsset = null)}
						ondblclick={() => void editor.editComponent(component)}
					>
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

		{@render header('images', m.assets_images(), images.length)}
		{#if open.images}
			{#if images.length}
				<div class="grid grid-cols-3 gap-1.5 px-1 pb-2">
					{#each images as image (image.file)}
						<div
							class="flex cursor-grab flex-col gap-1 rounded-control p-1 hover:bg-row-hover"
							title={m.assets_drag_hint({ path: image.file })}
							role="listitem"
							draggable="true"
							data-image={image.file}
							ondragstart={(e) => {
								editor.draggingAsset = { image };
								e.dataTransfer?.setData('text/plain', image.src);
								if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
							}}
							ondragend={() => (editor.draggingAsset = null)}
						>
							<span class="flex aspect-square items-center justify-center overflow-hidden rounded-[6px] bg-control">
								{#if thumb(image)}<img src={thumb(image)} alt="" class="max-h-full max-w-full object-contain" draggable="false" loading="lazy" />{/if}
							</span>
							<span class="truncate text-[10px] text-label">{image.name}</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="px-2 py-2 text-muted">{m.assets_no_images()}</p>
			{/if}
		{/if}

		{@render header('typography', m.assets_typography(), fonts.length + sizes.length)}
		{#if open.typography}
			<p class="px-2 pb-1 text-[10px] text-muted">{m.assets_typography_hint()}</p>
			{#each fonts as font (font.name)}
				<button type="button" class="flex h-[34px] w-full items-center gap-2.5 rounded-control px-2 text-left hover:bg-row-hover" title={font.family} onclick={() => applyTypography('font', font.name)}>
					<span class="w-9 shrink-0 text-center text-[17px] text-fg-strong" style="font-family:{font.family}">Ag</span>
					<span class="min-w-0 flex-1 truncate">{font.name}</span>
					<span class="max-w-[90px] truncate text-[10px] text-muted">{font.family.split(',')[0].replace(/["']/g, '')}</span>
				</button>
			{/each}
			{#each sizes as size (size.name)}
				<button type="button" class="flex min-h-[30px] w-full items-center gap-2.5 rounded-control px-2 text-left hover:bg-row-hover" onclick={() => applyTypography('size', size.name)}>
					<span class="w-9 shrink-0 text-center leading-none text-fg-strong" style="font-size:{Math.min(22, toPx(size.value))}px">Aa</span>
					<span class="min-w-0 flex-1 truncate">text-{size.name}</span>
					<span class="text-[10px] text-muted tabular-nums">{Math.round(toPx(size.value))}px</span>
				</button>
			{/each}
		{/if}

		{@render header('colors', m.assets_colors(), colorTokens.length)}
		{#if open.colors}
			{#if editor.tokens?.file}
				<p class="truncate px-2 pb-1 text-[10px] text-muted">{editor.tokens.file}</p>
			{/if}
			{#if adding}
				<form class="mb-1 flex flex-col gap-1.5 rounded-control bg-row-hover p-2" onsubmit={addToken}>
					<!-- svelte-ignore a11y_autofocus -->
					<input class="h-7 rounded-[6px] bg-control px-2 outline-none placeholder:text-muted" placeholder={m.assets_token_name()} bind:value={adding.name} autofocus
						onkeydown={(e) => e.key === 'Escape' && (adding = null)} />
					{#each tokenScopes as scope (scope)}
						<label class="grid grid-cols-[40px_22px_1fr] items-center gap-1.5">
							<span class="text-[11px] text-label">{scope === 'light' ? m.assets_light() : m.assets_dark()}</span>
							<input type="color" class="size-[22px] cursor-pointer rounded-[5px] border-0 bg-transparent p-0" bind:value={adding[scope]} aria-label={scope} />
							<input class="h-7 min-w-0 rounded-[6px] bg-control px-2 font-mono text-[11px] outline-none" bind:value={adding[scope]} />
						</label>
					{/each}
					<div class="flex justify-end gap-1">
						<button type="button" class="h-7 rounded-[6px] px-2 text-label hover:bg-control" onclick={() => (adding = null)}>{m.action_cancel()}</button>
						<button type="submit" class="h-7 rounded-[6px] bg-accent px-2.5 text-white disabled:opacity-50" disabled={!slug(adding.name)}>{m.action_add()}</button>
					</div>
				</form>
			{:else if editor.tokens?.file}
				<button type="button" class="flex h-[30px] w-full items-center gap-2 rounded-control px-2 text-left text-accent hover:bg-row-hover"
					onclick={() => (adding = { name: '', light: '#0099ff', dark: '#33aaff' })}>
					<Plus class="size-3.5" />{m.assets_new_color()}
				</button>
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
