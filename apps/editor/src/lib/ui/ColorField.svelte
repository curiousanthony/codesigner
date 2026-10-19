<script lang="ts">
	import { ChevronDown, Check } from '@lucide/svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { hsvToRgb, parseHsva, toHex, toHexLabel, type Hsva } from './color.js';

	export type ColorOption = { name: string; css: string };
	export type ColorChoice = { token: string; opacity?: number } | { custom: string };

	type Props = {
		/** Current CSS color as rendered (computed style). */
		value: string;
		/** Token currently applied, if any, with Tailwind's opacity modifier (e.g. "primary" or "primary/80"). */
		token: string | null;
		options: ColorOption[];
		label?: string;
		/** A token (with an opacity below 100 as `/NN`), or a custom color (hex / any CSS color). */
		onchange: (choice: ColorChoice) => void;
		onclear?: () => void;
	};

	let { value, token, options, label, onchange, onclear }: Props = $props();
	let open = $state(false);
	let tab = $state<'tokens' | 'custom'>('tokens');
	let filter = $state('');
	let button = $state<HTMLButtonElement | null>(null);
	let place = $state({ left: 0, top: 0, up: false });

	const tokenName = $derived(token?.split('/')[0] ?? null);
	const tokenOpacity = $derived(token?.includes('/') ? Number(token.split('/')[1]) : 100);
	const shownValue = $derived(toHexLabel(value));
	const transparent = $derived(shownValue === 'transparent');
	const shown = $derived(options.filter((o) => o.name.includes(filter.trim().toLowerCase())));

	const WIDTH = 240;
	const HEIGHT = 340;
	/** Anchored to the field; opens upwards when there's no room below (the field can sit at the panel's bottom). */
	function toggle() {
		open = !open;
		if (!open || !button) return;
		const r = button.getBoundingClientRect();
		const up = r.bottom + HEIGHT + 8 > innerHeight && r.top - HEIGHT - 8 > 0;
		place = { left: Math.max(8, Math.min(r.right - WIDTH, innerWidth - WIDTH - 8)), top: up ? r.top - 4 : r.bottom + 4, up };
		tab = token || transparent ? 'tokens' : 'custom';
		hsva = parseHsva(value);
		hex = toHex(hsvToRgb(hsva));
		opacity = tokenOpacity;
	}

	// ------------------------------------------------------------ tokens
	let opacity = $state(100);
	function pickToken(name: string) {
		onchange({ token: name, ...(opacity < 100 ? { opacity } : {}) });
		open = false;
	}

	// ------------------------------------------------------------ custom
	let hsva = $state<Hsva>({ h: 0, s: 0, v: 0, a: 1 });
	let hex = $state('');
	const rgb = $derived(hsvToRgb(hsva));
	const css = $derived(toHex(rgb, hsva.a));
	const hue = $derived(toHex(hsvToRgb({ h: hsva.h, s: 1, v: 1 })));

	/** Drag on a picker area; the change is written once, on release. */
	function drag(event: PointerEvent, update: (x: number, y: number) => void) {
		const el = event.currentTarget as HTMLElement;
		el.setPointerCapture(event.pointerId);
		const move = (e: PointerEvent) => {
			const r = el.getBoundingClientRect();
			update(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
			hex = toHex(hsvToRgb(hsva));
		};
		move(event);
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			onchange({ custom: css });
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	function applyHex() {
		const value = hex.trim().startsWith('#') ? hex.trim() : `#${hex.trim()}`;
		if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return;
		hsva = parseHsva(value);
		onchange({ custom: value.toLowerCase() });
	}
</script>

<div class="relative w-full min-w-0">
	<button
		bind:this={button}
		type="button"
		class="flex h-[30px] w-full min-w-0 items-center gap-2 rounded-control bg-control px-1.5 hover:bg-control-hover"
		aria-label={label}
		aria-expanded={open}
		onclick={toggle}
	>
		<span
			class="size-[18px] shrink-0 rounded-[5px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]"
			style="background: {transparent ? 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50% / 8px 8px' : value}"
		></span>
		<span class="min-w-0 flex-1 truncate text-left {token ? 'text-fg' : 'text-label'}">
			{token ?? (transparent ? m.style_none() : shownValue)}
		</span>
		<ChevronDown class="size-3 shrink-0 text-muted" />
	</button>

	{#if open}
		<button type="button" class="fixed inset-0 z-40 cursor-default" aria-label={m.action_close()} onclick={() => (open = false)}></button>
		<div
			class="fixed z-50 flex flex-col gap-2 rounded-popover bg-popover p-2 shadow-popover"
			style="left:{place.left}px; top:{place.top}px; width:{WIDTH}px; {place.up ? 'transform: translateY(-100%);' : ''}"
			role="dialog"
			tabindex="-1"
			aria-label={label}
			onkeydown={(e) => e.key === 'Escape' && (open = false)}
		>
			<div class="flex gap-0.5 rounded-control bg-control p-0.5" role="tablist">
				{#each [['tokens', m.color_tokens()], ['custom', m.color_custom()]] as [id, text] (id)}
					<button type="button" role="tab" aria-selected={tab === id} class="h-6 flex-1 rounded-[6px] text-[11px] {tab === id ? 'bg-control-active text-fg shadow-sm' : 'text-label'}" onclick={() => (tab = id as typeof tab)}>{text}</button>
				{/each}
			</div>

			{#if tab === 'tokens'}
				<input class="h-7 rounded-[6px] bg-control px-2 outline-none" placeholder={m.style_search_tokens()} bind:value={filter} />
				<div class="max-h-48 min-h-0 overflow-y-auto">
					{#each shown as option (option.name)}
						<button type="button" class="flex h-7 w-full items-center gap-2 rounded-[6px] px-1.5 hover:bg-control" onclick={() => pickToken(option.name)}>
							<span class="size-4 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]" style="background:{option.css}; opacity:{opacity / 100}"></span>
							<span class="min-w-0 flex-1 truncate text-left">{option.name}</span>
							{#if option.name === tokenName}<Check class="size-3 text-accent" />{/if}
						</button>
					{:else}
						<p class="px-2 py-2 text-muted">{m.style_no_tokens()}</p>
					{/each}
				</div>
				<label class="flex items-center gap-2 px-0.5 text-[11px] text-label">
					<span class="w-14 shrink-0">{m.label_opacity()}</span>
					<input type="range" min="5" max="100" step="5" class="min-w-0 flex-1 accent-[var(--cd-accent)]" bind:value={opacity}
						onchange={() => tokenName && pickToken(tokenName)} aria-label={m.label_opacity()} />
					<span class="w-8 text-right tabular-nums">{opacity}%</span>
				</label>
			{:else}
				<div
					class="relative h-36 cursor-crosshair touch-none rounded-[6px]"
					style="background: linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, {hue});"
					role="slider"
					tabindex="0"
					aria-label={m.color_saturation()}
					aria-valuenow={Math.round(hsva.s * 100)}
					onpointerdown={(e) => drag(e, (x, y) => (hsva = { ...hsva, s: x, v: 1 - y }))}
				>
					<span class="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style="left:{hsva.s * 100}%; top:{(1 - hsva.v) * 100}%"></span>
				</div>
				<div
					class="relative h-3 cursor-pointer touch-none rounded-full"
					style="background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);"
					role="slider"
					tabindex="0"
					aria-label={m.color_hue()}
					aria-valuenow={Math.round(hsva.h)}
					onpointerdown={(e) => drag(e, (x) => (hsva = { ...hsva, h: x * 360 }))}
				>
					<span class="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style="left:{(hsva.h / 360) * 100}%; background:{hue}"></span>
				</div>
				<div
					class="relative h-3 cursor-pointer touch-none rounded-full"
					style="background: linear-gradient(to right, transparent, {toHex(rgb)}), repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50% / 8px 8px;"
					role="slider"
					tabindex="0"
					aria-label={m.label_opacity()}
					aria-valuenow={Math.round(hsva.a * 100)}
					onpointerdown={(e) => drag(e, (x) => (hsva = { ...hsva, a: Math.round(x * 100) / 100 }))}
				>
					<span class="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style="left:{hsva.a * 100}%"></span>
				</div>
				<form class="flex gap-1" onsubmit={(e) => { e.preventDefault(); applyHex(); }}>
					<span class="size-7 shrink-0 rounded-[6px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]" style="background:{css}"></span>
					<input class="h-7 min-w-0 flex-1 rounded-[6px] bg-control px-2 font-mono text-[11px] uppercase outline-none" bind:value={hex} aria-label="Hex" />
					<span class="flex h-7 w-11 items-center justify-end text-[11px] text-label tabular-nums">{Math.round(hsva.a * 100)}%</span>
				</form>
			{/if}

			{#if onclear}
				<button type="button" class="h-7 rounded-[6px] px-1.5 text-left text-label hover:bg-control" onclick={() => { onclear?.(); open = false; }}>
					{m.style_remove_fill()}
				</button>
			{/if}
		</div>
	{/if}
</div>
