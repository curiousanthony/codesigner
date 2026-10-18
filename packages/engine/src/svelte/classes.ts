import type MagicString from 'magic-string';
import type { AST } from 'svelte/compiler';
import type { SvelteDoc, ElementLike } from './doc.js';
import { splitVariants, type TailwindEngine } from '../tailwind.js';

type Expr = { type: string; start: number; end: number; [key: string]: unknown };

/** A run of static class text we can edit: an attribute Text node or a string literal's contents. */
export interface ClassChunk {
	start: number;
	end: number;
	raw: string;
	kind: 'text' | 'literal';
	/** Quote character for literals (', " or `). */
	quote?: string;
	/** True when the chunk only applies under a condition (`cond && 'x'`, ternaries, object keys). */
	conditional: boolean;
	/** In mixed attributes: whether an expression directly precedes/follows this chunk. */
	prevIsExpr: boolean;
	nextIsExpr: boolean;
}

export type ClassForm = 'none' | 'boolean' | 'static' | 'mixed' | 'literal' | 'call' | 'array' | 'template' | 'expression';

export interface ClassModel {
	attr: AST.Attribute | null;
	form: ClassForm;
	chunks: ClassChunk[];
	/** The expression node for call/array/expression forms. */
	expression: Expr | null;
	/** Source text of dynamic parts, shown as read-only "states" in the UI. */
	dynamicParts: string[];
}

const classAttribute = (node: ElementLike): AST.Attribute | null =>
	(node.attributes.find((a) => a.type === 'Attribute' && a.name === 'class') as AST.Attribute | undefined) ?? null;

function literalChunk(src: string, lit: Expr, conditional: boolean): ClassChunk | null {
	if (lit.type === 'Literal' && typeof lit.value === 'string') {
		return {
			start: lit.start + 1,
			end: lit.end - 1,
			raw: src.slice(lit.start + 1, lit.end - 1),
			kind: 'literal',
			quote: src[lit.start],
			conditional,
			prevIsExpr: false,
			nextIsExpr: false
		};
	}
	if (lit.type === 'TemplateLiteral' && (lit.expressions as Expr[]).length === 0) {
		return {
			start: lit.start + 1,
			end: lit.end - 1,
			raw: src.slice(lit.start + 1, lit.end - 1),
			kind: 'literal',
			quote: '`',
			conditional,
			prevIsExpr: false,
			nextIsExpr: false
		};
	}
	return null;
}

/** Collects string chunks from clsx-style values: strings, arrays, conditionals, objects. */
function collectClsx(src: string, node: Expr, conditional: boolean, chunks: ClassChunk[], dynamic: string[]) {
	const direct = literalChunk(src, node, conditional);
	if (direct) {
		chunks.push(direct);
		return;
	}
	switch (node.type) {
		case 'ArrayExpression':
			for (const el of (node.elements as (Expr | null)[]) ?? []) if (el) collectClsx(src, el, conditional, chunks, dynamic);
			return;
		case 'LogicalExpression':
			dynamic.push(src.slice(node.start, node.end));
			collectClsx(src, node.right as Expr, true, chunks, dynamic);
			return;
		case 'ConditionalExpression':
			dynamic.push(src.slice(node.start, node.end));
			collectClsx(src, node.consequent as Expr, true, chunks, dynamic);
			collectClsx(src, node.alternate as Expr, true, chunks, dynamic);
			return;
		case 'ObjectExpression':
			dynamic.push(src.slice(node.start, node.end));
			for (const prop of (node.properties as Expr[]) ?? []) {
				const key = prop.key as Expr | undefined;
				if (key) {
					const chunk = literalChunk(src, key, true);
					if (chunk) chunks.push(chunk);
				}
			}
			return;
		default:
			dynamic.push(src.slice(node.start, node.end));
	}
}

export function analyzeClass(doc: SvelteDoc, node: ElementLike): ClassModel {
	const src = doc.source;
	const attr = classAttribute(node);
	if (!attr) return { attr: null, form: 'none', chunks: [], expression: null, dynamicParts: [] };
	if (attr.value === true) return { attr, form: 'boolean', chunks: [], expression: null, dynamicParts: [] };

	if (Array.isArray(attr.value)) {
		const parts = attr.value as (AST.Text | AST.ExpressionTag)[];
		const chunks: ClassChunk[] = [];
		const dynamic: string[] = [];
		parts.forEach((part, i) => {
			if (part.type === 'Text') {
				chunks.push({
					start: part.start,
					end: part.end,
					raw: src.slice(part.start, part.end),
					kind: 'text',
					conditional: false,
					prevIsExpr: parts[i - 1]?.type === 'ExpressionTag',
					nextIsExpr: parts[i + 1]?.type === 'ExpressionTag'
				});
			} else {
				collectClsx(src, part.expression as unknown as Expr, true, chunks, dynamic);
			}
		});
		const quotedEmpty = parts.length === 0;
		if (quotedEmpty) {
			// class="" — an empty Text range right after the opening quote.
			const valueStart = src.indexOf('"', attr.start) + 1 || src.indexOf("'", attr.start) + 1;
			chunks.push({ start: valueStart, end: valueStart, raw: '', kind: 'text', conditional: false, prevIsExpr: false, nextIsExpr: false });
		}
		const hasExpr = parts.some((p) => p.type === 'ExpressionTag');
		return { attr, form: hasExpr ? 'mixed' : 'static', chunks, expression: null, dynamicParts: dynamic };
	}

	const expression = (attr.value as AST.ExpressionTag).expression as unknown as Expr;
	const chunks: ClassChunk[] = [];
	const dynamic: string[] = [];
	if (expression.type === 'Literal' || (expression.type === 'TemplateLiteral' && (expression.expressions as Expr[]).length === 0)) {
		const chunk = literalChunk(src, expression, false);
		if (chunk) chunks.push(chunk);
		return { attr, form: 'literal', chunks, expression, dynamicParts: [] };
	}
	if (expression.type === 'TemplateLiteral') {
		const quasis = expression.quasis as Expr[];
		quasis.forEach((q, i) => {
			chunks.push({
				start: q.start,
				end: q.end,
				raw: src.slice(q.start, q.end),
				kind: 'literal',
				quote: '`',
				conditional: false,
				prevIsExpr: i > 0,
				nextIsExpr: i < quasis.length - 1
			});
		});
		for (const e of expression.expressions as Expr[]) dynamic.push(src.slice(e.start, e.end));
		return { attr, form: 'template', chunks, expression, dynamicParts: dynamic };
	}
	if (expression.type === 'CallExpression') {
		for (const arg of expression.arguments as Expr[]) collectClsx(src, arg, false, chunks, dynamic);
		return { attr, form: 'call', chunks, expression, dynamicParts: dynamic };
	}
	if (expression.type === 'ArrayExpression') {
		collectClsx(src, expression, false, chunks, dynamic);
		return { attr, form: 'array', chunks, expression, dynamicParts: dynamic };
	}
	dynamic.push(src.slice(expression.start, expression.end));
	return { attr, form: 'expression', chunks, expression, dynamicParts: dynamic };
}

/** Static, unconditional class tokens (what the style panel can edit). */
export function staticTokens(model: ClassModel): string[] {
	return model.chunks.filter((c) => !c.conditional).flatMap((c) => c.raw.split(/\s+/).filter(Boolean));
}

interface Piece {
	tok: string;
	ws: string;
}

function toPieces(raw: string): { lead: string; pieces: Piece[] } {
	const lead = raw.match(/^\s*/)![0];
	const pieces: Piece[] = [];
	const re = /(\S+)(\s*)/g;
	re.lastIndex = lead.length;
	let m: RegExpExecArray | null;
	while ((m = re.exec(raw))) pieces.push({ tok: m[1], ws: m[2] });
	return { lead, pieces };
}

const fromPieces = (lead: string, pieces: Piece[]) => lead + pieces.map((p) => p.tok + p.ws).join('');

function removePiece(pieces: Piece[], index: number) {
	const [removed] = pieces.splice(index, 1);
	// Keep the trailing whitespace of the chunk (matters next to expressions / before the quote).
	if (index === pieces.length && pieces.length > 0) pieces[pieces.length - 1].ws = removed.ws;
}

function insertPiece(pieces: Piece[], index: number, tok: string) {
	if (index >= pieces.length) {
		if (pieces.length === 0) {
			pieces.push({ tok, ws: '' });
			return;
		}
		const last = pieces[pieces.length - 1];
		pieces.push({ tok, ws: last.ws });
		last.ws = last.ws.includes('\n') ? last.ws : ' ';
		if (last.ws === '') last.ws = ' ';
		return;
	}
	pieces.splice(index, 0, { tok, ws: ' ' });
}

export interface ClassEditResult {
	warnings: string[];
	removed: string[];
	added: string[];
}

/**
 * Removes `remove` (plus anything `add` overrides) and adds `add`, editing only
 * static class text. Replacements happen in place; new tokens go in canonical
 * Tailwind order.
 */
export function editClasses(
	doc: SvelteDoc,
	s: MagicString,
	node: ElementLike,
	op: { remove: string[]; add: string[] },
	tw: TailwindEngine | null
): ClassEditResult {
	const model = analyzeClass(doc, node);
	const warnings: string[] = [];
	const add = [...new Set(op.add.map((c) => (tw ? tw.canonicalize(c) : c)))];
	for (const c of add) if (tw && !tw.isValid(c)) warnings.push(`"${c}" is not a Tailwind class in this project`);

	const existing = staticTokens(model);
	const conflicts = tw ? tw.conflicts(existing, add) : [];
	const removeSet = new Set([...op.remove, ...conflicts].filter((t) => !add.includes(t)));
	const toAdd = add.filter((t) => !existing.includes(t));
	const placed = new Set<string>();
	const removedTokens: string[] = [];

	const editable = model.chunks.filter((c) => !c.conditional);
	const results = new Map<ClassChunk, string>();

	for (const chunk of editable) {
		const { lead, pieces } = toPieces(chunk.raw);
		let changed = false;
		for (let i = pieces.length - 1; i >= 0; i--) {
			const tok = pieces[i].tok;
			if (!removeSet.has(tok)) continue;
			// Replace in place when one of the added tokens overrides this one.
			const replacement = toAdd.find((a) => !placed.has(a) && splitVariants(a).variants === splitVariants(tok).variants);
			removedTokens.push(tok);
			if (replacement && (tw ? tw.conflicts([tok], [replacement]).length > 0 : true)) {
				pieces[i].tok = replacement;
				placed.add(replacement);
			} else {
				removePiece(pieces, i);
			}
			changed = true;
		}
		if (changed) results.set(chunk, fromPieces(lead, pieces));
	}

	for (const t of removeSet) {
		if (!removedTokens.includes(t) && op.remove.includes(t)) {
			const inDynamic = model.chunks.some((c) => c.conditional && c.raw.split(/\s+/).includes(t));
			if (inDynamic) warnings.push(`"${t}" is applied conditionally and was left unchanged`);
		}
	}

	const remaining = toAdd.filter((t) => !placed.has(t));
	if (remaining.length) {
		const primary = pickPrimary(model, editable);
		if (primary) {
			const current = results.get(primary) ?? primary.raw;
			const { lead, pieces } = toPieces(current);
			if (primary.quote && remaining.some((t) => t.includes(primary.quote!))) {
				warnings.push(`Can't add a class containing ${primary.quote} inside this string`);
			} else {
				const order = tw?.order([...pieces.map((p) => p.tok), ...remaining]);
				for (const tok of remaining) {
					const mine = order?.get(tok) ?? null;
					let index = pieces.length;
					if (mine !== null && order) {
						const at = pieces.findIndex((p) => {
							const theirs = order.get(p.tok);
							return theirs !== null && theirs !== undefined && theirs > mine;
						});
						if (at >= 0) index = at;
					}
					insertPiece(pieces, index, tok);
				}
				let next = fromPieces(lead, pieces);
				if (primary.nextIsExpr && !/\s$/.test(next)) next += ' ';
				if (primary.prevIsExpr && !/^\s/.test(next)) next = ' ' + next;
				results.set(primary, next);
			}
		} else {
			insertNewClassSource(doc, s, node, model, remaining);
		}
	}

	for (const [chunk, next] of results) {
		if (next === chunk.raw) continue;
		if (chunk.start === chunk.end) s.appendLeft(chunk.start, next);
		else s.overwrite(chunk.start, chunk.end, next);
	}

	return { warnings, removed: removedTokens, added: toAdd };
}

/** Where new classes go: the main static run of the attribute. */
function pickPrimary(model: ClassModel, editable: ClassChunk[]): ClassChunk | null {
	if (editable.length === 0) return null;
	if (model.form === 'mixed' || model.form === 'template') {
		// Prefer the first chunk with real tokens, otherwise the first one not squeezed between expressions.
		return (
			editable.find((c) => c.raw.trim().length > 0) ??
			editable.find((c) => !(c.prevIsExpr && c.nextIsExpr)) ??
			editable[0]
		);
	}
	return editable[0];
}

function preferredQuote(src: string): string {
	const single = (src.match(/'[^'\n]*'/g) ?? []).length;
	const double = (src.match(/"[^"\n]*"/g) ?? []).length;
	return single >= double ? "'" : '"';
}

/** No editable string exists: add a class attribute, a cn() argument, or wrap the expression. */
function insertNewClassSource(doc: SvelteDoc, s: MagicString, node: ElementLike, model: ClassModel, tokens: string[]) {
	const src = doc.source;
	const value = tokens.join(' ');
	if (model.form === 'none') {
		const attrs = node.attributes;
		const at = attrs.length ? attrs[attrs.length - 1].end : node.start + 1 + node.name.length;
		s.appendLeft(at, ` class="${value}"`);
		return;
	}
	if (model.form === 'boolean' && model.attr) {
		s.overwrite(model.attr.start, model.attr.end, `class="${value}"`);
		return;
	}
	const expr = model.expression;
	if (!expr) return;
	const q = preferredQuote(src);
	if (model.form === 'call') {
		const args = expr.arguments as Expr[];
		if (args.length) s.appendLeft(args[args.length - 1].end, `, ${q}${value}${q}`);
		else s.appendLeft(expr.end - 1, `${q}${value}${q}`);
		return;
	}
	if (model.form === 'array') {
		const elements = (expr.elements as (Expr | null)[]).filter(Boolean) as Expr[];
		if (elements.length) s.appendLeft(elements[elements.length - 1].end, `, ${q}${value}${q}`);
		else s.appendLeft(expr.end - 1, `${q}${value}${q}`);
		return;
	}
	// Plain expression (`class={className}`): wrap it so both apply.
	const usesCn = /\bimport\s*\{[^}]*\bcn\b[^}]*\}/.test(src);
	const inner = src.slice(expr.start, expr.end);
	s.overwrite(expr.start, expr.end, usesCn ? `cn(${inner}, ${q}${value}${q})` : `[${inner}, ${q}${value}${q}]`);
}
