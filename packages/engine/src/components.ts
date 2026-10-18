import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import type { AST } from 'svelte/compiler';
import type { ComponentInfo, ComponentProp, VariantGroup } from '@codesigner/protocol';
import { SvelteDoc } from './svelte/doc.js';

type Node = { type: string; start: number; end: number; [key: string]: unknown };

const pascal = (name: string) =>
	name
		.replace(/\.svelte$/, '')
		.split(/[-_.\s]+/)
		.filter(Boolean)
		.map((p) => p[0].toUpperCase() + p.slice(1))
		.join('');

function walkFiles(dir: string, out: string[] = []): string[] {
	let entries: string[] = [];
	try {
		entries = readdirSync(dir);
	} catch {
		return out;
	}
	for (const entry of entries) {
		if (entry.startsWith('.') || entry === 'node_modules' || entry === 'paraglide') continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walkFiles(full, out);
		else if (entry.endsWith('.svelte')) out.push(full);
	}
	return out;
}

function walkJs(node: unknown, visit: (n: Node) => void) {
	if (!node || typeof node !== 'object') return;
	if (Array.isArray(node)) {
		for (const item of node) walkJs(item, visit);
		return;
	}
	const n = node as Node;
	if (typeof n.type === 'string') visit(n);
	for (const [key, value] of Object.entries(n)) {
		if (key === 'loc' || key === 'metadata' || key === 'leadingComments' || key === 'trailingComments') continue;
		if (value && typeof value === 'object') walkJs(value, visit);
	}
}

const literalValue = (n: Node | undefined): string | null =>
	n?.type === 'Literal' && (typeof n.value === 'string' || typeof n.value === 'number' || typeof n.value === 'boolean') ? String(n.value) : null;

const keyName = (k: Node | undefined): string | null =>
	k ? (k.type === 'Identifier' ? String(k.name) : literalValue(k)) : null;

/** Extracts `tv({ variants, defaultVariants })` groups from the module script. */
export function extractVariants(doc: SvelteDoc): VariantGroup[] {
	const groups: VariantGroup[] = [];
	const scripts = [doc.ast.module, doc.ast.instance].filter(Boolean) as AST.Script[];
	for (const script of scripts) {
		walkJs(script.content, (node) => {
			if (node.type !== 'CallExpression') return;
			const callee = node.callee as Node;
			if (callee.type !== 'Identifier' || callee.name !== 'tv') return;
			const config = (node.arguments as Node[])[0];
			if (config?.type !== 'ObjectExpression') return;
			const props = config.properties as Node[];
			const variants = props.find((p) => keyName(p.key as Node) === 'variants')?.value as Node | undefined;
			const defaults = props.find((p) => keyName(p.key as Node) === 'defaultVariants')?.value as Node | undefined;
			if (variants?.type !== 'ObjectExpression') return;
			const defaultMap = new Map<string, string>();
			if (defaults?.type === 'ObjectExpression') {
				for (const p of defaults.properties as Node[]) {
					const k = keyName(p.key as Node);
					const v = literalValue(p.value as Node);
					if (k && v !== null) defaultMap.set(k, v);
				}
			}
			for (const group of variants.properties as Node[]) {
				const name = keyName(group.key as Node);
				const value = group.value as Node;
				if (!name || value?.type !== 'ObjectExpression') continue;
				const options = (value.properties as Node[]).map((p) => keyName(p.key as Node)).filter((k): k is string => !!k);
				groups.push({ name, options, default: defaultMap.get(name) ?? null });
			}
		});
	}
	return groups;
}

function typeText(src: string, node: Node | undefined): string | null {
	return node ? src.slice(node.start, node.end) : null;
}

function controlFor(type: string | null, name: string, defaultValue: string | null): ComponentProp['control'] {
	const t = (type ?? '').replace(/\s/g, '');
	if (name === 'children' || /Snippet/.test(t)) return 'snippet';
	if (/^(boolean)(\|undefined)?$/.test(t) || defaultValue === 'true' || defaultValue === 'false') return 'boolean';
	if (/^(number)(\|undefined)?$/.test(t)) return 'number';
	if (/^('[^']*'\|?)+(\|undefined)?$/.test(t) || /^("[^"]*"\|?)+(\|undefined)?$/.test(t)) return 'enum';
	if (/Component|Icon/.test(t) || /^icon$/i.test(name)) return 'icon';
	if (name === 'href') return 'link';
	if (/^(string)(\|undefined)?$/.test(t) || (defaultValue && /^['"`]/.test(defaultValue))) return 'text';
	return 'unknown';
}

/** Reads `let { a = 1, b }: Props = $props()` and the matching Props type members. */
export function extractProps(doc: SvelteDoc): ComponentProp[] {
	const script = doc.ast.instance;
	if (!script) return [];
	const src = doc.source;
	const typeMembers = new Map<string, { type: string | null; optional: boolean }>();
	const collectMembers = (lit: Node) => {
		for (const m of (lit.members as Node[]) ?? []) {
			if (m.type !== 'TSPropertySignature') continue;
			const name = keyName(m.key as Node);
			if (!name) continue;
			const ann = (m.typeAnnotation as Node | undefined)?.typeAnnotation as Node | undefined;
			typeMembers.set(name, { type: typeText(src, ann), optional: Boolean(m.optional) });
		}
	};
	const scripts = [doc.ast.module, script].filter(Boolean) as AST.Script[];
	for (const s of scripts) {
		walkJs(s.content, (node) => {
			if (node.type === 'TSTypeAliasDeclaration' || node.type === 'TSInterfaceDeclaration') {
				const body = (node.typeAnnotation ?? node.body) as Node | undefined;
				if (!body) return;
				if (body.type === 'TSTypeLiteral' || body.type === 'TSInterfaceBody') collectMembers(body.type === 'TSInterfaceBody' ? { ...body, members: body.body } : body);
				walkJs(body, (inner) => {
					if (inner.type === 'TSTypeLiteral') collectMembers(inner);
				});
			}
		});
	}

	const props: ComponentProp[] = [];
	walkJs(script.content, (node) => {
		if (node.type !== 'VariableDeclarator') return;
		const init = node.init as Node | undefined;
		if (init?.type !== 'CallExpression' || (init.callee as Node).type !== 'Identifier' || (init.callee as Node).name !== '$props') return;
		const pattern = node.id as Node;
		if (pattern.type !== 'ObjectPattern') return;
		for (const prop of pattern.properties as Node[]) {
			if (prop.type === 'RestElement') continue;
			const name = keyName(prop.key as Node);
			if (!name) continue;
			const value = prop.value as Node;
			let defaultSrc: string | null = null;
			let bindable = false;
			if (value?.type === 'AssignmentPattern') {
				const right = value.right as Node;
				if (right.type === 'CallExpression' && (right.callee as Node).name === '$bindable') {
					bindable = true;
					const arg = (right.arguments as Node[])[0];
					defaultSrc = arg ? src.slice(arg.start, arg.end) : null;
				} else {
					defaultSrc = src.slice(right.start, right.end);
				}
			}
			if (name === 'ref' && bindable) continue;
			const member = typeMembers.get(name);
			const type = member?.type ?? null;
			const control = controlFor(type, name, defaultSrc);
			const options =
				control === 'enum' && type ? [...type.matchAll(/['"]([^'"]*)['"]/g)].map((m) => m[1]) : undefined;
			props.push({
				name,
				control,
				type,
				options,
				default: defaultSrc,
				optional: member?.optional ?? defaultSrc !== null,
				bindable,
				description: null
			});
		}
	});
	return props;
}

/** Lists .svelte components under src/lib with their props and tv() variants. */
export function scanComponents(root: string, libDir = 'src/lib', libAlias = '$lib'): ComponentInfo[] {
	const base = join(root, libDir);
	const out: ComponentInfo[] = [];
	for (const file of walkFiles(base)) {
		const rel = relative(root, file).split('\\').join('/');
		const fromLib = relative(base, file).split('\\').join('/');
		const parts = fromLib.split('/');
		const dirName = basename(dirname(file));
		const fileBase = basename(file, '.svelte');
		const group = parts.length > 2 ? parts[parts.length - 3] : parts.length > 1 ? parts[0] : '';
		let props: ComponentProp[] = [];
		let variants: VariantGroup[] = [];
		try {
			const doc = new SvelteDoc(readFileSync(file, 'utf8'));
			props = extractProps(doc);
			variants = extractVariants(doc);
		} catch {
			// unparsable file: still list it
		}
		// shadcn-svelte: ui/button/button.svelte is exported as Button; ui/card/card-title.svelte as Card.Title.
		const isRootOfFolder = fileBase === dirName;
		const name = pascal(fileBase);
		const exportedAs: string[] = [];
		if (group === 'ui' || parts.includes('ui')) {
			if (isRootOfFolder) exportedAs.push(pascal(dirName), `${pascal(dirName)}.Root`);
			else if (fileBase.startsWith(dirName + '-')) exportedAs.push(`${pascal(dirName)}.${pascal(fileBase.slice(dirName.length + 1))}`);
		}
		out.push({
			name: exportedAs.find((n) => n.includes('.') && !n.endsWith('.Root')) ?? name,
			file: rel,
			importPath: `${libAlias}/${parts.slice(0, -1).join('/')}${parts.length > 1 && isRootOfFolder ? '' : '/' + parts.at(-1)}`.replace(/\/$/, ''),
			group: group || 'components',
			props,
			variants,
			exportedAs
		});
	}
	return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}
