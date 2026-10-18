import type MagicString from 'magic-string';
import type { AST } from 'svelte/compiler';
import type { SvelteDoc } from './doc.js';
import type { TailwindEngine } from '../tailwind.js';
import { EditError } from './structure.js';

type Node = { type: string; start: number; end: number; [key: string]: unknown };

function walk(node: unknown, visit: (n: Node) => void) {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
	const n = node as Node;
	if (typeof n.type === 'string') visit(n);
	for (const [key, value] of Object.entries(n)) {
		if (key === 'loc' || key === 'metadata' || key === 'leadingComments' || key === 'trailingComments') continue;
		if (value && typeof value === 'object') walk(value, visit);
	}
}

const keyName = (k: Node | undefined): string | null =>
	!k ? null : k.type === 'Identifier' ? String(k.name) : k.type === 'Literal' ? String(k.value) : null;

const prop = (obj: Node | undefined, name: string): Node | undefined =>
	obj?.type === 'ObjectExpression' ? ((obj.properties as Node[]).find((p) => keyName(p.key as Node) === name)?.value as Node | undefined) : undefined;

/** A class string inside the tv() config, as an editable byte range. */
interface Entry {
	/** "base" or "variant.destructive" */
	name: string;
	axis: string | null;
	start: number;
	end: number;
	raw: string;
}

function stringEntry(src: string, node: Node | undefined, name: string, axis: string | null): Entry | null {
	if (!node) return null;
	if (node.type === 'Literal' && typeof node.value === 'string') return { name, axis, start: node.start + 1, end: node.end - 1, raw: src.slice(node.start + 1, node.end - 1) };
	if (node.type === 'TemplateLiteral' && (node.expressions as Node[]).length === 0) {
		const quasi = (node.quasis as Node[])[0];
		return { name, axis, start: quasi.start, end: quasi.end, raw: src.slice(quasi.start, quasi.end) };
	}
	return null;
}

export interface TvConfig {
	config: Node;
	/** compoundVariants entries: their conditions and class string. */
	compounds: { conditions: Record<string, string>; entry: Entry | null; node: Node }[];
	compoundsArray: Node | undefined;
	base: Entry | null;
	/** axis → value → entry (null when the value isn't a plain string, e.g. an array). */
	variants: Map<string, Map<string, Entry | null>>;
	defaults: Record<string, string>;
}

/** The first `tv({...})` config of the component's scripts. */
export function findTv(doc: SvelteDoc): TvConfig | null {
	const src = doc.source;
	let found: TvConfig | null = null;
	for (const script of [doc.ast.module, doc.ast.instance].filter(Boolean) as AST.Script[]) {
		walk(script.content, (node) => {
			if (found || node.type !== 'CallExpression') return;
			const callee = node.callee as Node;
			if (callee.type !== 'Identifier' || callee.name !== 'tv') return;
			const config = (node.arguments as Node[])[0];
			if (config?.type !== 'ObjectExpression') return;
			const variants = new Map<string, Map<string, Entry | null>>();
			const groups = prop(config, 'variants');
			if (groups?.type === 'ObjectExpression') {
				for (const group of groups.properties as Node[]) {
					const axis = keyName(group.key as Node);
					const values = group.value as Node;
					if (!axis || values?.type !== 'ObjectExpression') continue;
					const map = new Map<string, Entry | null>();
					for (const p of values.properties as Node[]) {
						const value = keyName(p.key as Node);
						if (value !== null) map.set(value, stringEntry(src, p.value as Node, `${axis}.${value}`, axis));
					}
					variants.set(axis, map);
				}
			}
			const defaults: Record<string, string> = {};
			const defaultsNode = prop(config, 'defaultVariants');
			if (defaultsNode?.type === 'ObjectExpression') {
				for (const p of defaultsNode.properties as Node[]) {
					const k = keyName(p.key as Node);
					const v = p.value as Node;
					if (k && v.type === 'Literal') defaults[k] = String(v.value);
				}
			}
			const compoundsArray = prop(config, 'compoundVariants');
			const compounds: TvConfig['compounds'] = [];
			if (compoundsArray?.type === 'ArrayExpression') {
				for (const item of compoundsArray.elements as Node[]) {
					if (item?.type !== 'ObjectExpression') continue;
					const conditions: Record<string, string> = {};
					let entry: Entry | null = null;
					for (const p of item.properties as Node[]) {
						const k = keyName(p.key as Node);
						const v = p.value as Node;
						if (k === 'class' || k === 'className') entry = stringEntry(src, v, 'compound', null);
						else if (k && v.type === 'Literal') conditions[k] = String(v.value);
					}
					compounds.push({ conditions, entry, node: item });
				}
			}
			found = { config, base: stringEntry(src, prop(config, 'base'), 'base', null), variants, defaults, compounds, compoundsArray };
		});
	}
	return found;
}

const tokensOf = (raw: string) => raw.split(/\s+/).filter(Boolean);
const variantPrefix = (token: string) => {
	let depth = 0;
	let last = -1;
	for (let i = 0; i < token.length; i++) {
		const ch = token[i];
		if (ch === '[' || ch === '(') depth++;
		else if (ch === ']' || ch === ')') depth--;
		else if (ch === ':' && depth === 0) last = i;
	}
	return last < 0 ? '' : token.slice(0, last + 1);
};

/**
 * Edits the classes of one variant combination, Framer style: the change lands
 * in that variant's own entry (`variants.variant.destructive`), never in `base`,
 * so the other variants keep their look. tailwind-variants merges the entry over
 * `base`, so an override there wins.
 */
export function editVariantClasses(
	doc: SvelteDoc,
	s: MagicString,
	op: { context: Record<string, string>; remove: string[]; add: string[] },
	tw: TailwindEngine | null
): { warnings: string[]; entry: string } {
	const tv = findTv(doc);
	if (!tv) throw new EditError('This component has no tv() variants to edit');
	const warnings: string[] = [];
	const add = [...new Set(op.add.map((c) => (tw ? tw.canonicalize(c) : c)))];

	// Entries in effect for this combination.
	const active: Entry[] = [];
	for (const [axis, values] of tv.variants) {
		const value = op.context[axis] ?? tv.defaults[axis];
		const entry = value !== undefined ? values.get(value) : undefined;
		if (entry) active.push(entry);
	}
	const conflictsIn = (entry: Entry) => [
		...(tw ? tw.conflicts(tokensOf(entry.raw), add) : []),
		...tokensOf(entry.raw).filter((t) => op.remove.includes(t))
	];

	// Axes the cell names explicitly (others fall back to defaultVariants and are shared with other cells).
	const explicit = Object.fromEntries(Object.entries(op.context).filter(([axis]) => tv.variants.has(axis)));
	const explicitAxes = Object.keys(explicit);
	const sameConditions = (c: Record<string, string>) =>
		Object.keys(c).length === explicitAxes.length && explicitAxes.every((axis) => c[axis] === explicit[axis]);
	const compound = tv.compounds.find((c) => c.entry && sameConditions(c.conditions)) ?? null;

	// 1. A compound entry for exactly this combination already exists: it wins over every axis.
	// 2. The entry controlling the value belongs to an explicit axis: edit it (variant.destructive).
	// 3. It's controlled by a shared entry (size.default): add a compound entry so only this combination changes.
	// 4. Nothing sets it yet: the explicit axis entry, else the axis that sets it for other values, else the first axis.
	const controlling = active.find((e) => conflictsIn(e).length > 0) ?? null;
	let target: Entry | null = compound?.entry ?? null;
	if (!target && controlling && (explicitAxes.length === 0 || explicitAxes.includes(controlling.axis!))) target = controlling;
	if (!target && controlling && explicitAxes.length > 0) {
		insertCompound(doc, s, tv, explicit, add);
		return { warnings, entry: `compound ${JSON.stringify(explicit)}` };
	}
	if (!target) target = active.find((e) => e.axis && explicitAxes.includes(e.axis)) ?? null;
	if (!target) {
		for (const [axis, values] of tv.variants) {
			const setsIt = [...values.values()].some((e) => e && tw && tw.conflicts(tokensOf(e.raw), add).length > 0);
			if (setsIt) {
				target = active.find((e) => e.axis === axis) ?? null;
				if (target) break;
			}
		}
	}
	target ??= active[0] ?? null;
	if (!target) throw new EditError('No plain-string variant entry to edit for this combination');

	const existing = tokensOf(target.raw);
	const removeSet = new Set([...conflictsIn(target)].filter((t) => !add.includes(t)));
	const kept: string[] = [];
	const toAdd = add.filter((t) => !existing.includes(t));
	const placed = new Set<string>();
	for (const token of existing) {
		if (!removeSet.has(token)) {
			kept.push(token);
			continue;
		}
		// Replace in place when an added token with the same variant prefix overrides it.
		const replacement = toAdd.find((a) => !placed.has(a) && variantPrefix(a) === variantPrefix(token));
		if (replacement) {
			kept.push(replacement);
			placed.add(replacement);
		}
	}
	for (const token of toAdd) if (!placed.has(token)) kept.push(token);
	for (const token of op.remove) {
		if (!existing.includes(token) && tv.base && tokensOf(tv.base.raw).includes(token) && !add.length) {
			warnings.push(`"${token}" comes from the shared base styles and was left unchanged`);
		}
	}
	const next = kept.join(' ');
	if (next !== target.raw.trim()) {
		const lead = target.raw.match(/^\s*/)![0];
		const trail = target.raw.match(/\s*$/)![0];
		s.overwrite(target.start, target.end === target.start ? target.start : target.end, lead + next + trail);
	}
	return { warnings, entry: target.name };
}

/** Adds a variant value (copying another value's classes), e.g. variant.brand. */
export function addVariantValue(doc: SvelteDoc, s: MagicString, axis: string, value: string, copyFrom?: string) {
	const tv = findTv(doc);
	const values = tv?.variants.get(axis);
	if (!tv || !values) throw new EditError(`No "${axis}" variants in this component`);
	if (values.has(value)) throw new EditError(`"${value}" already exists`);
	const groups = prop(tv.config, 'variants') as Node;
	const group = (groups.properties as Node[]).find((p) => keyName(p.key as Node) === axis)!.value as Node;
	const props = group.properties as Node[];
	const last = props.at(-1);
	const source = (copyFrom ? values.get(copyFrom) : null) ?? values.get(tv.defaults[axis] ?? '') ?? null;
	const key = /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
	const text = `${key}: ${JSON.stringify(source ? source.raw.trim() : '')}`;
	if (!last) {
		s.appendLeft(group.start + 1, ` ${text} `);
		return;
	}
	const lineStart = doc.source.lastIndexOf('\n', last.start) + 1;
	const indent = doc.source.slice(lineStart, last.start).match(/^\s*/)![0];
	const after = doc.source.slice(last.end).match(/^\s*,/) ? doc.source.indexOf(',', last.end) + 1 : last.end;
	s.appendLeft(after, `${doc.source.slice(last.end, after).includes(',') ? '' : ','}\n${indent}${text},`);
}

/** Adds `{ ...conditions, class: "..." }` to compoundVariants (creating the array when needed). */
function insertCompound(doc: SvelteDoc, s: MagicString, tv: TvConfig, conditions: Record<string, string>, classes: string[]) {
	const src = doc.source;
	const fields = Object.entries(conditions).map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`);
	const object = `{ ${[...fields, `class: ${JSON.stringify(classes.join(' '))}`].join(', ')} }`;
	const configProps = tv.config.properties as Node[];
	const indentOf = (node: Node) => src.slice(src.lastIndexOf('\n', node.start) + 1, node.start).match(/^\s*/)![0];
	if (tv.compoundsArray?.type === 'ArrayExpression') {
		const elements = tv.compoundsArray.elements as Node[];
		const last = elements.at(-1);
		if (!last) {
			s.appendLeft(tv.compoundsArray.start + 1, object);
			return;
		}
		const comma = src.slice(last.end).match(/^\s*,/);
		const at = comma ? last.end + comma[0].length : last.end;
		s.appendLeft(at, `${comma ? '' : ','}\n${indentOf(last)}${object},`);
		return;
	}
	// No compoundVariants yet: add the property after `variants`.
	const anchor = configProps.find((p) => keyName(p.key as Node) === 'variants') ?? configProps.at(-1)!;
	const indent = indentOf(anchor);
	const unit = indent.includes('\t') ? '\t' : '  ';
	const comma = src.slice(anchor.end).match(/^\s*,/);
	const at = comma ? anchor.end + comma[0].length : anchor.end;
	s.appendLeft(at, `${comma ? '' : ','}\n${indent}compoundVariants: [\n${indent}${unit}${object},\n${indent}],`);
}
