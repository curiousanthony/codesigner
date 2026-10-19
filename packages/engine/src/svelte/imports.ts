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
