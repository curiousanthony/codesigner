<script lang="ts">
	import { evaluate, round } from './math';

	type Props = {
		value: number | null;
		/** Shown when value is null (e.g. "Auto", "Mixed"). */
		placeholder?: string;
		min?: number;
		max?: number;
		step?: number;
		precision?: number;
		/** Small trailing label inside the field, e.g. "T" or "px". */
		suffix?: string;
		disabled?: boolean;
		label?: string;
		/** Live value while scrubbing (for previews). */
		onpreview?: (value: number) => void;
		/** Commit. `coalesce` is true for rapid repeated changes (arrow keys). */
		oncommit: (value: number, coalesce: boolean) => void;
		/** Free-form text (e.g. "fill", "50%") the parent may interpret. */
		ontext?: (text: string) => boolean;
	};

	let {
		value,
		placeholder = '',
		min = -Infinity,
		max = Infinity,
		step = 1,
		precision = 2,
		suffix,
		disabled = false,
		label,
		onpreview,
		oncommit,
		ontext
	}: Props = $props();

	let input: HTMLInputElement;
	let editing = $state(false);
	let draft = $state('');
	let scrubbing = $state(false);

	const clamp = (v: number) => Math.min(max, Math.max(min, round(v, precision)));
	const display = $derived(value === null ? '' : String(round(value, precision)));

	function commitDraft() {
		const text = draft.trim();
		if (text === '' || text === display) return;
		const parsed = evaluate(text);
		if (parsed !== null) oncommit(clamp(parsed), false);
		else if (ontext?.(text)) return;
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			commitDraft();
			input.blur();
		} else if (event.key === 'Escape') {
			draft = display;
			input.blur();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const delta = (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : event.altKey ? 0.1 : 1) * step;
			const base = evaluate(draft) ?? value ?? 0;
			const next = clamp(base + delta);
			draft = String(next);
			oncommit(next, true);
		}
	}

	// Drag horizontally on the field (before focusing) to scrub, like Framer.
	let start: { x: number; value: number } | null = null;
	function onpointerdown(event: PointerEvent) {
		if (disabled || editing || event.button !== 0) return;
		event.preventDefault();
		start = { x: event.clientX, value: value ?? 0 };
		const target = event.currentTarget as HTMLElement;
		target.setPointerCapture(event.pointerId);
	}
	let scrubValue = 0;
	function onpointermove(event: PointerEvent) {
		if (!start) return;
		const dx = event.clientX - start.x;
		if (!scrubbing && Math.abs(dx) < 3) return;
		scrubbing = true;
		scrubValue = clamp(start.value + Math.round(dx / 2) * step * (event.shiftKey ? 10 : 1));
		draft = String(scrubValue);
		onpreview?.(scrubValue);
	}
	function onpointerup() {
		if (!start) return;
		const wasScrubbing = scrubbing;
		start = null;
		scrubbing = false;
		if (wasScrubbing) {
			oncommit(scrubValue, false);
		} else {
			editing = true;
			draft = display;
			input.focus();
			input.select();
		}
	}
</script>

<div
	class="relative flex h-[30px] w-full min-w-0 items-center rounded-control bg-control hover:bg-control-hover
		{scrubbing ? 'cursor-ew-resize' : editing ? '' : 'cursor-ew-resize'} {disabled ? 'opacity-50' : ''}"
	role="presentation"
	onpointerdown={onpointerdown}
	onpointermove={onpointermove}
	onpointerup={onpointerup}
>
	<input
		bind:this={input}
		class="h-full w-full min-w-0 bg-transparent pl-2 text-fg tabular-nums outline-none placeholder:text-muted
			{editing ? '' : 'pointer-events-none'} {suffix ? 'pr-5' : 'pr-2'}"
		aria-label={label}
		{placeholder}
		{disabled}
		value={editing || scrubbing ? draft : display}
		oninput={(e) => (draft = (e.currentTarget as HTMLInputElement).value)}
		onfocus={() => {
			editing = true;
			draft = display;
		}}
		onblur={() => {
			if (editing) commitDraft();
			editing = false;
		}}
		{onkeydown}
	/>
	{#if suffix}
		<span class="pointer-events-none absolute right-2 text-[10px] text-muted">{suffix}</span>
	{/if}
</div>
