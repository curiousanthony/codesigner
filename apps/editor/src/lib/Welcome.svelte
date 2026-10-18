<script lang="ts">
	import { FolderOpen, Clock, TriangleAlert, Download, Loader } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import { inDesktop, invoke } from '#lib/api.js';
	import { m } from '#lib/paraglide/messages.js';

	const isMac = $derived(editor.appInfo?.platform === 'darwin');
	const home = $derived(editor.recent[0]?.root.split('/').slice(0, 3).join('/') ?? '');
	const shortPath = (p: string) => (home && p.startsWith(home) ? '~' + p.slice(home.length) : p);
</script>

<div class="flex h-full flex-col bg-canvas">
	<div class="drag h-12 shrink-0 {isMac ? 'pl-[84px]' : ''}"></div>
	<div class="flex flex-1 items-center justify-center p-8">
		<div class="w-full max-w-[460px]">
			<div class="mb-8 flex items-center gap-3">
				<div class="flex size-10 items-center justify-center rounded-xl bg-fg-strong text-[18px] font-bold text-panel">C</div>
				<div>
					<h1 class="text-[20px] font-semibold tracking-tight text-fg-strong">Codesigner</h1>
					<p class="text-label">{m.welcome_tagline()}</p>
				</div>
			</div>

			{#if editor.update}
				<button
					type="button"
					class="mb-4 flex w-full items-center gap-2.5 rounded-control bg-accent-tint px-3 py-2.5 text-left text-accent"
					onclick={() => editor.update && invoke('app:open-external', editor.update.url)}
				>
					<Download class="size-4" />
					<span class="flex-1">{m.update_available({ version: editor.update.latest })}</span>
					<span class="font-medium">{m.update_download()}</span>
				</button>
			{/if}

			{#if !inDesktop}
				<div class="mb-4 flex gap-2 rounded-control bg-warning/10 p-3 text-label">
					<TriangleAlert class="size-4 shrink-0 text-warning" />
					<p>{m.welcome_browser_only()}</p>
				</div>
			{/if}

			<button
				type="button"
				class="flex h-11 w-full items-center justify-center gap-2 rounded-control bg-accent font-medium text-white hover:bg-accent-strong disabled:opacity-60"
				disabled={!inDesktop || editor.opening}
				onclick={() => editor.pickAndOpen()}
			>
				{#if editor.opening}<Loader class="size-4 animate-spin" />{:else}<FolderOpen class="size-4" />{/if}
				{editor.opening ? m.welcome_opening() : m.welcome_open()}
			</button>
			<p class="mt-2 text-center text-[11px] text-muted">{m.welcome_open_hint()}</p>

			{#if editor.openError}
				<div class="mt-4 flex gap-2 rounded-control bg-danger/10 p-3 text-danger">
					<TriangleAlert class="size-4 shrink-0" />
					<p class="break-words">{editor.openError}</p>
				</div>
			{/if}

			{#if editor.recent.length}
				<h2 class="mt-8 mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted uppercase"><Clock class="size-3" />{m.welcome_recent()}</h2>
				<div class="flex flex-col gap-0.5">
					{#each editor.recent as project (project.root)}
						<button
							type="button"
							class="flex h-11 w-full flex-col justify-center rounded-control px-3 text-left hover:bg-panel disabled:opacity-60"
							disabled={editor.opening}
							onclick={() => editor.openProject(project.root)}
						>
							<span class="font-medium text-fg-strong">{project.name}</span>
							<span class="truncate text-[11px] text-muted">{shortPath(project.root)}</span>
						</button>
					{/each}
				</div>
			{/if}

			{#if editor.appInfo}
				<p class="mt-10 text-center text-[11px] text-faint">v{editor.appInfo.version}</p>
			{/if}
		</div>
	</div>
</div>
