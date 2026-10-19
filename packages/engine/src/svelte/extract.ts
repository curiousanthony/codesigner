import isReference from 'is-reference';
import type { AST } from 'svelte/compiler';
import { childFragments, type ElementLike, type SvelteDoc } from './doc.js';
import { EditError } from './structure.js';

type Node = { type: string; start?: number; end?: number; [key: string]: unknown };

/** Names bound by a destructuring pattern (`{ a, b: [c] }` → a, c). */
function patternNames(pattern: unknown, out: Set<string>) {
	const p = pattern as Node | null;
	if (!p) return;
	switch (p.type) {
		case 'Identifier':
			out.add(p.name as string);
			break;
		case 'ObjectPattern':
			for (const prop of p.properties as Node[]) patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
			break;
		case 'ArrayPattern':
			for (const el of p.elements as Node[]) patternNames(el, out);
			break;
		case 'RestElement':
			patternNames(p.argument, out);
			break;
		case 'AssignmentPattern':
			patternNames(p.left, out);
			break;
	}
}

/** Names a template node declares for its children: {#each … as x, i}, {#snippet s(a)}, {@const x}, {:then v}. */
function declaredBy(node: Node, out: Set<string>) {
	if (node.type === 'EachBlock') {
		patternNames(node.context, out);
		if (node.index) out.add(node.index as string);
	} else if (node.type === 'SnippetBlock') {
		patternNames(node.expression, out);
		for (const param of (node.parameters as Node[]) ?? []) patternNames(param, out);
	} else if (node.type === 'ConstTag') {
		for (const decl of ((node.declaration as Node).declarations as Node[]) ?? []) patternNames(decl.id, out);
	} else if (node.type === 'AwaitBlock') {
		patternNames(node.value, out);
		patternNames(node.error, out);
	}
}

const rootOf = (expr: Node | null | undefined): string | null => {
	let e = expr;
	while (e && e.type === 'MemberExpression') e = e.object as Node;
	return e?.type === 'Identifier' ? (e.name as string) : null;
};

/** Everything a subtree reads (identifiers, component and action names), declares, and writes. */
function scan(root: Node) {
	const refs = new Set<string>();
	const declared = new Set<string>();
	const writes = new Set<string>();
	const components = new Set<string>();
	const seen = new Set<unknown>();
	const visit = (node: Node, parent: Node | null) => {
		if (!node || typeof node !== 'object' || seen.has(node)) return;
		seen.add(node);
		declaredBy(node, declared);
		switch (node.type) {
			case 'Identifier':
				if (!parent || isReference(node as never, parent as never)) refs.add(node.name as string);
				break;
			case 'Component':
				components.add((node.name as string).split('.')[0]);
				break;
			case 'UseDirective':
			case 'TransitionDirective':
			case 'AnimateDirective':
				refs.add((node.name as string).split('.')[0]);
				break;
			case 'BindDirective':
				writes.add(rootOf(node.expression as Node) ?? '');
				break;
			case 'AssignmentExpression':
				writes.add(rootOf(node.left as Node) ?? '');
				break;
			case 'UpdateExpression':
				writes.add(rootOf(node.argument as Node) ?? '');
				break;
			case 'ArrowFunctionExpression':
			case 'FunctionExpression':
			case 'FunctionDeclaration':
				for (const param of node.params as Node[]) patternNames(param, declared);
				break;
			case 'VariableDeclarator':
				patternNames(node.id, declared);
				break;
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === 'parent' || key === 'metadata' || key === 'loc') continue;
			if (Array.isArray(value)) value.forEach((v) => v && typeof v === 'object' && visit(v as Node, node));
			else if (value && typeof value === 'object' && 'type' in (value as object)) visit(value as Node, node);
		}
	};
	visit(root, null);
	return { refs, declared, writes, components };
}

/** Top-level bindings of a script, with the source text of imports (to copy them). */
function scriptBindings(doc: SvelteDoc, script: { content: { body: Node[] } } | null | undefined) {
	const imports = new Map<string, string>();
	const names = new Set<string>();
	for (const node of script?.content.body ?? []) {
		if (node.type === 'ImportDeclaration') {
			const text = doc.source.slice(node.start, node.end);
			for (const spec of node.specifiers as Node[]) imports.set((spec.local as Node).name as string, text);
		} else if (node.type === 'VariableDeclaration') {
			for (const decl of node.declarations as Node[]) patternNames(decl.id, names);
		} else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
			names.add((node.id as Node).name as string);
		} else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
			const d = node.declaration as Node;
			if (d.type === 'VariableDeclaration') for (const decl of d.declarations as Node[]) patternNames(decl.id, names);
		}
	}
	return { imports, names };
}

/** Names declared by the blocks around `target` in the page (an {#each} it sits in, snippets of its ancestors…). */
function enclosingNames(doc: SvelteDoc, target: ElementLike): Set<string> {
	const out = new Set<string>();
	const walk = (fragment: AST.Fragment): boolean => {
		for (const node of fragment.nodes as unknown as Node[]) {
			if (node === (target as unknown as Node)) return true;
			if ((node.start ?? 0) <= target.start && target.end <= (node.end ?? 0)) {
				declaredBy(node, out);
				for (const child of childFragments(node as never)) if (walk(child)) return true;
			} else if (node.type === 'SnippetBlock' || node.type === 'ConstTag') {
				declaredBy(node, out); // siblings visible to the target
			}
		}
		return false;
	};
	walk(doc.ast.fragment);
	return out;
}

export interface Extraction {
	/** New component file content. */
	component: string;
	/** Usage written in place of the markup, e.g. `<ProjectCard {project} />`. */
	usage: string;
	props: string[];
}

/**
 * Turns the markup of `target` into a component: names it reads from the page
 * (script variables, {#each} items, snippets) become props, the imports it
 * uses are copied. Two-way state (bind:, assignments to page variables) is
 * refused: it would silently stop updating the page.
 */
export function extractComponent(doc: SvelteDoc, target: ElementLike, name: string): Extraction {
	const ast = doc.ast as unknown as { instance?: { content: { body: Node[] } }; module?: { content: { body: Node[] } } };
	const instance = scriptBindings(doc, ast.instance);
	const module = scriptBindings(doc, ast.module);
	const outer = enclosingNames(doc, target);
	const { refs, declared, writes, components } = scan(target as unknown as Node);

	const imports = new Map([...module.imports, ...instance.imports]);
	const pageNames = new Set([...instance.names, ...module.names, ...outer]);
	const used = new Set([...refs, ...components].map((n) => (n.startsWith('$') && !pageNames.has(n) ? n.slice(1) : n)));
	const props: string[] = [];
	const copied = new Set<string>();
	for (const ref of used) {
		if (declared.has(ref)) continue;
		if (imports.has(ref)) copied.add(imports.get(ref)!);
		else if (pageNames.has(ref)) props.push(ref);
	}
	const written = props.filter((p) => writes.has(p));
	if (written.length) {
		throw new EditError(`This layer changes ${written.join(', ')} (bind: or assignments). Make it a component in code so the page keeps updating.`);
	}

	const markup = doc.source.slice(target.start, target.end);
	const indent = doc.indentAt(target.start);
	const body = markup
		.split('\n')
		.map((line, i) => (i > 0 && line.startsWith(indent) ? line.slice(indent.length) : line))
		.join('\n');
	const unit = doc.indentUnit();
	const lang = /<script[^>]*lang=["']ts["']/.test(doc.source) ? ' lang="ts"' : '';
	const scriptLines = [...[...copied].map((text) => unit + text), ...(props.length ? [`${unit}let { ${props.join(', ')} } = $props();`] : [])];
	const component = scriptLines.length ? `<script${lang}>\n${scriptLines.join('\n')}\n</script>\n\n${body}\n` : `${body}\n`;
	const usage = `<${name}${props.map((p) => ` {${p}}`).join('')} />`;
	return { component, usage, props };
}
