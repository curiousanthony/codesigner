import type MagicString from 'magic-string';
import type { AST } from 'svelte/compiler';
import { SvelteDoc, isElementLike, type ElementLike, type Located } from './doc.js';

export class EditError extends Error {}

/** Escapes text so Svelte renders it literally. */
export function escapeSvelteText(text: string): string {
	return text.replace(/[{}<]/g, (ch) => (ch === '<' ? '&lt;' : ch === '{' ? "{'{'}" : "{'}'}"));
}

/** Replaces the static text inside an element, keeping surrounding whitespace. */
export function setText(doc: SvelteDoc, s: MagicString, node: ElementLike, text: string) {
	const nodes = node.fragment.nodes;
	if (nodes.some((n) => n.type !== 'Text')) {
		throw new EditError('This text is dynamic or contains other elements; edit it in code');
	}
	if (doc.isSelfClosing(node)) throw new EditError(`<${node.name}> can't contain text`);
	const start = doc.openTagEnd(node);
	const end = doc.closeTagStart(node);
	const current = doc.source.slice(start, end);
	const lead = current.match(/^\s*/)![0];
	const trail = current.slice(lead.length).match(/\s*$/)![0];
	const next = lead + escapeSvelteText(text) + (current.trim() ? trail : '');
	if (start === end) s.appendLeft(start, next);
	else s.overwrite(start, end, next);
}

/** Inline formatting a text layer may contain and still be edited visually (rich text). */
export const INLINE_TAGS = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'a', 'br', 'span', 'code', 'small', 'mark', 'sub', 'sup']);

/** Text written in the markup with inline formatting only: no expressions, blocks, components, directives or dynamic attributes. */
export function isStaticRich(nodes: AST.Fragment['nodes']): boolean {
	return nodes.every(
		(n) =>
			n.type === 'Text' ||
			(n.type === 'RegularElement' &&
				INLINE_TAGS.has(n.name) &&
				n.attributes.every((a) => a.type === 'Attribute' && (a.value === true || (Array.isArray(a.value) && a.value.every((part) => part.type === 'Text')))) &&
				isStaticRich(n.fragment.nodes))
	);
}

/**
 * Replaces the content of a static text layer with rich text markup (text,
 * bold, italic, links…), keeping the surrounding whitespace. The markup comes
 * from the canvas, already escaped for Svelte; anything beyond static inline
 * formatting is refused.
 */
export function setRichText(doc: SvelteDoc, s: MagicString, node: ElementLike, markup: string) {
	if (!isStaticRich(node.fragment.nodes)) throw new EditError('This text is dynamic or contains other elements; edit it in code');
	if (doc.isSelfClosing(node)) throw new EditError(`<${node.name}> can't contain text`);
	let parsed: AST.Fragment['nodes'][number] | undefined;
	try {
		parsed = (new SvelteDoc(`<div>${markup}</div>`).ast as unknown as { fragment: AST.Fragment }).fragment.nodes[0];
	} catch {
		parsed = undefined;
	}
	if (parsed?.type !== 'RegularElement' || !isStaticRich(parsed.fragment.nodes)) {
		throw new EditError('Rich text can only contain text, bold, italic, underline and links');
	}
	const start = doc.openTagEnd(node);
	const end = doc.closeTagStart(node);
	const current = doc.source.slice(start, end);
	const lead = current.match(/^\s*/)![0];
	const trail = current.slice(lead.length).match(/\s*$/)![0];
	const next = lead + markup.trim() + (current.trim() ? trail : '');
	if (start === end) s.appendLeft(start, next);
	else s.overwrite(start, end, next);
}

const formatValue = (name: string, value: string | number | boolean, kind?: 'string' | 'expression') => {
	if (value === true) return name;
	if (kind === 'expression' || typeof value === 'number' || typeof value === 'boolean') return `${name}={${value}}`;
	return `${name}="${String(value).replace(/"/g, '&quot;')}"`;
};

/** Sets, replaces or removes an attribute / component prop. */
export function setAttribute(
	doc: SvelteDoc,
	s: MagicString,
	node: ElementLike,
	name: string,
	value: string | number | boolean | null,
	kind?: 'string' | 'expression'
) {
	const attr = node.attributes.find((a) => a.type === 'Attribute' && a.name === name) as AST.Attribute | undefined;
	if (value === null || value === false) {
		if (!attr) return;
		let start = attr.start;
		while (start > 0 && /[ \t]/.test(doc.source[start - 1])) start--;
		s.remove(start, attr.end);
		return;
	}
	const text = formatValue(name, value, kind);
	if (attr) {
		s.overwrite(attr.start, attr.end, text);
		return;
	}
	const spread = node.attributes.some((a) => a.type === 'SpreadAttribute');
	const at = node.attributes.length ? node.attributes[node.attributes.length - 1].end : node.start + 1 + node.name.length;
	s.appendLeft(at, ` ${text}`);
	return spread ? `"${name}" may be overridden by a spread attribute` : undefined;
}

export function renameTag(doc: SvelteDoc, s: MagicString, node: ElementLike, tag: string) {
	if (node.type !== 'RegularElement') throw new EditError('Only HTML elements can change tag');
	if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw new EditError(`Invalid tag name "${tag}"`);
	s.overwrite(node.start + 1, node.start + 1 + node.name.length, tag);
	if (!doc.isSelfClosing(node)) {
		const close = doc.closeTagStart(node);
		s.overwrite(close + 2, close + 2 + node.name.length, tag);
	}
}

/** Re-indents every line after the first by `delta` (adds) or removes it. */
function reindent(text: string, unit: string, direction: 1 | -1): string {
	return text
		.split('\n')
		.map((line, i) => {
			if (i === 0 || line.trim() === '') return line;
			if (direction === 1) return unit + line;
			return line.startsWith(unit) ? line.slice(unit.length) : line.replace(/^[\t ]/, '');
		})
		.join('\n');
}

/** Wraps contiguous siblings in a new element (Framer "Add Stack" / "Add Frame"). */
export function wrap(doc: SvelteDoc, s: MagicString, targets: Located<ElementLike>[], tag: string, className: string) {
	if (targets.length === 0) throw new EditError('Nothing to wrap');
	const fragment = targets[0].parentFragment;
	if (targets.some((t) => t.parentFragment !== fragment)) {
		throw new EditError('Only layers that share the same parent can be wrapped together');
	}
	const sorted = [...targets].sort((a, b) => a.node.start - b.node.start);
	const first = sorted[0].node;
	const last = sorted[sorted.length - 1].node;
	const unit = doc.indentUnit();
	const src = doc.source;
	const inner = src.slice(first.start, last.end);
	const open = className ? `<${tag} class="${className}">` : `<${tag}>`;
	if (doc.startsLine(first.start)) {
		const base = doc.indentAt(first.start);
		s.overwrite(first.start, last.end, `${open}\n${base}${unit}${reindent(inner, unit, 1)}\n${base}</${tag}>`);
	} else {
		s.overwrite(first.start, last.end, `${open}${inner}</${tag}>`);
	}
}

/** Replaces an element with its children. */
export function unwrap(doc: SvelteDoc, s: MagicString, node: ElementLike) {
	if (doc.isSelfClosing(node) || node.fragment.nodes.length === 0) {
		throw new EditError('This layer has no children to keep');
	}
	const unit = doc.indentUnit();
	const inner = doc.source.slice(doc.openTagEnd(node), doc.closeTagStart(node));
	const trimmed = inner.replace(/^\s*\n/, '').replace(/\s+$/, '');
	const firstIndent = trimmed.match(/^[\t ]*/)![0];
	const dedented = reindent(trimmed.slice(firstIndent.length), unit, -1);
	s.overwrite(node.start, node.end, dedented);
}

/** Range covering a node and, when it sits alone on its line(s), the whole line. */
function lineRange(doc: SvelteDoc, node: { start: number; end: number }): [number, number] {
	const src = doc.source;
	const lineStart = src.lastIndexOf('\n', node.start - 1) + 1;
	const lineEndIdx = src.indexOf('\n', node.end);
	const lineEnd = lineEndIdx === -1 ? src.length : lineEndIdx;
	const before = src.slice(lineStart, node.start);
	const after = src.slice(node.end, lineEnd);
	if (/^[\t ]*$/.test(before) && /^[\t ]*$/.test(after)) {
		return [lineStart, lineEndIdx === -1 ? lineEnd : lineEnd + 1];
	}
	return [node.start, node.end];
}

export function remove(doc: SvelteDoc, s: MagicString, targets: Located<ElementLike>[]) {
	const sorted = [...targets].sort((a, b) => a.node.start - b.node.start);
	let lastEnd = -1;
	for (const t of sorted) {
		if (t.node.start < lastEnd) continue; // nested inside a removed node
		const [a, b] = lineRange(doc, t.node);
		s.remove(a, b);
		lastEnd = t.node.end;
	}
}

export function duplicate(doc: SvelteDoc, s: MagicString, targets: Located<ElementLike>[]) {
	for (const t of targets) {
		const text = doc.source.slice(t.node.start, t.node.end);
		const sep = doc.startsLine(t.node.start) ? `\n${doc.indentAt(t.node.start)}` : ' ';
		s.appendLeft(t.node.end, sep + text);
	}
}

/** Inserts markup as the `index`-th element child of `parent` (or of the file's root markup). */
/** Children that count for insertion indexes (not whitespace), minus a layer being moved away. */
export function insertionChildren(doc: SvelteDoc, parent: ElementLike | null, skip?: ElementLike) {
	const fragment = parent ? parent.fragment : doc.ast.fragment;
	return fragment.nodes.filter((n) => (n.type !== 'Text' || n.data.trim() !== '') && n !== skip);
}

export function insert(doc: SvelteDoc, s: MagicString, parent: ElementLike | null, index: number, markup: string, skip?: ElementLike) {
	const unit = doc.indentUnit();
	const children = insertionChildren(doc, parent, skip);
	const at = index < 0 || index > children.length ? children.length : index;

	if (parent && doc.isSelfClosing(parent)) {
		if (parent.type !== 'RegularElement' || /^(img|input|br|hr|meta|link|source|area|col|embed|track|wbr)$/.test(parent.name)) {
			throw new EditError(`<${parent.name}> can't have children`);
		}
		const base = doc.indentAt(parent.start);
		const openEnd = doc.openTagEnd(parent);
		const openTag = doc.source.slice(parent.start, openEnd).replace(/\s*\/>$/, '>');
		s.overwrite(parent.start, parent.end, `${openTag}\n${base}${unit}${reindent(markup, unit, 1)}\n${base}</${parent.name}>`);
		return;
	}

	if (children.length === 0) {
		if (!parent) {
			s.append(`\n${markup}\n`);
			return;
		}
		const base = doc.indentAt(parent.start);
		const start = doc.openTagEnd(parent);
		const end = doc.closeTagStart(parent);
		const content = `\n${base}${unit}${markup.split('\n').join(`\n${base}${unit}`)}\n${base}`;
		if (start === end) s.appendLeft(start, content);
		else s.overwrite(start, end, content);
		return;
	}

	const anchor = at === 0 ? children[0] : children[at - 1];
	const indent = doc.startsLine(anchor.start) ? doc.indentAt(anchor.start) : parent ? doc.indentAt(parent.start) + unit : '';
	const block = markup
		.split('\n')
		.map((line, i) => (i === 0 ? line : indent + line))
		.join('\n');
	if (at === 0) s.appendRight(anchor.start, `${block}\n${indent}`);
	else s.appendLeft(anchor.end, `\n${indent}${block}`);
}

/** Moves an element to another position (same file). */
export function move(doc: SvelteDoc, s: MagicString, target: Located<ElementLike>, parent: ElementLike | null, index: number) {
	// `index` counts the parent's children without the moved layer.
	if (parent && containsNode(target.node, parent)) {
		throw new EditError("Can't move a layer inside itself");
	}
	const text = doc.source.slice(target.node.start, target.node.end);
	const firstLine = text.split('\n')[0];
	const rest = text.slice(firstLine.length);
	const baseIndent = doc.indentAt(target.node.start);
	// Normalize the moved markup to zero base indentation before inserting.
	const normalized = firstLine + rest.replace(new RegExp(`\n${baseIndent}`, 'g'), '\n');
	remove(doc, s, [target]);
	insert(doc, s, parent, index, normalized, target.node);
}

function containsNode(outer: ElementLike, inner: ElementLike): boolean {
	return inner.start >= outer.start && inner.end <= outer.end;
}

export { isElementLike };
