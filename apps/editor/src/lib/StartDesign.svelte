<script lang="ts">
	import { GitBranch } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import BranchPicker from '#lib/ui/BranchPicker.svelte';
	import { m } from '#lib/paraglide/messages.js';

	const choice = $derived(editor.startChoice!);
	let base = $state(editor.startChoice?.defaultBase ?? '');
	let name = $state('');
	let busy = $state(false);
	const current = $derived(choice.branches.find((b) => b.current)?.name ?? null);
	/** Suggested name: the base's last segment (`feature/login` → design/login), made unique. */
	const suggested = $derived.by(() => {
		const stem = (base.split('/').at(-1) || 'session').toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
		const taken = new Set(choice.branches.map((b) => b.name));
		let candidate = stem;
		for (let n = 2; taken.has(`design/${candidate}`); n++) candidate = `${stem}-${n}`;
		return candidate;
	});

	async function start() {
		busy = true;
		await editor.startDesign(base, name.trim() || suggested);
		busy = false;
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-6" role="dialog" aria-modal="true" aria-labelledby="start-design-title">
	<form
		class="flex w-full max-w-[440px] flex-col gap-4 rounded-popover bg-popover p-5 shadow-popover"
		onsubmit={(e) => {
			e.preventDefault();
			void start();
		}}
	>
		<div class="flex items-start gap-3">
			<div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-tint text-accent"><GitBranch class="size-4" /></div>
			<div>
				<h2 id="start-design-title" class="text-[14px] font-semibold text-fg-strong">{m.start_title()}</h2>
				<p class="mt-0.5 text-label">{m.start_description()}</p>
			</div>
		</div>

		<div class="flex flex-col gap-1.5">
			<span class="text-[11px] font-medium text-label">{m.branch_start_from()}</span>
			<BranchPicker branches={choice.branches} value={base} onchange={(b) => (base = b)} />
		</div>

		<label class="flex flex-col gap-1.5">
			<span class="text-[11px] font-medium text-label">{m.start_name()}</span>
			<span class="flex h-[30px] items-center rounded-control bg-control px-2">
				<span class="text-muted">design/</span>
				<input class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted" placeholder={suggested} bind:value={name} />
			</span>
		</label>

		<div class="flex items-center gap-2">
			{#if current}
				<button type="button" class="h-[30px] rounded-control px-2.5 text-label hover:bg-control" disabled={busy} onclick={() => editor.startDirect()}>
					{m.start_direct({ branch: current })}
				</button>
			{/if}
			<span class="flex-1"></span>
			<button type="button" class="h-[30px] rounded-control px-2.5 text-label hover:bg-control" disabled={busy} onclick={() => editor.cancelStart()}>
				{m.action_cancel()}
			</button>
			<button type="submit" class="h-[30px] rounded-control bg-accent px-3 font-medium text-white hover:bg-accent-strong disabled:opacity-50" disabled={busy || !base}>
				{m.start_submit()}
			</button>
		</div>
	</form>
</div>
