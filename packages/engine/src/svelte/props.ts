import type MagicString from 'magic-string';
import type { ElementLike, SvelteDoc } from './doc.js';
import { EditError } from './structure.js';

type Node = { type: string; start: number; end: number; [key: string]: unknown };

const quote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Inserts `name?: string;` into an object type `{ … }` (an inline annotation or a Props interface/type). */
function addTypeMember(doc: SvelteDoc, s: MagicString, literal: Node, name: string) {
	const close = literal.end - 1; // the `}`
	let i = close - 1;
	while (i > literal.start && /\s/.test(doc.source[i])) i--;
	const sep = doc.source[i] === '{' || doc.source[i] === ';' || doc.source[i] === ',' ? '' : ';';
	const multiline = doc.source.slice(literal.start, literal.end).includes('\n');
	if (multiline) {
		const indent = doc.indentAt(close) + doc.indentUnit();
		s.appendLeft(i + 1, `${sep}\n${indent}${name}?: string;`);
	} else s.appendLeft(i + 1, `${sep} ${name}?: string;`);
}

/** The object type behind a `$props()` annotation: inline, or a `Props` interface / type alias in the script. */
function propsTypeLiteral(body: Node[], annotation: Node | undefined): Node | null {
	if (!annotation) return null;
	if (annotation.type === 'TSTypeLiteral') return annotation;
	if (annotation.type !== 'TSTypeReference') return null;
	const ref = (annotation.typeName as Node & { name?: string })?.name;
	for (const node of body) {
		const decl = (node.type === 'ExportNamedDeclaration' ? (node.declaration as Node) : node) as Node | null;
		if (!decl) continue;
		if (decl.type === 'TSInterfaceDeclaration' && (decl.id as Node & { name: string }).name === ref) return decl.body as Node;
		if (decl.type === 'TSTypeAliasDeclaration' && (decl.id as Node & { name: string }).name === ref && (decl.typeAnnotation as Node).type === 'TSTypeLiteral')
			return decl.typeAnnotation as Node;
	}
	return null;
}

/**
 * Framer's "expose property": a static text or attribute inside a component
 * becomes a prop whose default is the current value, so every existing usage
 * renders the same and instances can now override it.
 */
export function exposeProp(doc: SvelteDoc, s: MagicString, node: ElementLike, name: string, from: 'text' | { attribute: string }) {
	if (!/^[a-zA-Z_$][\w$]*$/.test(name)) throw new EditError(`"${name}" isn't a valid property name (letters, digits, _; e.g. title)`);
	const ast = doc.ast as unknown as { instance?: { start: number; end: number; content: { body: Node[]; start: number; end: number } } };
	const body = ast.instance?.content.body ?? [];
	if (new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(ast.instance ? doc.source.slice(ast.instance.start, ast.instance.end) : '')) {
		throw new EditError(`"${name}" is already used in this component. Pick another name.`);
	}

	// 1) The value becomes {name}.
	let value: string;
	if (from === 'text') {
		const nodes = node.fragment.nodes;
		if (!nodes.length || nodes.some((n) => n.type !== 'Text')) throw new EditError('Only static text can become a property');
		const start = doc.openTagEnd(node);
		const end = doc.closeTagStart(node);
		const current = doc.source.slice(start, end);
		value = current.trim().replace(/\s+/g, ' ');
		const lead = current.match(/^\s*/)![0].length;
		const trail = current.match(/\s*$/)![0].length;
		s.overwrite(start + lead, end - trail, `{${name}}`);
	} else {
		const attr = (node.attributes as unknown as Node[]).find((a) => a.type === 'Attribute' && a.name === from.attribute) as (Node & { value: unknown }) | undefined;
		const parts = Array.isArray(attr?.value) ? (attr!.value as Node[]) : null;
		if (!attr || !parts || parts.length !== 1 || parts[0].type !== 'Text') throw new EditError(`Only a static ${from.attribute} can become a property`);
		value = (parts[0] as Node & { data: string }).data;
		s.overwrite(attr.start, attr.end, from.attribute === name ? `{${name}}` : `${from.attribute}={${name}}`);
	}

	// 2) …declared in $props() with the old value as default.
	const declaration = body
		.flatMap((n) => (n.type === 'VariableDeclaration' ? (n.declarations as Node[]) : []))
		.find((d) => (d.init as Node | null)?.type === 'CallExpression' && ((d.init as Node).callee as Node & { name?: string }).name === '$props');
	const entry = `${name} = ${quote(value)}`;
	if (declaration && (declaration.id as Node).type === 'ObjectPattern') {
		const pattern = declaration.id as Node & { properties: Node[]; typeAnnotation?: { typeAnnotation: Node } };
		const props = pattern.properties;
		const rest = props.find((p) => p.type === 'RestElement');
		if (rest) s.appendLeft(rest.start, `${entry}, `);
		else if (props.length) s.appendLeft(props.at(-1)!.end, `, ${entry}`);
		else s.appendLeft(pattern.start + 1, ` ${entry} `);
		const literal = propsTypeLiteral(body, pattern.typeAnnotation?.typeAnnotation);
		if (literal) addTypeMember(doc, s, literal, name);
	} else if (declaration) {
		throw new EditError('This component reads its props as one object; add the property in code');
	} else if (ast.instance) {
		const imports = body.filter((n) => n.type === 'ImportDeclaration');
		const at = imports.length ? imports.at(-1)!.end : ast.instance.content.start;
		s.appendLeft(at, `\n${doc.indentUnit()}let { ${entry} } = $props();`);
	} else {
		s.prepend(`<script>\n${doc.indentUnit()}let { ${entry} } = $props();\n</script>\n\n`);
	}
	return value;
}
