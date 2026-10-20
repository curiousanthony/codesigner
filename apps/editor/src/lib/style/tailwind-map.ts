/**
 * Maps Framer-style controls to Tailwind classes and back.
 *
 * Reading uses the element's computed style (always right, even when a value
 * comes from a component's internals) plus its class tokens (to know *which*
 * class to change). Writing produces `{ remove, add }` class edits; the engine
 * canonicalizes arbitrary values (`gap-[12px]` → `gap-3`) and removes any
 * remaining conflicts using the project's Tailwind design system.
 */

export interface ClassEdit {
	remove: string[];
	add: string[];
}

export const DEFAULT_BREAKPOINTS: Record<string, number> = { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 };

/** Splits "md:hover:bg-x" → { variants: ["md","hover"], utility: "bg-x" } (brackets aware). */
export function parseToken(token: string): { variants: string[]; utility: string; prefix: string } {
	let depth = 0;
	let last = -1;
	for (let i = 0; i < token.length; i++) {
		const ch = token[i];
		if (ch === '[' || ch === '(') depth++;
		else if (ch === ']' || ch === ')') depth--;
		else if (ch === ':' && depth === 0) last = i;
	}
	const prefix = last < 0 ? '' : token.slice(0, last + 1);
	return { variants: prefix ? prefix.slice(0, -1).split(':') : [], utility: token.slice(last + 1).replace(/^!|!$/g, ''), prefix };
}

export type Family =
	| 'width'
	| 'height'
	| 'minWidth'
	| 'maxWidth'
	| 'minHeight'
	| 'maxHeight'
	| 'display'
	| 'direction'
	| 'justify'
	| 'align'
	| 'wrap'
	| 'gap'
	| 'padding'
	| 'position'
	| 'opacity'
	| 'background'
	| 'overflow'
	| 'radius'
	| 'borderWidth'
	| 'borderColor'
	| 'gridCols'
	| 'fontSize'
	| 'fontWeight'
	| 'textColor'
	| 'textAlign'
	| 'shadow'
	| 'blur'
	| 'backdropBlur'
	| 'fontFamily'
	| 'lineHeight'
	| 'letterSpacing'
	| 'textTransform'
	| 'fontStyle'
	| 'textDecoration'
	| 'top'
	| 'right'
	| 'bottom'
	| 'left'
	| 'inset';

const BG_NON_COLOR = /^bg-(clip|origin|fixed|local|scroll|repeat|no-repeat|cover|contain|auto|center|top|bottom|left|right|linear|radial|conic|gradient|none|blend|size|position)/;
const TEXT_SIZE = /^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d)/;
const TEXT_ALIGN = /^text-(left|center|right|justify|start|end)$/;
const FONT_WEIGHT = /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d)/;
const BORDER_WIDTH = /^border(-[xytrblse])?(-(\d+|\[[^\]]+\]))?$/;

const FAMILIES: Record<Family, (utility: string) => boolean> = {
	width: (u) => /^(w-|size-)/.test(u) || /^(flex-1|flex-auto|grow|grow-\d+|basis-.+)$/.test(u),
	height: (u) => /^(h-|size-)/.test(u),
	minWidth: (u) => u.startsWith('min-w-'),
	maxWidth: (u) => u.startsWith('max-w-'),
	minHeight: (u) => u.startsWith('min-h-'),
	maxHeight: (u) => u.startsWith('max-h-'),
	display: (u) => /^(flex|inline-flex|grid|inline-grid|block|inline-block|inline|hidden|contents|table)$/.test(u),
	direction: (u) => /^flex-(row|col)(-reverse)?$/.test(u),
	justify: (u) => /^justify-(start|end|center|between|around|evenly|stretch|normal)$/.test(u),
	align: (u) => /^items-(start|end|center|baseline|stretch)$/.test(u),
	wrap: (u) => /^flex-(wrap|nowrap|wrap-reverse)$/.test(u),
	gap: (u) => /^gap-/.test(u),
	padding: (u) => /^p[xytrblse]?-/.test(u),
	position: (u) => /^(static|relative|absolute|fixed|sticky)$/.test(u),
	opacity: (u) => u.startsWith('opacity-'),
	background: (u) => u.startsWith('bg-') && !BG_NON_COLOR.test(u),
	overflow: (u) => /^overflow-/.test(u),
	radius: (u) => /^rounded(-|$)/.test(u),
	borderWidth: (u) => BORDER_WIDTH.test(u),
	borderColor: (u) => u.startsWith('border-') && !BORDER_WIDTH.test(u) && !/^border-(solid|dashed|dotted|double|none|hidden|collapse|separate)$/.test(u),
	gridCols: (u) => u.startsWith('grid-cols-'),
	fontSize: (u) => TEXT_SIZE.test(u),
	fontWeight: (u) => FONT_WEIGHT.test(u),
	textColor: (u) => u.startsWith('text-') && !TEXT_SIZE.test(u) && !TEXT_ALIGN.test(u) && !/^text-(wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(u),
	textAlign: (u) => TEXT_ALIGN.test(u),
	// Sizes only: `shadow-black/20` is the shadow's color, a separate family.
	shadow: (u) => /^shadow(-(2xs|xs|sm|md|lg|xl|2xl|none|\[.+\]))?$/.test(u),
	blur: (u) => /^blur(-(none|xs|sm|md|lg|xl|2xl|3xl|\[.+\]))?$/.test(u),
	backdropBlur: (u) => /^backdrop-blur(-(none|xs|sm|md|lg|xl|2xl|3xl|\[.+\]))?$/.test(u),
	// font-<theme name>: anything font-* that isn't a weight or another font utility.
	fontFamily: (u) => u.startsWith('font-') && !FONT_WEIGHT.test(u) && !/^font-(stretch|features|variant)/.test(u),
	lineHeight: (u) => u.startsWith('leading-'),
	letterSpacing: (u) => u.startsWith('tracking-'),
	textTransform: (u) => /^(uppercase|lowercase|capitalize|normal-case)$/.test(u),
	fontStyle: (u) => /^(italic|not-italic)$/.test(u),
	textDecoration: (u) => /^(underline|overline|line-through|no-underline)$/.test(u),
	top: (u) => /^-?top-/.test(u),
	right: (u) => /^-?right-/.test(u),
	bottom: (u) => /^-?bottom-/.test(u),
	left: (u) => /^-?left-/.test(u),
	inset: (u) => /^-?inset-(?!shadow|ring)/.test(u)
};

/** Tailwind v4's default text sizes. */
export const TEXT_SIZES = [
	['xs', '0.75rem'],
	['sm', '0.875rem'],
	['base', '1rem'],
	['lg', '1.125rem'],
	['xl', '1.25rem'],
	['2xl', '1.5rem'],
	['3xl', '1.875rem'],
	['4xl', '2.25rem'],
	['5xl', '3rem'],
	['6xl', '3.75rem'],
	['7xl', '4.5rem'],
	['8xl', '6rem'],
	['9xl', '8rem']
] as const;

export const LEADINGS = [
	['none', 1],
	['tight', 1.25],
	['snug', 1.375],
	['normal', 1.5],
	['relaxed', 1.625],
	['loose', 2]
] as const;
export const TRACKINGS = [
	['tighter', -0.05],
	['tight', -0.025],
	['normal', 0],
	['wide', 0.025],
	['wider', 0.05],
	['widest', 0.1]
] as const;

/**
 * Whether a computed box-shadow casts a shadow: Tailwind v4 composes rings
 * (`0 0 0 1px`) and transparent placeholders into the same property.
 */
export function castsShadow(boxShadow: string): boolean {
	if (!boxShadow || boxShadow === 'none') return false;
	const layers = boxShadow.split(/,(?![^(]*\))/);
	return layers.some((layer) => {
		if (/rgba\([^)]*,\s*0\)|transparent/.test(layer)) return false;
		const [x = 0, y = 0, blur = 0] = (layer.replace(/\([^)]*\)/g, '').match(/-?[\d.]+px/g) ?? []).map(parseFloat);
		return x !== 0 || y !== 0 || blur !== 0;
	});
}

/** Shadow and blur presets (Tailwind v4 scales), smallest first. */
export const SHADOWS = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const;
export const BLURS = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const;

export const tokensOf = (className: string) => className.split(/\s+/).filter(Boolean);

export function isResponsiveVariant(variant: string, breakpoints = DEFAULT_BREAKPOINTS) {
	return variant in breakpoints;
}

/**
 * The variant prefix edits should target in a frame of `frameWidth`: the
 * largest responsive variant already used for this family that applies at
 * that width (so editing on Desktop changes `lg:gap-4`, not the base `gap-2`).
 */
export function activePrefix(className: string, family: Family, frameWidth: number, breakpoints = DEFAULT_BREAKPOINTS): string {
	let best = '';
	let bestWidth = -1;
	for (const token of tokensOf(className)) {
		const { variants, utility } = parseToken(token);
		if (variants.length !== 1 || !FAMILIES[family](utility)) continue;
		const width = breakpoints[variants[0]];
		if (width === undefined || width > frameWidth) continue;
		if (width > bestWidth) {
			best = `${variants[0]}:`;
			bestWidth = width;
		}
	}
	return best;
}

/** Tokens of a family under exactly `prefix` (e.g. all base `gap-*` tokens). */
export function familyTokens(className: string, family: Family, prefix = ''): string[] {
	return tokensOf(className).filter((token) => {
		const parsed = parseToken(token);
		return parsed.prefix === prefix && FAMILIES[family](parsed.utility);
	});
}

/** Replace a family's tokens (under the active prefix) with new utilities. */
export function setFamily(className: string, family: Family, utilities: string[], prefix: string): ClassEdit {
	const remove = familyTokens(className, family, prefix);
	const add = utilities.map((u) => prefix + u);
	return { remove: remove.filter((t) => !add.includes(t)), add: add.filter((t) => !remove.includes(t)) };
}

/**
 * The screen to put an override at so that a frame of width `below` keeps one
 * value and a frame of width `above` another: the largest screen in
 * (below, above], stepping down once when it sits exactly on `above`
 * (Tablet 810 / Desktop 1280 → `lg`, Phone 390 / Tablet 810 → `md`).
 */
export function screenBetween(below: number, above: number, breakpoints = DEFAULT_BREAKPOINTS): string | null {
	const inRange = Object.entries(breakpoints)
		.filter(([, width]) => width > below && width <= above)
		.sort((a, b) => b[1] - a[1]);
	if (inRange.length === 0) return null;
	if (inRange[0][1] === above && inRange.length > 1) return inRange[1][0];
	return inRange[0][0];
}

/**
 * Framer breakpoint semantics on mobile-first Tailwind: an edit made in a
 * frame changes that frame and the smaller frames inheriting the same value,
 * never the larger frames. When a larger frame shares the class being edited,
 * it is pinned to its current value with a responsive override.
 *
 * `frameWidths` are the canvas breakpoints (e.g. [1280, 810, 390]).
 */
export function responsiveSet(
	className: string,
	family: Family,
	utilities: string[],
	frameWidth: number,
	frameWidths: number[],
	breakpoints = DEFAULT_BREAKPOINTS,
	/** What larger frames show when no class sets it (e.g. their computed display), so they can be pinned. */
	inherited: string[] = []
): ClassEdit {
	const prefix = activePrefix(className, family, frameWidth, breakpoints);
	const edit = setFamily(className, family, utilities, prefix);
	const prefixWidth = prefix ? breakpoints[prefix.slice(0, -1)] : 0;
	// The next responsive variant of this family already used above the edited one.
	let nextUsed = Infinity;
	for (const token of tokensOf(className)) {
		const { variants, utility } = parseToken(token);
		if (variants.length !== 1 || !FAMILIES[family](utility)) continue;
		const width = breakpoints[variants[0]];
		if (width !== undefined && width > prefixWidth && width < nextUsed) nextUsed = width;
	}
	const sharing = frameWidths.filter((w) => w > frameWidth && w < nextUsed).sort((a, b) => a - b);
	if (sharing.length === 0) return edit;
	const own = familyTokens(className, family, prefix).map((t) => parseToken(t).utility);
	const previous = own.length ? own : inherited;
	// With no class to restore (the value came from a default), larger frames follow the edit.
	if (previous.length === 0) return edit;
	const screen = screenBetween(frameWidth, sharing[0], breakpoints);
	if (!screen) return edit;
	const pins = previous.map((u) => `${screen}:${u}`).filter((t) => !className.split(/\s+/).includes(t));
	return mergeEdits(edit, { remove: [], add: pins });
}

export function mergeEdits(...edits: ClassEdit[]): ClassEdit {
	const remove = new Set<string>();
	const add = new Set<string>();
	for (const edit of edits) {
		edit.remove.forEach((t) => {
			remove.add(t);
			add.delete(t);
		});
		edit.add.forEach((t) => {
			add.add(t);
			remove.delete(t);
		});
	}
	return { remove: [...remove], add: [...add] };
}

// ------------------------------------------------------------ values

export const px = (value: string | number | null | undefined): number => {
	if (typeof value === 'number') return value;
	const n = parseFloat(value ?? '');
	return Number.isFinite(n) ? n : 0;
};

/** Spacing utility for a px value: scale step when it's a multiple of 2px (0.5 step), else arbitrary. */
export function spacing(prefix: string, value: number): string {
	if (value < 0) return `-${spacing(prefix, -value)}`;
	const steps = value / 4;
	if (Number.isInteger(steps * 2)) return `${prefix}-${steps}`;
	return `${prefix}-[${Math.round(value * 100) / 100}px]`;
}

/** Fewest padding utilities for four sides, the way they'd be written by hand (`px-8 pt-14 pb-8`). */
export function paddingUtilities(sides: { top: number; right: number; bottom: number; left: number }): string[] {
	const { top, right, bottom, left } = sides;
	if (top === right && right === bottom && bottom === left) return [spacing('p', top)];
	const x = left === right;
	const y = top === bottom;
	return [
		...(x ? [spacing('px', left)] : []),
		...(y ? [spacing('py', top)] : [spacing('pt', top), spacing('pb', bottom)]),
		...(x ? [] : [spacing('pl', left), spacing('pr', right)])
	];
}

export type Side = 'top' | 'right' | 'bottom' | 'left';
const SIDES_OF: Record<string, Side[]> = {
	p: ['top', 'right', 'bottom', 'left'],
	px: ['left', 'right'],
	py: ['top', 'bottom'],
	pt: ['top'],
	pr: ['right'],
	pb: ['bottom'],
	pl: ['left'],
	ps: ['left'],
	pe: ['right']
};

/** Sides that padding tokens set (`px-6` → left and right). */
export function paddingSides(tokens: string[]): Set<Side> {
	const out = new Set<Side>();
	for (const token of tokens) for (const side of SIDES_OF[parseToken(token).utility.split('-')[0]] ?? []) out.add(side);
	return out;
}

/**
 * Padding utilities for only the `covered` sides (the others keep inheriting):
 * editing the left of `sm:px-6` gives `sm:pl-11 sm:pr-6`, not all four sides.
 */
export function coveredPaddingUtilities(values: Record<Side, number>, covered: Set<Side>): string[] {
	if (covered.size === 4) return paddingUtilities(values);
	const out: string[] = [];
	const pair = (a: Side, b: Side, both: string, one: Record<Side, string>) => {
		if (covered.has(a) && covered.has(b) && values[a] === values[b]) out.push(spacing(both, values[a]));
		else for (const s of [a, b]) if (covered.has(s)) out.push(spacing(one[s], values[s]));
	};
	const one = { top: 'pt', bottom: 'pb', left: 'pl', right: 'pr' };
	pair('left', 'right', 'px', one);
	pair('top', 'bottom', 'py', one);
	return out;
}

/** Arbitrary px value utility (the engine canonicalizes it when a theme step matches). */
export const arbitraryPx = (prefix: string, value: number) => `${prefix}-[${Math.round(value * 100) / 100}px]`;

export type SizeMode = 'fixed' | 'fill' | 'fit' | 'relative' | 'viewport' | 'auto';

/** Reads Framer's sizing mode for an axis from classes and layout context. */
export function sizeMode(className: string, axis: 'width' | 'height', parentDisplay: string, parentDirection: string, frameWidth: number): SizeMode {
	const family = axis === 'width' ? 'width' : 'height';
	const prefix = activePrefix(className, family, frameWidth);
	const tokens = familyTokens(className, family, prefix).map((t) => parseToken(t).utility);
	const mainAxis = parentDisplay.includes('flex') && (axis === 'width') === !parentDirection.startsWith('column');
	for (const u of tokens) {
		if (/^(flex-1|flex-auto|grow|grow-\d+|basis-.+)$/.test(u)) return mainAxis ? 'fill' : 'fixed';
		const value = u.replace(/^(w|h|size)-/, '');
		if (value === 'full') return 'fill';
		if (value === 'fit' || value === 'auto' || value === 'max' || value === 'min') return 'fit';
		if (/^(screen|svh|dvh|lvh|svw|dvw|lvw|\[\d+(\.\d+)?v[hw]\])$/.test(value)) return 'viewport';
		if (/^\d+\/\d+$/.test(value) || /^\[\d+(\.\d+)?%\]$/.test(value)) return 'relative';
		return 'fixed';
	}
	return 'auto';
}

export function sizeClasses(mode: SizeMode, axis: 'width' | 'height', value: number, parentDisplay: string, parentDirection: string): string[] {
	const p = axis === 'width' ? 'w' : 'h';
	const mainAxis = parentDisplay.includes('flex') && (axis === 'width') === !parentDirection.startsWith('column');
	switch (mode) {
		case 'fixed':
			return [arbitraryPx(p, value)];
		case 'fill':
			return mainAxis ? ['flex-1'] : [`${p}-full`];
		case 'fit':
			return [`${p}-fit`];
		case 'relative':
			return [`${p}-[${Math.round(value)}%]`];
		case 'viewport':
			return [axis === 'width' ? 'w-screen' : 'h-svh'];
		default:
			return [];
	}
}

export const JUSTIFY: Record<string, string> = {
	'flex-start': 'justify-start',
	start: 'justify-start',
	normal: 'justify-start',
	center: 'justify-center',
	'flex-end': 'justify-end',
	end: 'justify-end',
	'space-between': 'justify-between',
	'space-around': 'justify-around',
	'space-evenly': 'justify-evenly'
};

export const ALIGN: Record<string, string> = {
	'flex-start': 'items-start',
	start: 'items-start',
	center: 'items-center',
	'flex-end': 'items-end',
	end: 'items-end',
	stretch: 'items-stretch',
	normal: 'items-stretch',
	baseline: 'items-baseline'
};

export function distributeValue(justifyContent: string): string {
	return (JUSTIFY[justifyContent] ?? 'justify-start').replace('justify-', '');
}

export function alignValue(alignItems: string): string {
	return (ALIGN[alignItems] ?? 'items-stretch').replace('items-', '');
}

/** Radius px → utility, preferring theme steps the project defines. */
export function radiusClass(value: number, themeRadii: Record<string, number> = {}): string {
	if (value === 0) return 'rounded-none';
	if (value >= 9999) return 'rounded-full';
	for (const [name, size] of Object.entries(themeRadii)) if (Math.abs(size - value) < 0.5) return name === 'DEFAULT' ? 'rounded' : `rounded-${name}`;
	return arbitraryPx('rounded', value);
}

export function opacityClass(value: number): string {
	const pct = Math.round(value * 100);
	return pct % 5 === 0 ? `opacity-${pct}` : `opacity-[${value}]`;
}

/** The sides an offset is written for (`right-4`, `inset-x-0` → left and right), and whether an `inset-*` shorthand writes some. */
export function pinnedSides(utilities: string[]): { pinned: Set<Side>; shorthand: boolean } {
	const pinned = new Set<Side>();
	let shorthand = false;
	for (const u of utilities) {
		const m = /^-?(top|right|bottom|left|inset(?:-[xy])?)-(?!shadow|ring)/.exec(u);
		if (!m) continue;
		const sides: Side[] = m[1] === 'inset' ? ['top', 'right', 'bottom', 'left'] : m[1] === 'inset-x' ? ['left', 'right'] : m[1] === 'inset-y' ? ['top', 'bottom'] : [m[1] as Side];
		sides.forEach((side) => pinned.add(side));
		shorthand ||= m[1].startsWith('inset');
	}
	return { pinned, shorthand };
}

/**
 * Offsets of a positioned layer moved by (dx, dy), the way Framer pins work:
 * a side written in the classes (`right-4`, or an `inset-*` shorthand) follows
 * the move, and an axis with no side written gets `left` / `top`. Returns the
 * utility for each side to write (from `inset`, the resolved px offsets), and
 * whether `inset-*` shorthands must go (they're written out side by side).
 */
export function moveOffsets(utilities: string[], inset: Record<Side, number>, dx: number, dy: number): { sides: Partial<Record<Side, string>>; dropInset: boolean } {
	const { pinned, shorthand: dropInset } = pinnedSides(utilities);
	if (!pinned.has('left') && !pinned.has('right')) pinned.add('left');
	if (!pinned.has('top') && !pinned.has('bottom')) pinned.add('top');
	const delta: Record<Side, number> = { top: dy, right: -dx, bottom: -dy, left: dx };
	const sides: Partial<Record<Side, string>> = {};
	for (const side of pinned) {
		// Written out when the shorthand goes, else only the sides the move changes.
		if (delta[side] !== 0 || dropInset) sides[side] = spacing(side, Math.round(inset[side] + delta[side]));
	}
	return { sides, dropInset };
}
