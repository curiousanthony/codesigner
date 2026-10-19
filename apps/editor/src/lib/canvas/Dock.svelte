<script lang="ts">
	import { MousePointer2, Hand, MessageCircle, Moon, Sun, ChevronDown, MousePointerClick } from '@lucide/svelte';
	import { editor } from '#lib/state/editor.svelte.js';
	import IconButton from '#lib/ui/IconButton.svelte';
	import { m } from '#lib/paraglide/messages.js';

	type Props = {
		zoomIn: () => void;
		zoomOut: () => void;
		zoomTo: (scale: number) => void;
		zoomToFit: () => void;
		zoomToSelection: () => void;
	};

	let { zoomIn, zoomOut, zoomTo, zoomToFit, zoomToSelection }: Props = $props();
	let menuOpen = $state(false);

	const percent = $derived(Math.round(editor.camera.scale * 100));
	const interact = $derived(editor.mode === 'interact');
</script>

<div
	class="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-dock bg-panel p-[5px] shadow-dock"
	role="toolbar"
	aria-label={m.dock_label()}
>
	<IconButton label={m.tool_select()} active={editor.tool === 'select' && !interact} onclick={() => { editor.setTool('select'); editor.setMode('design'); }}>
		<MousePointer2 class="size-4" strokeWidth={1.75} />
	</IconButton>
	<IconButton label={m.tool_hand()} active={editor.tool === 'hand'} onclick={() => (editor.tool = 'hand')}>
		<Hand class="size-4" strokeWidth={1.75} />
	</IconButton>
	<IconButton label={m.tool_interact()} active={interact} onclick={() => editor.setMode(interact ? 'design' : 'interact')}>
		<MousePointerClick class="size-4" strokeWidth={1.75} />
	</IconButton>
	<IconButton label={m.tool_comment()} active={editor.tool === 'comment'} onclick={() => editor.setTool(editor.tool === 'comment' ? 'select' : 'comment')}>
		<MessageCircle class="size-4" strokeWidth={1.75} />
	</IconButton>
	<IconButton label={m.tool_theme()} active={editor.darkPreview} onclick={() => editor.setDarkPreview(!editor.darkPreview)}>
		{#if editor.darkPreview}<Sun class="size-4" strokeWidth={1.75} />{:else}<Moon class="size-4" strokeWidth={1.75} />{/if}
	</IconButton>

	<div class="relative">
		<button
			type="button"
			class="flex h-[30px] w-[70px] items-center justify-between rounded-control bg-control px-2 tabular-nums hover:bg-control-hover"
			aria-haspopup="menu"
			aria-expanded={menuOpen}
			onclick={() => (menuOpen = !menuOpen)}
		>
			{percent}%
			<ChevronDown class="size-3 text-muted" />
		</button>
		{#if menuOpen}
			<div
				class="absolute bottom-full left-1/2 mb-2 w-44 -translate-x-1/2 rounded-popover bg-popover p-1 shadow-popover"
				role="menu"
				tabindex="-1"
				onmouseleave={() => (menuOpen = false)}
			>
				{#each [
					{ label: m.zoom_in(), keys: '⌘+', run: zoomIn },
					{ label: m.zoom_out(), keys: '⌘−', run: zoomOut },
					{ label: m.zoom_100(), keys: '⌘0', run: () => zoomTo(1) },
					{ label: m.zoom_fit(), keys: '⌘1', run: zoomToFit },
					{ label: m.zoom_selection(), keys: '⌘2', run: zoomToSelection },
					{ label: '50%', keys: '', run: () => zoomTo(0.5) },
					{ label: '200%', keys: '', run: () => zoomTo(2) }
				] as item (item.label)}
					<button
						type="button"
						role="menuitem"
						class="flex h-[30px] w-full items-center justify-between rounded-[6px] px-2.5 hover:bg-accent hover:text-white"
						onclick={() => {
							item.run();
							menuOpen = false;
						}}
					>
						<span>{item.label}</span>
						<span class="opacity-60">{item.keys}</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
