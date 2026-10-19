import type MagicString from 'magic-string';
import type { ImportSpec } from '@codesigner/protocol';
import type { SvelteDoc } from './doc.js';

type Specifier = { type: string; local: { name: string }; imported?: { name?: string }; end: number };
type ImportNode = { type: 'ImportDeclaration'; start: number; end: number; source: { value: string }; specifiers: Specifier[] };

const statement = (spec: ImportSpec) =>
	spec.kind === 'namespace'
		? `import * as ${spec.local} from '${spec.from}';`
		: spec.kind === 'default'
			? `import ${spec.local} from '${spec.from}';`
			: `import { ${spec.imported && spec.imported !== spec.local ? `${spec.imported} as ${spec.local}` : spec.local} } from '${spec.from}';`;

/**
 * Makes `spec.local` available in the component's instance script: nothing if
 * a binding with that name is already imported, otherwise added to an existing
 * named import from the same module, or as a new import after the last one.
 */
export function ensureImport(doc: SvelteDoc, s: MagicString, spec: ImportSpec) {
	const script = (doc.ast as unknown as { instance?: { content: { start: number; end: number; body: { type: string }[] } } | null }).instance;
	const unit = doc.indentUnit();
	if (!script) {
		const lang = doc.source.includes('lang="ts"') || /\.ts['"]/.test(doc.source) ? ' lang="ts"' : '';
		s.prepend(`<script${lang}>\n${unit}${statement(spec)}\n</script>\n\n`);
		return;
	}
	const imports = script.content.body.filter((n): n is ImportNode => n.type === 'ImportDeclaration');
	if (imports.some((i) => i.specifiers.some((sp) => sp.local.name === spec.local))) return;
	if (spec.kind === 'named') {
		const same = imports.find((i) => i.source.value === spec.from && i.specifiers.length && i.specifiers.every((sp) => sp.type === 'ImportSpecifier'));
		if (same) {
			const last = same.specifiers.at(-1)!;
			s.appendLeft(last.end, `, ${spec.imported && spec.imported !== spec.local ? `${spec.imported} as ${spec.local}` : spec.local}`);
			return;
		}
	}
	const anchor = imports.at(-1);
	if (anchor) {
		s.appendLeft(anchor.end, `\n${doc.indentAt(anchor.start)}${statement(spec)}`);
	} else {
		s.appendLeft(script.content.start, `\n${unit}${statement(spec)}`);
	}
}

/**
 * The name markup should use for `spec` in this file: the existing binding when
 * the same module is already imported, else `spec.local`, or `spec.local2`…
 * when that name is taken by something else (another `Button`, a variable).
 */
export function resolveImport(doc: SvelteDoc, spec: ImportSpec): ImportSpec & { present: boolean } {
	const script = (doc.ast as unknown as { instance?: { content: { body: Node[] } } | null }).instance;
	const body = script?.content.body ?? [];
	const imports = body.filter((n): n is ImportNode => n.type === 'ImportDeclaration');
	const wanted = spec.imported ?? spec.local;
	for (const i of imports) {
		if (i.source.value !== spec.from) continue;
		for (const sp of i.specifiers) {
			const sameKind =
				(spec.kind === 'namespace' && sp.type === 'ImportNamespaceSpecifier') ||
				(spec.kind === 'default' && sp.type === 'ImportDefaultSpecifier') ||
				(spec.kind === 'named' && sp.type === 'ImportSpecifier' && sp.imported?.name === wanted);
			if (sameKind) return { ...spec, local: sp.local.name, present: true };
		}
	}
	const taken = new Set<string>();
	for (const node of body) {
		if (node.type === 'ImportDeclaration') (node as ImportNode).specifiers.forEach((sp) => taken.add(sp.local.name));
		else if (node.type === 'VariableDeclaration') for (const d of (node as unknown as { declarations: { id: Node }[] }).declarations) collect(d.id, taken);
		else if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
			const id = (node as unknown as { id?: { name: string } }).id;
			if (id) taken.add(id.name);
		}
	}
	let local = spec.local;
	for (let n = 2; taken.has(local); n++) local = `${spec.local}${n}`;
	return { ...spec, local, imported: spec.kind === 'named' ? wanted : undefined, present: false };
}

type Node = { type: string; [key: string]: unknown };
function collect(pattern: Node | null | undefined, out: Set<string>) {
	if (!pattern) return;
	if (pattern.type === 'Identifier') out.add(pattern.name as string);
	else if (pattern.type === 'ObjectPattern') for (const p of pattern.properties as Node[]) collect((p.type === 'RestElement' ? p.argument : p.value) as Node, out);
	else if (pattern.type === 'ArrayPattern') for (const e of pattern.elements as Node[]) collect(e, out);
	else if (pattern.type === 'AssignmentPattern') collect(pattern.left as Node, out);
	else if (pattern.type === 'RestElement') collect(pattern.argument as Node, out);
}
