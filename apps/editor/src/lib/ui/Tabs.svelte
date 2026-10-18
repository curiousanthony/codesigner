<script lang="ts" generics="T extends string">
	type Props = { tabs: { value: T; label: string; hint?: string }[]; value: T; onchange: (value: T) => void };
	let { tabs, value, onchange }: Props = $props();
</script>

<div class="flex items-center gap-1" role="tablist">
	{#each tabs as tab (tab.value)}
		<button
			type="button"
			role="tab"
			aria-selected={tab.value === value}
			title={tab.hint}
			class="h-[30px] rounded-control px-2.5 transition-colors {tab.value === value ? 'bg-control font-medium text-fg-strong' : 'text-label hover:text-fg'}"
			onclick={() => onchange(tab.value)}
		>
			{tab.label}
		</button>
	{/each}
</div>
