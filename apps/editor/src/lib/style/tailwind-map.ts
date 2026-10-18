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
	| 'shadow';

const BG_NON_COLOR = /^bg-(clip|origin|fixed|local|scroll|repeat|no-repeat|cover|contain|auto|center|top|bottom|left|right|linear|radial|conic|gradient|none|blend|size|position)/;
const TEXT_SIZE = /^text-(xs|sm|base|lg|xl|[2-9]xl|\[\d)/;
const TEXT_ALIGN = /^text-(left|center|right|justify|start|end)$/;
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
	fontWeight: (u) => /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d)/.test(u),
	textColor: (u) => u.startsWith('text-') && !TEXT_SIZE.test(u) && !TEXT_ALIGN.test(u) && !/^text-(wrap|nowrap|balance|pretty|ellipsis|clip)$/.test(u),
	textAlign: (u) => TEXT_ALIGN.test(u),
	shadow: (u) => /^shadow(-|$)/.test(u)
};

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
