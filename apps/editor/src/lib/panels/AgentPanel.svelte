<script lang="ts">
	import { Sparkles, Terminal } from '@lucide/svelte';
	import { m } from '#lib/paraglide/messages.js';

	const agents = [
		{ id: 'claude', name: 'Claude', detail: 'claude CLI' },
		{ id: 'codex', name: 'Codex', detail: 'codex CLI' },
		{ id: 'cursor', name: 'Cursor', detail: 'agent CLI' }
	];
</script>

<div class="flex h-full flex-col">
	<div class="flex flex-col items-center gap-2 px-6 pt-10 pb-6 text-center">
		<div class="flex size-10 items-center justify-center rounded-full bg-accent-tint text-accent">
			<Sparkles class="size-5" />
		</div>
		<h3 class="text-[13px] font-semibold text-fg-strong">{m.agent_title()}</h3>
		<p class="text-label">{m.agent_description()}</p>
	</div>
	<div class="flex flex-col gap-1.5 px-3">
		{#each agents as agent (agent.id)}
			<div class="flex h-11 items-center gap-2.5 rounded-control border border-divider px-3">
				<Terminal class="size-4 text-label" />
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="font-medium">{agent.name}</span>
					<span class="text-[11px] text-muted">{agent.detail}</span>
				</div>
				<span class="rounded bg-control px-1.5 py-0.5 text-[10px] text-label">{m.coming_soon()}</span>
			</div>
		{/each}
	</div>
	<p class="mt-auto px-6 pb-6 text-center text-[11px] text-muted">{m.agent_footer()}</p>
</div>
