<script lang="ts">
	import type { ElementInfo, ElementSource, EditOp, ComponentInfo } from '@codesigner/protocol';
	import {
		ArrowRight,
		ArrowDown,
		AlignStartVertical,
		AlignCenterVertical,
		AlignEndVertical,
		AlignStartHorizontal,
		AlignCenterHorizontal,
		AlignEndHorizontal,
		Code,
		Component,
		Square,
		SquareDashed,
		MousePointerClick,
		TriangleAlert,
		Repeat
	} from '@lucide/svelte';
	import { editor, type EditState, type PaddingSide } from '#lib/state/editor.svelte.js';
	import { invoke } from '#lib/api.js';
	import Section from '#lib/ui/Section.svelte';
	import Row from '#lib/ui/Row.svelte';
	import NumberField from '#lib/ui/NumberField.svelte';
	import SelectField from '#lib/ui/SelectField.svelte';
	import Segmented from '#lib/ui/Segmented.svelte';
	import TextField from '#lib/ui/TextField.svelte';
	import ColorField, { type ColorChoice, type ColorOption } from '#lib/ui/ColorField.svelte';
	import {
		activePrefix,
		alignValue,
		arbitraryPx,
		distributeValue,
		familyTokens,
		mergeEdits,
		opacityClass,
		parseToken,
		px,
		responsiveSet,
		paddingUtilities,
		paddingSides,
		coveredPaddingUtilities,
		DEFAULT_BREAKPOINTS,
		setFamily,
		sizeClasses,
		sizeMode,
		spacing,
		type ClassEdit,
		type Family,
		type SizeMode
	} from '#lib/style/tailwind-map.js';
	import { m } from '#lib/paraglide/messages.js';
	import { breakpointLabel } from '#lib/canvas/breakpoints.js';
	import { STATE_LABELS, STATE_PREFIX, buildCanvasSpec } from '#lib/state/component-canvas.js';

	const info = $derived(editor.selected);
	const multi = $derived(editor.selection.infos.length > 1);
	const frameWidth = $derived(editor.breakpoints.find((b) => b.id === editor.selection.frameId)?.width ?? 1280);
	const cls = $derived(info?.className ?? '');
	const c = $derived(info?.computed);

	// Source details (props, static/dynamic classes) for the selected layer.
	let source = $state<ElementSource | null>(null);
	let sourceKey = '';
	$effect(() => {
		const loc = info?.loc;
		const key = loc ? `${loc.file}:${loc.line}:${loc.column}:${info?.className}` : '';
		if (key === sourceKey) return;
		sourceKey = key;
		source = null;
		if (!loc || !editor.worktree) return;
		const worktree = editor.worktree;
		void invoke('source:inspect', worktree, { ...loc, tag: info?.componentTag ?? info?.tag }).then((s) => {
			if (sourceKey === key) source = s;
		});
	});

	const component = $derived.by((): ComponentInfo | null => {
		if (!info?.componentTag) return null;
		const tag = info.componentTag;
		return (
			editor.components.find((comp) => comp.exportedAs.includes(tag)) ??
			editor.components.find((comp) => comp.name === tag) ??
			editor.components.find((comp) => comp.file === info.definitionFile) ??
			null
		);
	});

	/** An instance of a component that takes no `class`: styling it here would write an ignored attribute. */
	const classless = $derived(info?.kind === 'instance' && !!component && component.acceptsClass === false);
	const isFlex = $derived(!!c && c.display.includes('flex'));
	const isGrid = $derived(!!c && c.display.includes('grid'));
	const hasLayout = $derived(isFlex || isGrid);
	const vertical = $derived(!!c && c.flexDirection.startsWith('column'));
	const isTextLike = $derived(!!info && (info.textEditable || /^(h[1-6]|p|span|label|a|button|li|strong|em|small)$/.test(info.tag) || !!source?.text));
	/** On the component canvas, a cell's root edits its variant (and state) in the tv() config. */
	const variantContext = $derived(editor.editingComponent && info?.context ? info.context : null);
	const statePrefix = $derived(variantContext?.state ? (STATE_PREFIX[variantContext.state as keyof typeof STATE_PREFIX] ?? '') : '');
	/** Families that follow the theme: under dark preview they're edited as `dark:` classes. */
	const THEMED = new Set<Family>(['background', 'textColor', 'borderColor']);
	/** Page elements: the state picked above (Hover…) and dark preview turn edits into variant classes on every breakpoint. */
	const pagePrefix = (family: Family) =>
		variantContext
			? ''
			: (editor.darkPreview && editor.tokens?.darkSelector && THEMED.has(family) ? 'dark:' : '') +
				(editor.editState !== 'default' ? STATE_PREFIX[editor.editState] : '');
	const prefixFor = (family: Family) => (variantContext ? statePrefix : pagePrefix(family) || activePrefix(cls, family, frameWidth));

	// ------------------------------------------------------------ apply
	/** The component's looks come from tv(): edits go to the variant's entry. Otherwise to its own markup. */
	const tvBacked = $derived(!!editor.editingComponent?.component.variants.length);

	function ops(edit: ClassEdit): EditOp[] {
		if (variantContext && editor.editingComponent && tvBacked) {
			const { state: _state, ...context } = variantContext;
			return [{ type: 'variant-classes', file: editor.editingComponent.component.file, context, remove: edit.remove, add: edit.add }];
		}
		return editor.selection.infos
			.filter((i): i is ElementInfo & { loc: NonNullable<ElementInfo['loc']> } => !!i.loc && i.editable)
			.map((i) => ({ type: 'classes', target: { ...i.loc, tag: i.componentTag ?? i.tag }, remove: edit.remove, add: edit.add }));
	}

	async function apply(label: string, edit: ClassEdit, coalesce = false) {
		if (edit.add.length === 0 && edit.remove.length === 0) return;
		// Variant cells share one source location: a preview would restyle every cell.
		if (!variantContext) void editor.previewClasses(edit.remove, edit.add);
		const ok = await editor.edit(label, ops(edit), { coalesce });
		if (!ok) editor.clearPreview();
	}

	function preview(edit: ClassEdit) {
		if (!variantContext) void editor.previewClasses(edit.remove, edit.add);
	}

	const frameWidths = $derived(editor.breakpoints.map((b) => b.width));
	const frame = $derived(editor.breakpoints.find((b) => b.id === editor.selection.frameId) ?? null);
	const primaryWidth = $derived(editor.breakpoints.find((b) => b.id === editor.primaryFrameId)?.width ?? frameWidth);
	/** A property has its own value on this breakpoint (it differs from what the primary breakpoint uses). */
	const overridden = (...families: Family[]) =>
		frameWidth !== primaryWidth && families.some((f) => activePrefix(cls, f, frameWidth) !== activePrefix(cls, f, primaryWidth));
	// Framer semantics: edits apply to this breakpoint and the smaller ones inheriting from it.
	const set = (family: Family, utilities: string[]) =>
		variantContext
			? setFamily(cls, family, utilities, statePrefix)
			: pagePrefix(family)
				? setFamily(cls, family, utilities, pagePrefix(family))
				: responsiveSet(cls, family, utilities, frameWidth, frameWidths);

	// --------------------------------------------------------- visibility
	const DISPLAY_UTILITIES = ['block', 'flex', 'grid', 'inline', 'inline-block', 'inline-flex', 'inline-grid', 'contents', 'table'];

	/** Hide on this breakpoint (and smaller ones); larger frames keep their current display. */
	function hideEdit(): ClassEdit {
		if (variantContext) return setFamily(cls, 'display', ['hidden'], statePrefix);
		const shown = c && DISPLAY_UTILITIES.includes(c.display) ? [c.display] : ['block'];
		return responsiveSet(cls, 'display', ['hidden'], frameWidth, frameWidths, DEFAULT_BREAKPOINTS, shown);
	}

	/** Show again: drop `hidden` here, restoring the display used by the next larger breakpoint if there is one. */
	function showEdit(): ClassEdit {
		const prefix = prefixFor('display');
		const hidden = familyTokens(cls, 'display', prefix).filter((t) => parseToken(t).utility === 'hidden');
		const above = Object.entries(DEFAULT_BREAKPOINTS)
			.filter(([name, width]) => width > (prefix ? DEFAULT_BREAKPOINTS[prefix.slice(0, -1)] : 0) && width <= Math.max(...frameWidths) && familyTokens(cls, 'display', `${name}:`).length)
			.sort((a, b) => a[1] - b[1])[0];
		const restore = above ? familyTokens(cls, 'display', `${above[0]}:`).map((t) => parseToken(t).utility).filter((u) => u !== 'hidden') : [];
		return { remove: hidden, add: restore.map((u) => prefix + u) };
	}

	// ------------------------------------------------------------ size
	const widthMode = $derived<SizeMode>(c ? sizeMode(cls, 'width', c.parentDisplay, c.parentFlexDirection, frameWidth) : 'auto');
	const heightMode = $derived<SizeMode>(c ? sizeMode(cls, 'height', c.parentDisplay, c.parentFlexDirection, frameWidth) : 'auto');

	const SIZE_MODES = $derived([
		{ value: 'fixed' as const, label: m.size_fixed() },
		{ value: 'fill' as const, label: m.size_fill() },
		{ value: 'fit' as const, label: m.size_fit() },
		{ value: 'relative' as const, label: m.size_relative() },
		{ value: 'viewport' as const, label: m.size_viewport() },
		{ value: 'auto' as const, label: m.size_auto() }
	]);

	function sizeEdit(axis: 'width' | 'height', mode: SizeMode, value: number): ClassEdit {
		if (!c) return { remove: [], add: [] };
		const family = axis === 'width' ? 'width' : 'height';
		const utilities = sizeClasses(mode, axis, value, c.parentDisplay, c.parentFlexDirection);
		const edit = set(family, utilities);
		// size-* sets both axes: keep the other axis when splitting it.
		const prefix = prefixFor(family);
		const sizeToken = familyTokens(cls, family, prefix).find((t) => parseToken(t).utility.startsWith('size-'));
		if (sizeToken) {
			const other = parseToken(sizeToken).utility.replace('size-', axis === 'width' ? 'h-' : 'w-');
			edit.add.push(prefix + other);
		}
		return edit;
	}

	function relativeValue(axis: 'width' | 'height'): number {
		if (!info || !c) return 0;
		const own = px(axis === 'width' ? c.width : c.height);
		return own;
	}

	// ------------------------------------------------------------ layout
	const DISTRIBUTE = $derived([
		{ value: 'start', label: m.layout_start() },
		{ value: 'center', label: m.layout_center() },
		{ value: 'end', label: m.layout_end() },
		{ value: 'between', label: m.layout_space_between() },
		{ value: 'around', label: m.layout_space_around() },
		{ value: 'evenly', label: m.layout_space_evenly() }
	]);

	const alignOptions = $derived(
		vertical
			? [
					{ value: 'start', label: m.layout_start(), icon: AlignStartVertical },
					{ value: 'center', label: m.layout_center(), icon: AlignCenterVertical },
					{ value: 'end', label: m.layout_end(), icon: AlignEndVertical }
				]
			: [
					{ value: 'start', label: m.layout_start(), icon: AlignStartHorizontal },
					{ value: 'center', label: m.layout_center(), icon: AlignCenterHorizontal },
					{ value: 'end', label: m.layout_end(), icon: AlignEndHorizontal }
				]
	);

	const LAYOUT_FAMILIES: Family[] = ['display', 'direction', 'justify', 'align', 'wrap', 'gap', 'gridCols'];

	function addLayout() {
		void apply(m.edit_add_layout(), mergeEdits(set('display', ['flex']), set('direction', ['flex-col']), set('gap', ['gap-2.5'])));
	}

	function removeLayout() {
		const prefix = prefixFor('display');
		const remove = LAYOUT_FAMILIES.flatMap((f) => familyTokens(cls, f, prefix));
		void apply(m.edit_remove_layout(), { remove, add: [] });
	}

	let paddingPerSide = $state(false);
	const padding = $derived(c?.padding ?? { top: 0, right: 0, bottom: 0, left: 0 });
	const uniformPadding = $derived(padding.top === padding.right && padding.right === padding.bottom && padding.bottom === padding.left);

	function paddingEdit(side: PaddingSide, value: number): ClassEdit {
		if (side === 'all') return set('padding', [spacing('p', value)]);
		// Expand shorthands to per-side classes so other sides keep their values.
		// Only the sides already set where this edit lands, plus this one: the rest keep inheriting.
		const covered = paddingSides(familyTokens(cls, 'padding', prefixFor('padding')));
		covered.add(side);
		return set('padding', coveredPaddingUtilities({ ...padding, [side]: value }, covered));
	}

	function setPadding(side: PaddingSide, value: number, coalesce: boolean) {
		void apply(m.edit_padding(), paddingEdit(side, value), coalesce);
	}

	// Canvas handles (padding / gap) edit through the same rules as the fields here.
	$effect(() => {
		const commands: NonNullable<typeof editor.styleCommands> = {
			padding: (side, value, commit) => (commit ? setPadding(side, value, false) : preview(paddingEdit(side, value))),
			gap: (value, commit) => (commit ? apply(m.edit_gap(), set('gap', [spacing('gap', value)])) : preview(set('gap', [spacing('gap', value)])))
		};
		editor.styleCommands = commands;
		// A panel replaced by a newer one (hot reload, remount) must not unregister the newer one's commands.
		return () => {
			if (editor.styleCommands === commands) editor.styleCommands = null;
		};
	});

	// ------------------------------------------------------------ styles
	const colorOptions = $derived.by((): ColorOption[] =>
		(editor.tokens?.tokens ?? [])
			.filter((t) => t.utility?.startsWith('bg-'))
			.map((t) => ({ name: t.utility!.slice(3), css: `var(${t.name})` }))
	);

	function tokenIn(family: Family, prefix: string, utilityPrefix: string): string | null {
		const token = familyTokens(cls, family, prefix)[0];
		if (!token) return null;
		const utility = parseToken(token).utility;
		return utility.startsWith(utilityPrefix) && !utility.includes('[') ? utility.slice(utilityPrefix.length) : null;
	}

	function colorUtility(prefix: string, choice: ColorChoice) {
		if ('token' in choice) return `${prefix}-${choice.token}${choice.opacity !== undefined && choice.opacity < 100 ? `/${choice.opacity}` : ''}`;
		const value = choice.custom.replace(/\s+/g, '_');
		return `${prefix}-[${value}]`;
	}

	const visible = $derived(c?.display !== 'none');
	const OVERFLOW = $derived([
		{ value: 'visible', label: m.overflow_visible() },
		{ value: 'hidden', label: m.overflow_hidden() },
		{ value: 'clip', label: m.overflow_clip() },
		{ value: 'auto', label: m.overflow_auto() },
		{ value: 'scroll', label: m.overflow_scroll() }
	]);
	const overflowValue = $derived((c?.overflow ?? 'visible').split(' ')[0]);

	const POSITIONS = $derived([
		{ value: 'static', label: m.position_static() },
		{ value: 'relative', label: m.position_relative() },
		{ value: 'absolute', label: m.position_absolute() },
		{ value: 'fixed', label: m.position_fixed() },
		{ value: 'sticky', label: m.position_sticky() }
	]);

	const RADII = ['none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full'];

	// ------------------------------------------------------------ text
	const FONT_SIZES = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'];
	const WEIGHTS = [
		['thin', '100'],
		['extralight', '200'],
		['light', '300'],
		['normal', '400'],
		['medium', '500'],
		['semibold', '600'],
		['bold', '700'],
		['extrabold', '800'],
		['black', '900']
	] as const;
	const weightName = $derived(WEIGHTS.find(([, w]) => w === String(Math.round(px(c?.fontWeight) / 100) * 100))?.[0] ?? 'normal');
	const sizeToken = $derived(tokenIn('fontSize', prefixFor('fontSize'), 'text-'));
	const textAlign = $derived((c?.textAlign ?? 'start').replace('start', 'left').replace('end', 'right'));

	const textColorOptions = $derived.by((): ColorOption[] =>
		(editor.tokens?.tokens ?? [])
			.filter((t) => t.utility?.startsWith('bg-'))
			.map((t) => ({ name: t.utility!.slice(3), css: `var(${t.name})` }))
	);

	function setText(text: string) {
		if (!info?.loc) return;
		void editor.edit(m.edit_text(), [{ type: 'text', target: { ...info.loc, tag: info.tag }, text }]);
	}

	// ------------------------------------------------------------ component props
	function attr(name: string) {
		return source?.attributes.find((a) => a.name === name) ?? null;
	}

	function setProp(name: string, value: string | boolean | null, kind?: 'string' | 'expression') {
		if (!info?.loc) return;
		void editor.edit(m.edit_prop({ name }), [
			{ type: 'attribute', target: { ...info.loc, tag: info.componentTag ?? info.tag }, name, value, kind }
		]);
	}

	/**
	 * Components open on their own canvas (variants, states, props side by side),
	 * unless they need data the canvas can't invent (a list of cards…): those are
	 * edited right here in the page, with the page's real data.
	 */
	function editComponent() {
		if (component && !buildCanvasSpec(component).missing.length) void editor.editComponent(component);
		else if (component?.file ?? info?.definitionFile) editor.editInPlace((component?.file ?? info?.definitionFile)!);
	}

	// ------------------------------------------------- component canvas
	let newVariant = $state('');
	const canvasComponent = $derived(editor.editingComponent?.component ?? null);
	const mainAxis = $derived(canvasComponent?.variants.find((g) => g.name === 'variant') ?? canvasComponent?.variants[0] ?? null);
	function addVariant(event: SubmitEvent) {
		event.preventDefault();
		const value = newVariant.trim().replace(/\s+/g, '-');
		if (!value || !mainAxis) return;
		newVariant = '';
		void editor.addVariant(mainAxis.name, value);
	}

	/** Shows the selected layer in the code panel (it follows the selection and highlights the tag). */
	function openInCode() {
		if (!info?.loc) return;
		editor.codeOpen = true;
	}
</script>

{#if canvasComponent}
	<div class="border-b border-divider px-4 py-3">
		<div class="flex items-center gap-2">
			<Component class="size-3.5 text-component" />
			<span class="flex-1 truncate font-semibold text-component">{canvasComponent.name}</span>
			<button type="button" class="rounded-control px-2 py-1 text-label hover:bg-control" onclick={() => editor.exitComponent()}>{m.component_done()}</button>
		</div>
		{#if !tvBacked}
			<p class="mt-2 rounded-control bg-component-tint px-2.5 py-1.5 text-[11px] text-component">{m.component_edits_master()}</p>
		{:else if variantContext}
			<p class="mt-2 rounded-control bg-component-tint px-2.5 py-1.5 text-component">
				{m.component_editing_variant({
					variant: Object.entries(variantContext).filter(([k]) => k !== 'state').map(([k, v]) => `${k}=${v}`).join(', ') || m.component_default(),
					state: variantContext.state ? STATE_LABELS[variantContext.state as keyof typeof STATE_LABELS] : m.component_state_default()
				})}
			</p>
		{/if}
		{#if mainAxis}
			<form class="mt-2 flex items-center gap-1.5" onsubmit={addVariant}>
				<input class="h-[28px] min-w-0 flex-1 rounded-control bg-control px-2 outline-none placeholder:text-muted" placeholder={m.component_new_variant({ axis: mainAxis.name })} bind:value={newVariant} />
				<button type="submit" class="h-[28px] rounded-control bg-component px-2.5 font-medium text-white disabled:opacity-50" disabled={!newVariant.trim()}>{m.component_add_variant()}</button>
			</form>
		{/if}
	</div>
{/if}

{#if !info}
	<div class="flex flex-col items-center gap-2 px-6 py-12 text-center text-muted">
		<MousePointerClick class="size-5" />
		<p>{m.style_empty()}</p>
		<p class="text-[11px] text-faint">{m.style_empty_hint()}</p>
	</div>
{:else}
	<!-- Selection header -->
	<div class="flex items-center gap-2 border-b border-divider px-4 py-3">
		<span class={info.kind === 'instance' ? 'text-component' : 'text-label'}>
			{#if info.kind === 'instance'}<Component class="size-3.5" />{:else}<Square class="size-3.5" />{/if}
		</span>
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<span class="truncate font-semibold {info.kind === 'instance' ? 'text-component' : 'text-fg-strong'}">
				{multi ? m.style_multi({ count: editor.selection.infos.length }) : info.name}
			</span>
			{#if info.loc}
				<button type="button" class="truncate text-left text-[11px] text-muted hover:text-accent" title={m.code_show()} onclick={openInCode}>
					{info.loc.file}:{info.loc.line}
				</button>
			{/if}
		</div>
		{#if info.repeatCount > 1 && !variantContext}
			<span class="flex items-center gap-1 rounded bg-control px-1.5 py-0.5 text-[10px] text-label" title={m.style_repeated_hint()}>
				<Repeat class="size-3" />×{info.repeatCount}
			</span>
		{/if}
		{#if info.editable && !editor.editingComponent && !multi}
			<button type="button" class="flex size-6 items-center justify-center rounded-md text-component hover:bg-component-tint" title={m.component_create_hint()} aria-label={m.component_create_title()} onclick={() => (editor.createComponentOpen = true)}>
				<Component class="size-3.5" />
			</button>
		{/if}
		<button type="button" class="flex size-6 items-center justify-center rounded-md text-label hover:bg-control" title={m.code_show()} aria-label={m.code_show()} onclick={openInCode}>
			<Code class="size-3.5" />
		</button>
	</div>

	{#if !info.editable}
		<div class="m-3 flex gap-2 rounded-control bg-warning/10 p-2.5 text-[11px] text-label">
			<TriangleAlert class="size-3.5 shrink-0 text-warning" />
			<span>{info.readonlyReason ?? m.style_readonly()}</span>
		</div>
	{/if}

	{#if info.editable && !variantContext && !editor.editingComponent && !classless}
		<div class="flex flex-col gap-2 border-b border-divider px-4 py-2.5">
			<Segmented
				options={[
					{ value: 'default', label: m.state_default() },
					{ value: 'hover', label: STATE_LABELS.hover },
					{ value: 'active', label: STATE_LABELS.active },
					{ value: 'focus', label: STATE_LABELS.focus }
				]}
				value={editor.editState}
				onchange={(v) => editor.setEditState(v as EditState)}
			/>
			{#if editor.editState !== 'default' || (editor.darkPreview && editor.tokens?.darkSelector)}
				<p class="rounded-control bg-accent-tint px-2.5 py-1.5 text-[11px] text-accent">
					{editor.editState !== 'default'
						? m.state_editing({ state: STATE_LABELS[editor.editState], prefix: STATE_PREFIX[editor.editState] })
						: m.state_dark_editing()}
				</p>
			{/if}
		</div>
	{/if}

	{#if source && source.dynamicClasses.length > 0 && !variantContext}
		<div class="mx-3 mt-3 rounded-control bg-control p-2 text-[11px] text-label">
			<p class="mb-1 font-medium text-fg">{m.style_dynamic_classes()}</p>
			{#each source.dynamicClasses as part (part)}
				<code class="block truncate font-mono text-[10.5px]" title={part}>{part}</code>
			{/each}
		</div>
	{/if}

	<!-- Component instance -->
	{#if info.kind === 'instance'}
		<Section title={component?.name ?? info.componentTag ?? m.component_title()}>
			{#each component?.variants ?? [] as group (group.name)}
				{@const current = attr(group.name)}
				<Row label={group.name[0].toUpperCase() + group.name.slice(1)}>
					<SelectField
						options={group.options.map((o) => ({ value: o, label: o + (o === group.default ? ` (${m.component_default()})` : '') }))}
						value={current?.kind === 'string' ? current.value : current ? null : group.default}
						placeholder={current?.kind === 'expression' ? `{${current.value}}` : '—'}
						onchange={(value) => setProp(group.name, value === group.default && !current ? null : value)}
					/>
				</Row>
			{/each}
			{#each (component?.props ?? []).filter((p) => !component?.variants.some((v) => v.name === p.name) && p.name !== 'class' && p.control !== 'snippet') as prop (prop.name)}
				{@const current = attr(prop.name)}
				{@const spread = source?.attributes.find((a) => a.kind === 'spread')}
				<Row label={prop.name} hint={prop.type ?? undefined}>
					{#if !current && spread}
						<code class="truncate rounded-control bg-control px-2 py-1.5 font-mono text-[10.5px] text-muted" title={m.component_from_spread()}>{spread.value}</code>
					{:else if current?.kind === 'expression'}
						<code class="truncate rounded-control bg-control px-2 py-1.5 font-mono text-[10.5px] text-label" title={current.value}>{`{${current.value}}`}</code>
					{:else if prop.control === 'boolean'}
						<Segmented
							options={[{ value: 'yes', label: m.yes() }, { value: 'no', label: m.no() }]}
							value={current ? (current.value === 'false' ? 'no' : 'yes') : prop.default === 'true' ? 'yes' : 'no'}
							onchange={(v) => setProp(prop.name, v === 'yes' ? true : null)}
						/>
					{:else if prop.control === 'enum' && prop.options}
						<SelectField options={prop.options.map((o) => ({ value: o, label: o }))} value={current?.value ?? null} onchange={(v) => setProp(prop.name, v)} />
					{:else if prop.control === 'text' || prop.control === 'link' || prop.control === 'number'}
						<TextField value={current?.value ?? ''} placeholder={prop.default?.replace(/^['"`]|['"`]$/g, '') ?? ''} oncommit={(v) => setProp(prop.name, v === '' ? null : v, prop.control === 'number' ? 'expression' : 'string')} />
					{:else}
						<span class="truncate text-[11px] text-muted" title={prop.type ?? undefined}>{m.component_unsupported()}</span>
					{/if}
				</Row>
			{/each}
			{#if info.definitionFile && !info.definitionFile.includes('node_modules')}
				<button type="button" class="mt-1 h-[30px] rounded-control bg-control hover:bg-control-hover" onclick={editComponent}>
					{m.component_edit()}
				</button>
			{/if}
		</Section>
	{/if}

	{#if c && frame && !frame.primary}
		<div class="mx-3 mt-2 flex items-center gap-2 rounded-control bg-accent-tint px-2.5 py-1.5 text-accent">
			<span class="size-1.5 shrink-0 rounded-full bg-accent"></span>
			<span class="min-w-0 flex-1 truncate">{m.style_breakpoint_scope({ name: breakpointLabel(frame) })}</span>
		</div>
	{/if}

	{#if c && classless}
		<div class="m-3 flex flex-col gap-2 rounded-control bg-component-tint p-2.5 text-[11px] text-component">
			<p>{m.style_classless({ name: component?.name ?? '' })}</p>
		</div>
	{:else if c}
		<!-- Position -->
		<Section title={m.section_position()}>
			<Row label={m.label_type()} overridden={overridden('position')}>
				<SelectField options={POSITIONS} value={c.position} onchange={(v) => apply(m.edit_position(), set('position', v === 'static' ? [] : [v]))} />
			</Row>
		</Section>

		<!-- Size -->
		<Section title={m.section_size()}>
			<Row label={m.label_width()} overridden={overridden('width')}>
				<NumberField
					value={Math.round(px(c.width))}
					min={0}
					label={m.label_width()}
					onpreview={(v) => preview(sizeEdit('width', 'fixed', v))}
					oncommit={(v, co) => apply(m.edit_width(), sizeEdit('width', 'fixed', v), co)}
				/>
				<SelectField compact options={SIZE_MODES} value={widthMode} label={m.label_width_mode()}
					onchange={(mode) => apply(m.edit_width(), sizeEdit('width', mode, mode === 'relative' ? 100 : relativeValue('width')))} />
			</Row>
			<Row label={m.label_height()} overridden={overridden('height')}>
				<NumberField
					value={Math.round(px(c.height))}
					min={0}
					label={m.label_height()}
					onpreview={(v) => preview(sizeEdit('height', 'fixed', v))}
					oncommit={(v, co) => apply(m.edit_height(), sizeEdit('height', 'fixed', v), co)}
				/>
				<SelectField compact options={SIZE_MODES} value={heightMode} label={m.label_height_mode()}
					onchange={(mode) => apply(m.edit_height(), sizeEdit('height', mode, mode === 'relative' ? 100 : relativeValue('height')))} />
			</Row>
			<Row label={m.label_min_max()} overridden={overridden('minWidth', 'maxWidth')}>
				<NumberField value={c.minWidth === '0px' || c.minWidth === 'auto' ? null : Math.round(px(c.minWidth))} placeholder={m.label_min_w()} min={0}
					oncommit={(v) => apply(m.edit_min_width(), set('minWidth', [arbitraryPx('min-w', v)]))} />
				<NumberField value={c.maxWidth === 'none' ? null : Math.round(px(c.maxWidth))} placeholder={m.label_max_w()} min={0}
					oncommit={(v) => apply(m.edit_max_width(), set('maxWidth', [arbitraryPx('max-w', v)]))} />
			</Row>
		</Section>

		<!-- Layout -->
		<Section title={m.section_layout()} action={hasLayout ? 'remove' : 'add'} onaction={hasLayout ? removeLayout : addLayout}>
			{#if hasLayout}
				<Row label={m.label_type()}>
					<Segmented
						options={[{ value: 'stack', label: m.layout_stack() }, { value: 'grid', label: m.layout_grid() }]}
						value={isGrid ? 'grid' : 'stack'}
						onchange={(v) => apply(m.edit_layout_type(), v === 'grid'
							? mergeEdits(set('display', ['grid']), set('direction', []), set('gridCols', ['grid-cols-2']))
							: mergeEdits(set('display', ['flex']), set('gridCols', []), set('direction', ['flex-col'])))}
					/>
				</Row>
				{#if isFlex}
					<Row label={m.label_direction()} overridden={overridden('direction')}>
						<Segmented
							iconOnly
							options={[{ value: 'row', label: m.layout_horizontal(), icon: ArrowRight }, { value: 'col', label: m.layout_vertical(), icon: ArrowDown }]}
							value={vertical ? 'col' : 'row'}
							onchange={(v) => apply(m.edit_direction(), set('direction', [v === 'col' ? 'flex-col' : 'flex-row']))}
						/>
					</Row>
					<Row label={m.label_distribute()} overridden={overridden('justify')}>
						<SelectField options={DISTRIBUTE} value={distributeValue(c.justifyContent)} onchange={(v) => apply(m.edit_distribute(), set('justify', [`justify-${v}`]))} />
					</Row>
					<Row label={m.label_align()} overridden={overridden('align')}>
						<Segmented iconOnly options={alignOptions} value={alignValue(c.alignItems)} onchange={(v) => apply(m.edit_align(), set('align', [`items-${v}`]))} />
					</Row>
					<Row label={m.label_wrap()} overridden={overridden('wrap')}>
						<Segmented
							options={[{ value: 'yes', label: m.yes() }, { value: 'no', label: m.no() }]}
							value={c.flexWrap === 'wrap' ? 'yes' : 'no'}
							onchange={(v) => apply(m.edit_wrap(), set('wrap', v === 'yes' ? ['flex-wrap'] : []))}
						/>
					</Row>
				{:else}
					<Row label={m.label_columns()} overridden={overridden('gridCols')}>
						<NumberField
							value={c.gridTemplateColumns === 'none' ? 1 : c.gridTemplateColumns.split(' ').length}
							min={1}
							max={12}
							oncommit={(v, co) => apply(m.edit_columns(), set('gridCols', [`grid-cols-${v}`]), co)}
						/>
					</Row>
				{/if}
				<Row label={m.label_gap()} overridden={overridden('gap')}>
					<NumberField
						value={Math.round(px(c.rowGap === 'normal' ? 0 : vertical ? c.rowGap : c.columnGap))}
						min={0}
						label={m.label_gap()}
						onpreview={(v) => preview(set('gap', [spacing('gap', v)]))}
						oncommit={(v, co) => apply(m.edit_gap(), set('gap', [spacing('gap', v)]), co)}
					/>
				</Row>
			{/if}
			{#if hasLayout || padding.top || padding.left}
				<Row label={m.label_padding()} overridden={overridden('padding')}>
					{#if paddingPerSide || !uniformPadding}
						<div class="grid w-full grid-cols-2 gap-1">
							{#each ['top', 'right', 'bottom', 'left'] as const as side (side)}
								<NumberField value={padding[side]} min={0} suffix={side[0].toUpperCase()} label={side}
									oncommit={(v, co) => setPadding(side, v, co)} />
							{/each}
						</div>
					{:else}
						<NumberField value={padding.top} min={0} label={m.label_padding()}
							onpreview={(v) => preview(set('padding', [spacing('p', v)]))}
							oncommit={(v, co) => setPadding('all', v, co)} />
					{/if}
					<button
						type="button"
						class="flex size-[30px] shrink-0 items-center justify-center rounded-control {paddingPerSide || !uniformPadding ? 'bg-control text-accent' : 'text-label hover:bg-control'}"
						title={m.label_padding_sides()}
						aria-label={m.label_padding_sides()}
						onclick={() => (paddingPerSide = !paddingPerSide)}
					>
						<SquareDashed class="size-3.5" />
					</button>
				</Row>
			{/if}
		</Section>

		<!-- Styles -->
		<Section title={m.section_styles()}>
			<Row label={m.label_opacity()} overridden={overridden('opacity')}>
				<NumberField value={Number(c.opacity)} min={0} max={1} step={0.05} precision={2} label={m.label_opacity()}
					onpreview={(v) => preview(set('opacity', v === 1 ? [] : [opacityClass(v)]))}
					oncommit={(v, co) => apply(m.edit_opacity(), set('opacity', v === 1 ? [] : [opacityClass(v)]), co)} />
			</Row>
			<Row label={m.label_visible()} overridden={overridden('display')}>
				<Segmented
					options={[{ value: 'yes', label: m.yes() }, { value: 'no', label: m.no() }]}
					value={visible ? 'yes' : 'no'}
					onchange={(v) => void apply(m.edit_visible(), v === 'no' ? hideEdit() : showEdit())}
				/>
			</Row>
			<Row label={m.label_fill()} overridden={overridden('background')}>
				<ColorField
					value={c.backgroundColor}
					token={tokenIn('background', prefixFor('background'), 'bg-')}
					options={colorOptions}
					label={m.label_fill()}
					onchange={(choice) => apply(m.edit_fill(), set('background', [colorUtility('bg', choice)]))}
					onclear={() => apply(m.edit_fill(), set('background', []))}
				/>
			</Row>
			<Row label={m.label_overflow()} overridden={overridden('overflow')}>
				<SelectField options={OVERFLOW} value={overflowValue} onchange={(v) => apply(m.edit_overflow(), set('overflow', v === 'visible' ? [] : [`overflow-${v}`]))} />
			</Row>
			<Row label={m.label_radius()} overridden={overridden('radius')}>
				<NumberField value={Math.round(px(c.borderRadius))} min={0}
					onpreview={(v) => preview(set('radius', [arbitraryPx('rounded', v)]))}
					oncommit={(v, co) => apply(m.edit_radius(), set('radius', [v === 0 ? 'rounded-none' : arbitraryPx('rounded', v)]), co)} />
				<SelectField compact options={RADII.map((r) => ({ value: r, label: r }))} value={tokenIn('radius', prefixFor('radius'), 'rounded-') ?? null} placeholder="—"
					onchange={(r) => apply(m.edit_radius(), set('radius', [`rounded-${r}`]))} />
			</Row>
			<Row label={m.label_border()} overridden={overridden('borderWidth', 'borderColor')}>
				<NumberField value={Math.round(px(c.borderWidth))} min={0} suffix="px"
					oncommit={(v) => apply(m.edit_border(), set('borderWidth', v === 0 ? [] : [v === 1 ? 'border' : `border-${v}`]))} />
				<ColorField
					value={c.borderColor}
					token={tokenIn('borderColor', prefixFor('borderColor'), 'border-')}
					options={colorOptions}
					label={m.label_border_color()}
					onchange={(choice) => apply(m.edit_border(), mergeEdits(set('borderColor', [colorUtility('border', choice)]), px(c.borderWidth) === 0 ? set('borderWidth', ['border']) : { remove: [], add: [] }))}
				/>
			</Row>
		</Section>

		<!-- Text -->
		{#if isTextLike}
			<Section title={m.section_text()}>
				{#if source?.text !== null && source?.text !== undefined && info.kind === 'element'}
					<Row label={m.label_content()}>
						<TextField value={source.text} oncommit={setText} />
					</Row>
				{/if}
				<Row label={m.label_font_size()} overridden={overridden('fontSize')}>
					<NumberField value={Math.round(px(c.fontSize))} min={1}
						oncommit={(v, co) => apply(m.edit_font_size(), set('fontSize', [arbitraryPx('text', v)]), co)} />
					<SelectField compact options={FONT_SIZES.map((s) => ({ value: s, label: s }))} value={sizeToken} placeholder="—"
						onchange={(s) => apply(m.edit_font_size(), set('fontSize', [`text-${s}`]))} />
				</Row>
				<Row label={m.label_weight()} overridden={overridden('fontWeight')}>
					<SelectField options={WEIGHTS.map(([name, w]) => ({ value: name, label: `${name[0].toUpperCase()}${name.slice(1)} · ${w}` }))} value={weightName}
						onchange={(w) => apply(m.edit_weight(), set('fontWeight', [`font-${w}`]))} />
				</Row>
				<Row label={m.label_color()} overridden={overridden('textColor')}>
					<ColorField value={c.color} token={tokenIn('textColor', prefixFor('textColor'), 'text-')} options={textColorOptions} label={m.label_color()}
						onchange={(choice) => apply(m.edit_text_color(), set('textColor', [colorUtility('text', choice)]))} />
				</Row>
				<Row label={m.label_align()} overridden={overridden('textAlign')}>
					<Segmented
						options={[{ value: 'left', label: m.align_left() }, { value: 'center', label: m.align_center() }, { value: 'right', label: m.align_right() }]}
						value={['left', 'center', 'right'].includes(textAlign) ? textAlign : 'left'}
						onchange={(v) => apply(m.edit_text_align(), set('textAlign', v === 'left' ? [] : [`text-${v}`]))}
					/>
				</Row>
			</Section>
		{/if}
	{/if}
{/if}
