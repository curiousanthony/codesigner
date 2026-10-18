<script lang="ts">
	type Props = {
		value: string;
		placeholder?: string;
		disabled?: boolean;
		label?: string;
		mono?: boolean;
		oncommit: (value: string) => void;
	};

	let { value, placeholder = '', disabled = false, label, mono = false, oncommit }: Props = $props();
	let draft = $state<string | null>(null);
</script>

<input
	class="h-[30px] w-full min-w-0 rounded-control bg-control px-2 text-fg outline-none placeholder:text-muted hover:bg-control-hover focus:bg-control-hover disabled:opacity-50 {mono ? 'font-mono text-[11px]' : ''}"
	aria-label={label}
	{placeholder}
	{disabled}
	value={draft ?? value}
	oninput={(e) => (draft = (e.currentTarget as HTMLInputElement).value)}
	onkeydown={(e) => {
		if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
		if (e.key === 'Escape') {
			draft = null;
			(e.currentTarget as HTMLInputElement).blur();
		}
	}}
	onblur={() => {
		if (draft !== null && draft !== value) oncommit(draft);
		draft = null;
	}}
/>
