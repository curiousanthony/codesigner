import postcss, { type Declaration, type Root } from 'postcss';
import type { DesignToken, DesignTokens, TokenEdit } from '@codesigner/protocol';

const DARK_SELECTORS = ['.dark', ':root.dark', 'html.dark', '[data-theme="dark"]', "[data-theme='dark']", ':root[data-theme="dark"]'];
const LIGHT_SELECTORS = [':root', 'html', ':host', ':root, :host'];

const COLOR_RE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color|color-mix|hwb)\(|transparent$|currentcolor$|white$|black$)/i;

function classify(name: string, value: string): DesignToken['type'] {
	if (name.startsWith('--color-') || COLOR_RE.test(value.trim())) return 'color';
	if (name.startsWith('--shadow') || /\d+px\s+\d+px/.test(value)) return 'shadow';
	if (name.startsWith('--font') && !/^\d/.test(value)) return 'font';
	if (/^-?[\d.]+(px|rem|em|%|vh|vw|ch)$/.test(value.trim()) || name.startsWith('--radius') || name.startsWith('--spacing')) return 'length';
	if (/^-?[\d.]+$/.test(value.trim())) return 'number';
	return 'other';
}

const aliasOf = (value: string | null) => value?.match(/^\s*var\(\s*(--[\w-]+)\s*\)\s*$/)?.[1] ?? null;

/** Tailwind namespace → utility prefix (for display: --color-primary → bg-primary / text-primary). */
function utilityFor(name: string): string | null {
	const m = name.match(/^--(color|radius|shadow|font|text|spacing|breakpoint|container|leading|tracking|font-weight)-(.+)$/);
	if (!m) return null;
	const [, ns, rest] = m;
	switch (ns) {
		case 'color':
			return `bg-${rest}`;
		case 'radius':
			return `rounded-${rest}`;
		case 'shadow':
			return `shadow-${rest}`;
		case 'font':
			return `font-${rest}`;
		case 'text':
			return rest.includes('--') ? null : `text-${rest}`;
		case 'breakpoint':
			return `${rest}:`;
		default:
			return `${ns}-${rest}`;
	}
}

function precedingComment(decl: Declaration): string | null {
	const prev = decl.prev();
	if (prev?.type === 'comment') return prev.text.trim().split('\n')[0].slice(0, 120);
	return null;
}

export function parseTokens(css: string, file: string | null): DesignTokens {
	const root = postcss.parse(css);
	const map = new Map<string, DesignToken>();
	let darkSelector: string | null = null;
	let group: string | null = null;

	const upsert = (decl: Declaration, scope: string, dark: boolean) => {
		let token = map.get(decl.prop);
		if (!token) {
			token = {
				name: decl.prop,
				value: null,
				darkValue: null,
				type: 'other',
				alias: null,
				darkAlias: null,
				scopes: [],
				utility: null,
				description: precedingComment(decl),
				group
			};
			map.set(decl.prop, token);
		}
		if (!token.scopes.includes(scope)) token.scopes.push(scope);
		if (dark) {
			token.darkValue = decl.value;
			token.darkAlias = aliasOf(decl.value);
		} else if (scope.startsWith('@theme')) {
			token.utility = utilityFor(decl.prop);
			if (token.value === null) {
				token.value = decl.value;
				token.alias = aliasOf(decl.value);
			}
		} else {
			token.value = decl.value;
			token.alias = aliasOf(decl.value);
		}
		if (token.type === 'other' || token.type === 'number') token.type = classify(decl.prop, decl.value);
	};

	root.walk((node) => {
		if (node.type === 'comment' && node.parent?.type === 'rule') {
			const text = node.text.trim();
			if (text.length < 60 && !text.includes('\n')) group = text.replace(/[—–-]\s.*$/, '').trim();
		}
		if (node.type !== 'decl' || !node.prop.startsWith('--')) return;
		const parent = node.parent;
		if (!parent) return;
		if (parent.type === 'rule') {
			const selector = (parent as postcss.Rule).selector.trim();
			if (DARK_SELECTORS.includes(selector)) {
				darkSelector ??= selector;
				upsert(node, selector, true);
			} else if (LIGHT_SELECTORS.includes(selector)) {
				upsert(node, selector, false);
			}
		} else if (parent.type === 'atrule' && (parent as postcss.AtRule).name === 'theme') {
			const params = (parent as postcss.AtRule).params.trim();
			upsert(node, params ? `@theme ${params}` : '@theme', false);
		}
	});

	// Resolve colors through alias chains so swatches work.
	for (const token of map.values()) {
		if (token.type !== 'color') {
			let cur: DesignToken | undefined = token;
			for (let i = 0; i < 8 && cur?.alias; i++) cur = map.get(cur.alias);
			if (cur && cur !== token && cur.type === 'color') token.type = 'color';
		}
	}

	return { file, tokens: [...map.values()], darkSelector };
}

function findDecl(root: Root, edit: TokenEdit): Declaration | null {
	let found: Declaration | null = null;
	root.walkDecls(edit.name, (decl) => {
		if (found) return;
		const parent = decl.parent;
		if (parent?.type === 'rule') {
			const selector = (parent as postcss.Rule).selector.trim();
			const isDark = DARK_SELECTORS.includes(selector);
			if (edit.scope === 'dark' ? isDark : LIGHT_SELECTORS.includes(selector)) found = decl;
		} else if (edit.scope === 'light' && parent?.type === 'atrule' && (parent as postcss.AtRule).name === 'theme') {
			found = decl;
		}
	});
	return found;
}

/** Returns the stylesheet with one token value changed (or added), formatting untouched. */
export function applyTokenEdit(css: string, edit: TokenEdit): string {
	if (!/^--[\w-]+$/.test(edit.name)) throw new Error(`Invalid token name ${edit.name}`);
	if (/[;{}]/.test(edit.value)) throw new Error('Token values cannot contain ; { or }');
	const root = postcss.parse(css);
	const decl = findDecl(root, edit);
	if (decl) {
		// Exact-range replacement keeps comments and spacing byte-for-byte.
		const start = decl.source?.start?.offset;
		const end = decl.source?.end?.offset;
		if (start !== undefined && end !== undefined) {
			const original = css.slice(start, end + 1);
			const colon = original.indexOf(':');
			const valueStart = start + colon + 1;
			const tail = original.slice(colon + 1);
			const leading = tail.match(/^\s*/)![0];
			const valueEnd = valueStart + leading.length + decl.value.length;
			return css.slice(0, valueStart + leading.length) + edit.value + css.slice(valueEnd);
		}
		decl.value = edit.value;
		return root.toString();
	}
	// Add the token to the right block.
	const selector = edit.scope === 'dark' ? '.dark' : ':root';
	let rule = root.nodes.find((n) => n.type === 'rule' && (n as postcss.Rule).selector.trim() === selector) as postcss.Rule | undefined;
	if (!rule) {
		rule = postcss.rule({ selector });
		root.append(rule);
	}
	const last = rule.nodes?.filter((n) => n.type === 'decl').at(-1) as Declaration | undefined;
	rule.append(postcss.decl({ prop: edit.name, value: edit.value, raws: last ? { before: last.raws.before, between: last.raws.between } : {} }));
	return root.toString();
}

/**
 * Adds a color token the way shadcn themes declare them: the value in the light
 * scope, its dark value (when the stylesheet has a dark scope), and a
 * `--color-<name>` alias in @theme so Tailwind makes `bg-<name>`, `text-<name>`…
 */
export function addColorToken(css: string, token: { name: string; light: string; dark?: string | null }): string {
	const name = token.name.replace(/^--/, '');
	if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Token names use lowercase letters, digits and dashes (e.g. brand-accent)');
	for (const v of [token.light, token.dark ?? '']) if (/[;{}]/.test(v)) throw new Error('Token values cannot contain ; { or }');
	if (!token.light.trim()) throw new Error('A color token needs a value');
	const root = postcss.parse(css);
	const declared = new Set<string>();
	root.walkDecls((d) => void declared.add(d.prop));
	if (declared.has(`--${name}`) || declared.has(`--color-${name}`)) throw new Error(`A token named ${name} already exists`);

	const append = (container: postcss.Container, prop: string, value: string) => {
		const last = container.nodes?.filter((n) => n.type === 'decl').at(-1) as Declaration | undefined;
		container.append(postcss.decl({ prop, value, raws: last ? { before: last.raws.before, between: last.raws.between } : { before: '\n\t', between: ': ' } }));
	};
	const ruleFor = (selectors: string[]) =>
		root.nodes.find((n) => n.type === 'rule' && selectors.includes((n as postcss.Rule).selector.trim())) as postcss.Rule | undefined;

	let light = ruleFor(LIGHT_SELECTORS);
	if (!light) {
		light = postcss.rule({ selector: ':root', raws: { between: ' ', after: '\n' } });
		root.append(light);
	}
	append(light, `--${name}`, token.light.trim());
	const dark = ruleFor(DARK_SELECTORS);
	if (dark && token.dark?.trim()) append(dark, `--${name}`, token.dark.trim());

	const themes = root.nodes.filter((n) => n.type === 'atrule' && (n as postcss.AtRule).name === 'theme') as postcss.AtRule[];
	let theme = themes.find((t) => t.params.trim() === 'inline') ?? themes[0];
	if (!theme) {
		theme = postcss.atRule({ name: 'theme', params: 'inline', raws: { afterName: ' ', between: ' ', after: '\n' } });
		root.append(theme);
	}
	append(theme, `--color-${name}`, `var(--${name})`);
	return root.toString();
}

