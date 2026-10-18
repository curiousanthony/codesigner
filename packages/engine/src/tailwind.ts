import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { twMerge } from 'tailwind-merge';

/** The subset of Tailwind v4's (unstable) design system API we rely on. */
export interface DesignSystem {
	candidatesToCss(candidates: string[]): (string | null)[];
	candidatesToAst(candidates: string[]): AstNode[][];
	getClassOrder(candidates: string[]): [string, bigint | null][];
	canonicalizeCandidates?(candidates: string[], options?: { rem?: number }): string[];
	resolveThemeValue(path: string): string | undefined;
}

type AstNode = { kind: string; property?: string; name?: string; nodes?: AstNode[] };

type LoadDesignSystem = (css: string, options: { base: string }) => Promise<DesignSystem>;

/** Splits a class candidate into its variant prefix ("md:hover:") and the utility ("bg-primary/90"). */
export function splitVariants(candidate: string): { variants: string; utility: string } {
	let depth = 0;
	let last = -1;
	for (let i = 0; i < candidate.length; i++) {
		const ch = candidate[i];
		if (ch === '[' || ch === '(') depth++;
		else if (ch === ']' || ch === ')') depth--;
		else if (ch === ':' && depth === 0) last = i;
	}
	return last < 0
		? { variants: '', utility: candidate }
		: { variants: candidate.slice(0, last + 1), utility: candidate.slice(last + 1) };
}

/** Shorthands set several longhands; setting one must remove the others. */
const EXPAND: Record<string, string[]> = {
	padding: ['padding-inline', 'padding-block', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-inline-start', 'padding-inline-end'],
	margin: ['margin-inline', 'margin-block', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-inline-start', 'margin-inline-end'],
	'padding-inline': ['padding-left', 'padding-right', 'padding-inline-start', 'padding-inline-end'],
	'padding-block': ['padding-top', 'padding-bottom'],
	'margin-inline': ['margin-left', 'margin-right', 'margin-inline-start', 'margin-inline-end'],
	'margin-block': ['margin-top', 'margin-bottom'],
	gap: ['column-gap', 'row-gap'],
	inset: ['top', 'right', 'bottom', 'left', 'inset-inline', 'inset-block'],
	'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius', 'border-start-start-radius', 'border-start-end-radius', 'border-end-start-radius', 'border-end-end-radius'],
	'border-width': ['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-inline-width', 'border-block-width'],
	'border-color': ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'border-inline-color', 'border-block-color'],
	overflow: ['overflow-x', 'overflow-y']
};

/**
 * Wraps the project's Tailwind design system: class validation, conflict
 * detection by CSS property, canonical ordering and preview CSS. Falls back to
 * tailwind-merge when the design system can't be loaded.
 */
export class TailwindEngine {
	private ds: DesignSystem | null = null;
	private loading: Promise<DesignSystem | null> | null = null;
	private propsCache = new Map<string, Set<string>>();
	private loadedFrom: string | null = null;
	error: string | null = null;

	constructor(
		private readonly root: string,
		private readonly cssEntry: string | null
	) {}

	async load(): Promise<DesignSystem | null> {
		if (this.ds) return this.ds;
		if (!this.loading) this.loading = this.doLoad();
		return this.loading;
	}

	/** Forget the cached design system (after the CSS entry or its imports change). */
	invalidate() {
		this.ds = null;
		this.loading = null;
		this.propsCache.clear();
	}

	private async doLoad(): Promise<DesignSystem | null> {
		if (!this.cssEntry) return null;
		const cssPath = join(this.root, this.cssEntry);
		if (!existsSync(cssPath)) return null;
		try {
			const load = await this.resolveLoader();
			const ds = await load(readFileSync(cssPath, 'utf8'), { base: dirname(cssPath) });
			this.ds = ds;
			this.error = null;
			return ds;
		} catch (error) {
			this.error = (error as Error).message;
			return null;
		}
	}

	/** Prefer the project's own @tailwindcss/node so behaviour matches its dev server. */
	private async resolveLoader(): Promise<LoadDesignSystem> {
		const candidates = [join(this.root, 'package.json'), import.meta.url];
		for (const from of candidates) {
			try {
				const resolved = createRequire(from).resolve('@tailwindcss/node');
				const mod = await import(pathToFileURL(resolved).href);
				if (typeof mod.__unstable__loadDesignSystem === 'function') {
					this.loadedFrom = resolved;
					return mod.__unstable__loadDesignSystem as LoadDesignSystem;
				}
			} catch {
				// try the next location
			}
		}
		throw new Error('Could not load @tailwindcss/node');
	}

	get source() {
		return this.loadedFrom;
	}

	/** CSS properties a candidate sets, ignoring Tailwind's internal --tw-* variables. */
	propertiesOf(candidate: string): Set<string> {
		const cached = this.propsCache.get(candidate);
		if (cached) return cached;
		const out = new Set<string>();
		if (this.ds) {
			const visit = (node: AstNode) => {
				if (node.kind === 'at-rule' && node.name === '@property') return;
				if (node.kind === 'declaration' && node.property && !node.property.startsWith('--tw-')) out.add(node.property);
				node.nodes?.forEach(visit);
			};
			try {
				this.ds.candidatesToAst([candidate])[0]?.forEach(visit);
			} catch {
				// invalid candidate
			}
		}
		this.propsCache.set(candidate, out);
		return out;
	}

	private expanded(props: Set<string>): Set<string> {
		const out = new Set(props);
		for (const p of props) for (const longhand of EXPAND[p] ?? []) out.add(longhand);
		return out;
	}

	isValid(candidate: string): boolean {
		if (!this.ds) return true;
		return this.ds.candidatesToCss([candidate])[0] !== null;
	}

	/** Prefers theme-scale classes (`gap-[12px]` → `gap-3`) but avoids fractional scale values like `w-59.25`. */
	canonicalize(candidate: string): string {
		const canonical = this.ds?.canonicalizeCandidates?.([candidate], { rem: 16 })[0];
		if (!canonical || canonical === candidate) return candidate;
		const { utility } = splitVariants(canonical);
		const fraction = utility.match(/-(\d+)\.(\d+)$/);
		if (fraction && fraction[2] !== '5') return candidate;
		return canonical;
	}

	/**
	 * Existing tokens that `added` overrides: same variant prefix and an
	 * overlapping set of CSS properties (expanded through shorthands).
	 */
	conflicts(existing: string[], added: string[]): string[] {
		if (!this.ds) {
			const merged = new Set(twMerge([...existing, ...added].join(' ')).split(/\s+/));
			return existing.filter((t) => !merged.has(t) && !added.includes(t));
		}
		const out = new Set<string>();
		for (const add of added) {
			const { variants } = splitVariants(add);
			const addProps = this.propertiesOf(add);
			if (addProps.size === 0) continue;
			const addExpanded = this.expanded(addProps);
			// text-* sizes set line-height only as a fallback (leading-* still wins).
			if (addProps.has('font-size')) addExpanded.delete('line-height');
			for (const token of existing) {
				if (token === add || splitVariants(token).variants !== variants) continue;
				const props = new Set(this.propertiesOf(token));
				if (addProps.has('font-size') && props.has('font-size')) props.delete('line-height');
				// A token conflicts if `add` fully covers what it sets (e.g. p-4 covers px-2),
				// or if they set exactly the same properties (gap-1 vs gap-3).
				if (props.size === 0) continue;
				const covered = [...props].every((p) => addExpanded.has(p));
				if (covered) out.add(token);
			}
		}
		return [...out];
	}

	/** Canonical Tailwind order; non-Tailwind classes return null. */
	order(candidates: string[]): Map<string, bigint | null> {
		if (!this.ds) return new Map(candidates.map((c) => [c, null]));
		return new Map(this.ds.getClassOrder(candidates));
	}

	/** CSS for candidates the page may not have compiled yet (optimistic previews). */
	css(candidates: string[]): string {
		if (!this.ds) return '';
		return this.ds
			.candidatesToCss(candidates)
			.filter((c): c is string => c !== null)
			.join('\n');
	}
}
