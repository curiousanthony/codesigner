<script lang="ts">
	import { editor } from '#lib/state/editor.svelte.js';
	import { CircleCheck, CircleAlert, Info } from '@lucide/svelte';
</script>

<div class="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
	{#each editor.toasts as toast (toast.id)}
		<div class="pointer-events-auto flex max-w-[520px] items-start gap-2 rounded-control bg-fg-strong px-3 py-2 text-panel shadow-popover">
			{#if toast.kind === 'error'}<CircleAlert class="mt-px size-3.5 shrink-0 text-danger" />{:else if toast.kind === 'success'}<CircleCheck class="mt-px size-3.5 shrink-0 text-success" />{:else}<Info class="mt-px size-3.5 shrink-0 opacity-70" />{/if}
			<span class="break-words">{toast.text}</span>
		</div>
	{/each}
</div>
