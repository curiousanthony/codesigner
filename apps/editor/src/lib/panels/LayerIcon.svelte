<script lang="ts">
	import type { LayerKind } from '@codesigner/protocol';
	import {
		Square,
		Rows3,
		Columns3,
		Grid2x2,
		Type,
		Image,
		Shapes,
		TextCursorInput,
		Link,
		MousePointerClick,
		Component
	} from '@lucide/svelte';

	let { kind, class: className = 'size-3' }: { kind: LayerKind; class?: string } = $props();

	const icons = {
		frame: Square,
		'stack-v': Rows3,
		'stack-h': Columns3,
		grid: Grid2x2,
		text: Type,
		image: Image,
		icon: Shapes,
		input: TextCursorInput,
		link: Link,
		button: MousePointerClick,
		component: Component
	} as const;

	const Icon = $derived(icons[kind] ?? Square);
</script>

<Icon class={className} strokeWidth={1.75} />
