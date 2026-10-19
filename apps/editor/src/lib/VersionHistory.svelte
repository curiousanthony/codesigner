<script lang="ts">
	import type { Version } from '@codesigner/protocol';
	import { History, RotateCcw, X } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { getLocale } from '#lib/paraglide/runtime.js';
	import { m } from '#lib/paraglide/messages.js';

	let versions = $state<Version[] | null>(null);
	let selected = $state<string | null>(null);
	let busy = $state(false);

	$effect(() => {
		void editor.versions().then((list) => (versions = list));
	});

	const format = (date: string) =>
		new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));

	async function restore(version: Version) {
		busy = true;
		await editor.restoreVersion(version);
		versions = await editor.versions();
		selected = null;
		busy = false;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') editor.historyOpen = false;
	}
</script>

<svelte:window {onkeydown} />

<div class="fixed inset-0 z-50 flex items-start justify-end bg-black/10 p-3 pt-14" role="presentation" onclick={(e) => e.target === e.currentTarget && (editor.historyOpen = false)}>
	<div class="flex max-h-full w-[300px] flex-col rounded-popover bg-popover shadow-popover" role="dialog" aria-modal="true" aria-labelledby="history-title">
		<div class="flex items-center gap-2 px-3 pt-3 pb-2">
			<History class="size-4 text-label" />
			<div class="min-w-0 flex-1">
				<h2 id="history-title" class="font-semibold text-fg-strong">{m.history_title()}</h2>
				<p class="truncate text-[11px] text-muted">{editor.branch?.name.replace(/^design\//, '')}{#if editor.branch?.baseBranch} · {m.history_since({ base: editor.branch.baseBranch })}{/if}</p>
			</div>
			<button type="button" class="flex size-6 items-center justify-center rounded-[5px] text-label hover:bg-control" aria-label={m.action_close()} onclick={() => (editor.historyOpen = false)}>
				<X class="size-3.5" />
			</button>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
			<div class="flex h-10 items-center gap-2.5 rounded-[6px] px-2">
				<span class="size-2 shrink-0 rounded-full bg-accent"></span>
				<span class="flex-1 font-medium">{m.history_current()}</span>
			</div>
			{#if versions === null}
				<p class="px-2 py-4 text-center text-muted">…</p>
			{:else if versions.length === 0}
				<p class="px-3 py-4 text-center text-[11px] text-muted">{m.history_empty()}</p>
			{/if}
			{#each versions ?? [] as version (version.sha)}
				{@const open = selected === version.sha}
				<div class="rounded-[6px] {open ? 'bg-accent-tint' : 'hover:bg-control'}">
					<button type="button" class="flex w-full items-center gap-2.5 px-2 py-1.5 text-left" onclick={() => (selected = open ? null : version.sha)} data-version={version.sha}>
						<span class="size-2 shrink-0 rounded-full {version.auto ? 'border border-faint' : 'bg-label'}"></span>
						<span class="flex min-w-0 flex-1 flex-col">
							<span class="truncate {version.auto ? 'text-label' : 'font-medium text-fg'}">{version.subject}</span>
							<span class="text-[10px] text-muted">{format(version.date)}{#if version.auto} · {m.history_auto()}{/if}</span>
						</span>
					</button>
					{#if open}
						<div class="flex justify-end px-2 pb-2">
							<button type="button" class="flex h-7 items-center gap-1.5 rounded-[6px] bg-accent px-2.5 text-white hover:bg-accent-strong disabled:opacity-50" disabled={busy} onclick={() => restore(version)}>
								<RotateCcw class="size-3" />
								{m.history_restore()}
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
</div>
