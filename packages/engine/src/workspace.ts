import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import MagicString from 'magic-string';
import { parse } from 'svelte/compiler';
import type {
	CodeWriteRequest,
	CodeWriteResult,
	ComponentInfo,
	DesignTokens,
	EditOp,
	EditRequest,
	EditResult,
	ElementSource,
	FileChange,
	SourceAttribute,
	SourceLoc,
	TokenEdit
} from '@codesigner/protocol';
import { locKey } from '@codesigner/protocol';
import { SvelteDoc, type ElementLike, type Located } from './svelte/doc.js';
import { ensureImport } from './svelte/imports.js';
import { analyzeClass, editClasses, staticTokens } from './svelte/classes.js';
import { EditError, duplicate, insert, insertionChildren, move, remove, renameTag, setAttribute, setText, unwrap, wrap } from './svelte/structure.js';
import { TailwindEngine } from './tailwind.js';
import { addVariantValue, editVariantClasses } from './svelte/variants.js';
import { applyTokenEdit, parseTokens } from './tokens.js';
import { scanComponents } from './components.js';
import { detectProject } from './project.js';

/** Maps an offset from `before` to `after` when it lies in their common prefix or suffix. */
export function mapOffset(before: string, after: string, offset: number): number | null {
	let prefix = 0;
	const max = Math.min(before.length, after.length);
	while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
	let suffix = 0;
	while (
		suffix < max - prefix &&
		before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
	)
		suffix++;
	if (offset < prefix) return offset;
	if (offset >= before.length - suffix) return offset + (after.length - before.length);
	return null;
}

const hash = (text: string) => createHash('sha1').update(text).digest('hex');

interface JournalEntry {
	label: string;
	changes: FileChange[];
	at: number;
	coalesceKey?: string;
}

/** Previous texts we wrote, so locations reported by a page that hasn't hot-reloaded yet still resolve. */
const HISTORY_DEPTH = 6;

/**
 * One working copy (main checkout or design worktree). Applies semantic edit
 * operations to source files with byte-range precision and keeps an undo journal.
 */
export class Workspace {
	readonly tailwind: TailwindEngine;
	private undoStack: JournalEntry[] = [];
	private redoStack: JournalEntry[] = [];
	private history = new Map<string, string[]>();
	private cssEntry: string | null;
	private libAlias: '$lib' | '#lib';

	constructor(readonly root: string) {
		let cssEntry: string | null = null;
		let libAlias: '$lib' | '#lib' = '$lib';
		try {
			const project = detectProject(root);
			cssEntry = project.cssEntry;
			libAlias = project.kit.libAlias;
		} catch {
			// not a SvelteKit project; source editing still works
		}
		this.cssEntry = cssEntry;
		this.libAlias = libAlias;
		this.tailwind = new TailwindEngine(root, cssEntry);
	}

	private abs(file: string): string {
		const full = resolve(this.root, file);
		if (full !== this.root && !full.startsWith(this.root + sep)) throw new EditError(`${file} is outside the project`);
		return full;
	}

	read(file: string): string {
		return readFileSync(this.abs(file), 'utf8');
	}

	private write(file: string, text: string) {
		const prev = this.read(file);
		const versions = this.history.get(file) ?? [];
		versions.unshift(prev);
		this.history.set(file, versions.slice(0, HISTORY_DEPTH));
		// In-place write: rename-based atomic writes can make Vite treat it as unlink + add (full reload).
		writeFileSync(this.abs(file), text);
		if (this.cssEntry && file === this.cssEntry) this.tailwind.invalidate();
	}

	/**
	 * Locates the element at `loc` in the current text. If the page is still
	 * showing an older version (HMR in flight), resolve it there and follow the
	 * same tree path into the current version.
	 */
	locate(doc: SvelteDoc, loc: SourceLoc): Located<ElementLike> {
		const expectedTag = loc.tag;
		const direct = doc.elementAtLoc(loc.line, loc.column);
		if (direct && (!expectedTag || direct.node.name === expectedTag)) return direct;
		for (const old of this.history.get(loc.file) ?? []) {
			try {
				const prev = new SvelteDoc(old);
				const then = prev.elementAtLoc(loc.line, loc.column);
				if (!then || (expectedTag && then.node.name !== expectedTag)) continue;
				// 1) The element sits outside the changed region: shift its offset.
				const mapped = mapOffset(old, doc.source, then.node.start);
				const byOffset = mapped === null ? null : doc.elementAt(mapped);
				if (byOffset && byOffset.node.name === then.node.name) return byOffset;
				// 2) Same tree position (edits that didn't change structure).
				const now = doc.nodeAtPath(then.path);
				if (now && 'name' in now.node && now.node.name === then.node.name) return now as Located<ElementLike>;
			} catch {
				// unparsable historical version
			}
		}
		if (direct && !expectedTag) return direct;
		throw new EditError(`Couldn't find the layer at ${loc.file}:${loc.line}:${loc.column + 1}. The file may have changed; reselect it.`);
	}

	private targetsOf(op: EditOp): SourceLoc[] {
		switch (op.type) {
			case 'wrap':
			case 'remove':
			case 'duplicate':
				return op.targets;
			case 'insert':
				return [...('root' in op.parent ? [] : [op.parent]), ...(op.anchor ? [op.anchor.target] : [])];
			case 'move':
				return [op.target, op.parent, ...(op.anchor ? [op.anchor.target] : [])];
			case 'variant-classes':
			case 'add-variant':
				return [];
			default:
				return [op.target];
		}
	}

	private fileOf(op: EditOp): string {
		if (op.type === 'insert') return op.parent.file;
		if (op.type === 'variant-classes' || op.type === 'add-variant') return op.file;
		const targets = this.targetsOf(op);
		const files = new Set(targets.map((t) => t.file));
		if (files.size !== 1) throw new EditError('All layers in one edit must come from the same file');
		return targets[0].file;
	}

	/** Index among `parent`'s children for an insert/move next to `anchor` (its enclosing child: it may sit in an {#if}/{#each}). */
	private anchorIndex(doc: SvelteDoc, parent: ElementLike | null, index: number, anchor: { target: SourceLoc; position: 'before' | 'after' } | undefined, skip?: ElementLike): number {
		if (!anchor) return index;
		const node = this.locate(doc, anchor.target).node;
		const at = insertionChildren(doc, parent, skip).findIndex((n) => n.start <= node.start && node.end <= n.end);
		return at < 0 ? index : anchor.position === 'before' ? at : at + 1;
	}

	/** Applies one operation to `doc`, returning the new text. */
	private async applyOp(doc: SvelteDoc, op: EditOp, warnings: string[]): Promise<string> {
		const s = new MagicString(doc.source);
		switch (op.type) {
			case 'classes': {
				const tw = (await this.tailwind.load()) ? this.tailwind : null;
				const target = this.locate(doc, op.target);
				const result = editClasses(doc, s, target.node, { remove: op.remove, add: op.add }, tw);
				warnings.push(...result.warnings);
				break;
			}
			case 'variant-classes': {
				const tw = (await this.tailwind.load()) ? this.tailwind : null;
				warnings.push(...editVariantClasses(doc, s, op, tw).warnings);
				break;
			}
			case 'add-variant':
				addVariantValue(doc, s, op.axis, op.value, op.copyFrom);
				break;
			case 'text':
				setText(doc, s, this.locate(doc, op.target).node, op.text);
				break;
			case 'attribute': {
				const warning = setAttribute(doc, s, this.locate(doc, op.target).node, op.name, op.value, op.kind);
				if (warning) warnings.push(warning);
				break;
			}
			case 'wrap':
				wrap(doc, s, op.targets.map((t) => this.locate(doc, t)), op.tag, op.className);
				break;
			case 'unwrap':
				unwrap(doc, s, this.locate(doc, op.target).node);
				break;
			case 'insert': {
				const parent = 'root' in op.parent ? null : this.locate(doc, op.parent).node;
				insert(doc, s, parent, this.anchorIndex(doc, parent, op.index, op.anchor), op.markup);
				break;
			}
			case 'remove':
				remove(doc, s, op.targets.map((t) => this.locate(doc, t)));
				break;
			case 'duplicate':
				duplicate(doc, s, op.targets.map((t) => this.locate(doc, t)));
				break;
			case 'move': {
				const target = this.locate(doc, op.target);
				const parent = this.locate(doc, op.parent).node;
				move(doc, s, target, parent, this.anchorIndex(doc, parent, op.index, op.anchor, target.node));
				break;
			}
			case 'rename-tag':
				renameTag(doc, s, this.locate(doc, op.target).node, op.tag);
				break;
		}
		const next = s.toString();
		// Never write a file Svelte can't parse.
		try {
			new SvelteDoc(next);
		} catch (error) {
			throw new EditError(`This edit would produce invalid Svelte (${(error as Error).message.split('\n')[0]})`);
		}
		return next;
	}

	async apply(request: EditRequest): Promise<EditResult> {
		const warnings: string[] = [];
		const created: SourceLoc[] = [];
		const texts = new Map<string, { before: string; current: string }>();
		try {
			for (const op of request.ops) {
				const file = this.fileOf(op);
				if (!file.endsWith('.svelte')) throw new EditError(`Only .svelte files can be edited visually (${file})`);
				const entry = texts.get(file) ?? { before: this.read(file), current: this.read(file) };
				const previous = entry.current;
				entry.current = await this.applyOp(new SvelteDoc(entry.current), op, warnings);
				if (op.type === 'insert') {
					let loc = insertedAt(file, previous, entry.current, op.markup);
					if (op.imports?.length) {
						// Imports go in after locating the markup (the script usually sits above it, shifting lines).
						const before = entry.current;
						const doc = new SvelteDoc(before);
						const s = new MagicString(before);
						for (const spec of op.imports) ensureImport(doc, s, spec);
						entry.current = s.toString();
						const at = doc.offsetOf(loc.line, loc.column);
						let changedAt = 0;
						while (changedAt < before.length && before[changedAt] === entry.current[changedAt]) changedAt++;
						if (changedAt <= at) loc = { ...loc, line: loc.line + entry.current.split('\n').length - before.split('\n').length };
					}
					created.push(loc);
				}
				if (op.type === 'move') created.push(insertedAt(file, previous, entry.current, previous.split('\n')[op.target.line - 1].slice(op.target.column)));
				texts.set(file, entry);
			}
		} catch (error) {
			return { ok: false, changes: [], error: (error as Error).message, warnings };
		}

		const changes: FileChange[] = [];
		for (const [file, { before, current }] of texts) {
			if (before === current) continue;
			this.write(file, current);
			changes.push({ file, before, after: current });
		}
		if (changes.length) this.record(request, changes);
		return { ok: true, changes, warnings, ...(created.length ? { created } : {}) };
	}

	/**
	 * Writes a whole file typed in the code panel. Journaled like visual edits
	 * (consecutive saves of one file coalesce into one undo step). Invalid
	 * Svelte is refused so a half-typed tag never reaches the dev server.
	 */
	writeText({ file, content, base }: CodeWriteRequest): CodeWriteResult {
		const current = this.read(file);
		if (base !== undefined && current !== base) return { ok: false, changes: [], conflict: true, current };
		if (current === content) return { ok: true, changes: [] };
		if (file.endsWith('.svelte')) {
			try {
				parse(content, { modern: true, filename: file });
			} catch (error) {
				const e = error as Error & { start?: { line: number } };
				return { ok: false, changes: [], error: e.message.split('\n')[0], errorLine: e.start?.line };
			}
		}
		this.write(file, content);
		const change = { file, before: current, after: content };
		this.record({ label: 'Edit code', ops: [], coalesce: true }, [change], `code|${file}`);
		return { ok: true, changes: [change] };
	}

	private record(request: EditRequest, changes: FileChange[], key?: string) {
		const coalesceKey = request.coalesce
			? (key ?? `${request.label}|${request.ops.flatMap((op) => this.targetsOf(op).map(locKey)).join(',')}`)
			: undefined;
		const last = this.undoStack.at(-1);
		if (coalesceKey && last?.coalesceKey === coalesceKey && Date.now() - last.at < 4000) {
			// Merge with the previous entry: keep its "before", take our "after".
			for (const change of changes) {
				const existing = last.changes.find((c) => c.file === change.file);
				if (existing) existing.after = change.after;
				else last.changes.push(change);
			}
			last.at = Date.now();
			// Typing then undoing in the code panel can net out to nothing: drop the empty step.
			last.changes = last.changes.filter((c) => c.before !== c.after);
			if (last.changes.length === 0) this.undoStack.pop();
		} else {
			this.undoStack.push({ label: request.label, changes, at: Date.now(), coalesceKey });
			if (this.undoStack.length > 200) this.undoStack.shift();
		}
		this.redoStack = [];
	}

	get canUndo() {
		return this.undoStack.length > 0;
	}

	get canRedo() {
		return this.redoStack.length > 0;
	}

	private swap(entry: JournalEntry, direction: 'undo' | 'redo'): FileChange[] {
		const applied: FileChange[] = [];
		for (const change of entry.changes) {
			const expected = direction === 'undo' ? change.after : change.before;
			const target = direction === 'undo' ? change.before : change.after;
			const current = this.read(change.file);
			if (hash(current) !== hash(expected)) {
				throw new EditError(`${change.file} changed outside Codesigner since this edit; ${direction} isn't safe`);
			}
			applied.push({ file: change.file, before: current, after: target });
		}
		for (const change of applied) this.write(change.file, change.after);
		return applied;
	}

	undo(): FileChange[] | null {
		const entry = this.undoStack.pop();
		if (!entry) return null;
		try {
			const applied = this.swap(entry, 'undo');
			this.redoStack.push(entry);
			return applied;
		} catch (error) {
			this.undoStack.push(entry);
			throw error;
		}
	}

	redo(): FileChange[] | null {
		const entry = this.redoStack.pop();
		if (!entry) return null;
		try {
			const applied = this.swap(entry, 'redo');
			this.undoStack.push(entry);
			return applied;
		} catch (error) {
			this.redoStack.push(entry);
			throw error;
		}
	}

	/** Describes an element's source: attributes, class form, static text. */
	inspect(loc: SourceLoc): ElementSource | null {
		if (!loc.file.endsWith('.svelte')) return null;
		let doc: SvelteDoc;
		try {
			doc = new SvelteDoc(this.read(loc.file));
		} catch {
			return null;
		}
		let located: Located<ElementLike>;
		try {
			located = this.locate(doc, loc);
		} catch {
			return null;
		}
		const node = located.node;
		const src = doc.source;
		const attributes: SourceAttribute[] = node.attributes.map((attr) => {
			if (attr.type === 'SpreadAttribute') return { name: '...', kind: 'spread', value: src.slice(attr.start, attr.end) };
			if (attr.type !== 'Attribute') {
				const name = 'name' in attr ? String(attr.name) : attr.type;
				return { name: `${attr.type}:${name}`, kind: 'directive', value: src.slice(attr.start, attr.end) };
			}
			if (attr.value === true) return { name: attr.name, kind: 'boolean', value: 'true' };
			if (Array.isArray(attr.value)) {
				const isStatic = attr.value.every((part) => part.type === 'Text');
				return {
					name: attr.name,
					kind: isStatic ? 'string' : 'expression',
					value: isStatic ? attr.value.map((part) => (part as { data: string }).data).join('') : src.slice(attr.value[0].start, attr.value.at(-1)!.end)
				};
			}
			const expression = attr.value.expression as { type: string; value?: unknown; start: number; end: number };
			if (expression.type === 'Literal' && typeof expression.value === 'string') return { name: attr.name, kind: 'string', value: expression.value };
			return { name: attr.name, kind: 'expression', value: src.slice(expression.start, expression.end) };
		});
		const model = analyzeClass(doc, node);
		const onlyText = node.fragment.nodes.every((n) => n.type === 'Text');
		const textNodes = node.fragment.nodes as { type: string; data?: string }[];
		return {
			file: loc.file,
			tag: node.name,
			isComponent: node.type === 'Component',
			attributes,
			classForm: model.form,
			staticClasses: staticTokens(model),
			dynamicClasses: model.dynamicParts,
			text: onlyText ? textNodes.map((n) => n.data ?? '').join('').trim() : null,
			selfClosing: doc.isSelfClosing(node),
			childCount: node.fragment.nodes.filter((n) => n.type !== 'Text' || (n as { data: string }).data.trim()).length
		};
	}

	// ------------------------------------------------------------ tokens
	readTokens(): DesignTokens {
		if (!this.cssEntry || !existsSync(join(this.root, this.cssEntry))) return { file: null, tokens: [], darkSelector: null };
		return parseTokens(this.read(this.cssEntry), this.cssEntry);
	}

	editToken(edit: TokenEdit): DesignTokens {
		if (!this.cssEntry) throw new EditError('No global stylesheet found for design tokens');
		const before = this.read(this.cssEntry);
		const after = applyTokenEdit(before, edit);
		if (after !== before) {
			this.write(this.cssEntry, after);
			this.record({ label: `Change ${edit.name}`, ops: [], coalesce: false }, [{ file: this.cssEntry, before, after }]);
		}
		return parseTokens(after, this.cssEntry);
	}

	/** CSS for classes that may not be compiled in the page yet (optimistic previews). */
	async previewCss(classes: string[]): Promise<string> {
		await this.tailwind.load();
		return this.tailwind.css(classes);
	}

	components(): ComponentInfo[] {
		return scanComponents(this.root, 'src/lib', this.libAlias);
	}
}

/**
 * Where an insert put its markup. The common prefix of the two texts can run
 * into the new markup when a sibling starts the same way (`<div class="…`),
 * so search for the markup's first line from the earliest place it can start.
 */
function insertedAt(file: string, before: string, after: string, markup: string): SourceLoc {
	let prefix = 0;
	while (prefix < before.length && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
	const added = after.length - before.length;
	const first = markup.split('\n')[0];
	let start = after.indexOf(first, Math.max(0, prefix - Math.abs(added)));
	if (start < 0) start = after.indexOf('<', prefix);
	const lines = after.slice(0, start).split('\n');
	return { file, line: lines.length, column: lines[lines.length - 1].length };
}
