<script lang="ts" generics="T extends string">
	import { ChevronDown } from '@lucide/svelte';

	type Option = { value: T; label: string; disabled?: boolean };
	type Props = {
		options: Option[];
		value: T | null;
		onchange: (value: T) => void;
		placeholder?: string;
		compact?: boolean;
		disabled?: boolean;
		label?: string;
	};

	let { options, value, onchange, placeholder = '—', compact = false, disabled = false, label }: Props = $props();
</script>

<label class="relative flex h-[30px] min-w-0 items-center rounded-control bg-control hover:bg-control-hover {compact ? 'w-[66px] shrink-0' : 'w-full'}">
	<select
		class="h-full w-full min-w-0 appearance-none truncate bg-transparent pr-6 pl-2 text-fg outline-none disabled:opacity-50"
		aria-label={label}
		{disabled}
		value={value ?? ''}
		onchange={(e) => onchange((e.currentTarget as HTMLSelectElement).value as T)}
	>
		{#if value === null}<option value="" disabled>{placeholder}</option>{/if}
		{#each options as option (option.value)}
			<option value={option.value} disabled={option.disabled}>{option.label}</option>
		{/each}
	</select>
	<ChevronDown class="pointer-events-none absolute right-2 size-3 text-muted" />
</label>
