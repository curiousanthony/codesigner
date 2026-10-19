<script lang="ts">
	import { Component } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { createComponent } from '#lib/state/commands.js';
	import { m } from '#lib/paraglide/messages.js';

	/** PascalCase from the layer's name: "Card.Root" → "Card", "project card" → "ProjectCard". */
	const suggest = (layer: string) =>
		layer.split('.')[0].replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ?? '').toUpperCase()).replace(/^./, (c) => c.toUpperCase()).replace(/^[^A-Z]+/, '') || 'MyComponent';

	let name = $state(suggest(editor.selected?.name ?? ''));
	let busy = $state(false);
	const valid = $derived(/^[A-Z][A-Za-z0-9]*$/.test(name.trim()) && !editor.components.some((c) => c.file === `src/lib/components/${name.trim()}.svelte`));

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!valid) return;
		busy = true;
		const ok = await createComponent(name.trim());
		busy = false;
		if (ok) editor.createComponentOpen = false;
	}
</script>

<div class="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-28" role="dialog" aria-modal="true" aria-labelledby="create-component-title">
	<form class="flex w-[360px] flex-col gap-3 rounded-popover bg-popover p-4 shadow-popover" onsubmit={submit}>
		<div class="flex items-center gap-2">
			<Component class="size-4 text-component" />
			<h2 id="create-component-title" class="font-semibold text-fg-strong">{m.component_create_title()}</h2>
		</div>
		<p class="text-[11px] text-label">{m.component_create_description()}</p>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			class="h-[30px] rounded-control bg-control px-2 outline-none"
			bind:value={name}
			autofocus
			aria-label={m.component_create_name()}
			onkeydown={(e) => e.key === 'Escape' && (editor.createComponentOpen = false)}
		/>
		<p class="truncate font-mono text-[10.5px] text-muted">src/lib/components/{name.trim() || '…'}.svelte</p>
		<div class="flex justify-end gap-1.5">
			<button type="button" class="h-[30px] rounded-control px-2.5 text-label hover:bg-control" onclick={() => (editor.createComponentOpen = false)}>{m.action_cancel()}</button>
			<button type="submit" class="h-[30px] rounded-control bg-component px-3 font-medium text-white disabled:opacity-50" disabled={!valid || busy}>{m.component_create_submit()}</button>
		</div>
	</form>
</div>
