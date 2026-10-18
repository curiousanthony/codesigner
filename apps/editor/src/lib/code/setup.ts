import { history, defaultKeymap, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { bracketMatching, foldGutter, indentOnInput, indentUnit, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { Annotation, Compartment, EditorState, RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
	type DecorationSet
} from '@codemirror/view';
import { svelte } from '@replit/codemirror-lang-svelte';
import { tags as t } from '@lezer/highlight';

export { undo, redo };

/** Marks transactions that load text from disk (they must not trigger a save). */
export const fromDisk = Annotation.define<boolean>();

export function languageFor(file: string): Extension {
	if (file.endsWith('.svelte')) return svelte();
	if (file.endsWith('.css') || file.endsWith('.pcss')) return css();
	if (file.endsWith('.html')) return html();
	if (/\.[cm]?[jt]sx?$/.test(file)) return javascript({ typescript: /\.[cm]?tsx?$/.test(file) });
	return [];
}

// ---------------------------------------------------------------- highlight
/** Lines of the selected layer, shown with the canvas selection colour. */
export const setHighlight = StateEffect.define<{ from: number; to: number; component: boolean } | null>();

const highlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		deco = deco.map(tr.changes);
		for (const effect of tr.effects) {
			if (!effect.is(setHighlight)) continue;
			if (!effect.value) {
				deco = Decoration.none;
				continue;
			}
			const { from, to, component } = effect.value;
			const builder = new RangeSetBuilder<Decoration>();
			const doc = tr.state.doc;
			const first = doc.lineAt(Math.min(from, doc.length)).number;
			const last = doc.lineAt(Math.min(to, doc.length)).number;
			for (let n = first; n <= last; n++) {
				builder.add(doc.line(n).from, doc.line(n).from, Decoration.line({ class: component ? 'cm-cd-selected cm-cd-component' : 'cm-cd-selected' }));
			}
			deco = builder.finish();
		}
		return deco;
	},
	provide: (f) => EditorView.decorations.from(f)
});

// ------------------------------------------------------------------- theme
const theme = EditorView.theme({
	'&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--cd-panel)', color: 'var(--cd-text)' },
	'.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6' },
	'.cm-content': { caretColor: 'var(--cd-accent)', padding: '6px 0' },
	'.cm-gutters': { backgroundColor: 'var(--cd-panel)', color: 'var(--cd-faint)', border: 'none' },
	'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--cd-label)' },
	'.cm-activeLine': { backgroundColor: 'var(--cd-row-hover)' },
	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--cd-accent-tint-strong) !important' },
	'.cm-cursor': { borderLeftColor: 'var(--cd-accent)' },
	'.cm-cd-selected': { backgroundColor: 'var(--cd-accent-tint)', boxShadow: 'inset 2px 0 0 var(--cd-accent)' },
	'.cm-cd-component': { backgroundColor: 'var(--cd-component-tint)', boxShadow: 'inset 2px 0 0 var(--cd-component)' },
	'.cm-foldGutter span': { color: 'var(--cd-faint)' },
	'&.cm-focused': { outline: 'none' },
	'.cm-matchingBracket': { backgroundColor: 'var(--cd-accent-tint-strong)', outline: 'none' }
});

const highlight = HighlightStyle.define([
	{ tag: [t.keyword, t.controlKeyword, t.moduleKeyword], color: '#a626a4' },
	{ tag: [t.tagName], color: '#e45649' },
	{ tag: [t.attributeName, t.propertyName], color: '#986801' },
	{ tag: [t.string, t.special(t.string), t.attributeValue], color: '#50a14f' },
	{ tag: [t.number, t.bool, t.null], color: '#c18401' },
	{ tag: [t.comment], color: 'var(--cd-muted)', fontStyle: 'italic' },
	{ tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#4078f2' },
	{ tag: [t.typeName, t.className], color: '#0184bc' },
	{ tag: [t.brace, t.bracket, t.angleBracket], color: 'var(--cd-label)' }
]);

export const languageSlot = new Compartment();
export const indentSlot = new Compartment();

export function createState(doc: string, file: string, onChange: (state: EditorState, user: boolean) => void): EditorState {
	const tabs = /^\t/m.test(doc) || !/^ {2}/m.test(doc);
	return EditorState.create({
		doc,
		extensions: [
			lineNumbers(),
			highlightActiveLineGutter(),
			foldGutter(),
			history(),
			drawSelection(),
			indentOnInput(),
			bracketMatching(),
			highlightActiveLine(),
			syntaxHighlighting(highlight),
			keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
			languageSlot.of(languageFor(file)),
			indentSlot.of(indentUnit.of(tabs ? '\t' : '  ')),
			EditorState.tabSize.of(4),
			highlightField,
			theme,
			EditorView.updateListener.of((update) => {
				if (!update.docChanged) return;
				const user = update.transactions.some((tr) => !tr.annotation(fromDisk) && tr.docChanged);
				onChange(update.state, user);
			})
		]
	});
}

/**
 * Replaces the document with `next` as a single minimal change (common prefix
 * and suffix kept), so the cursor and scroll position survive reloads.
 */
export function replaceFromDisk(view: EditorView, next: string) {
	const current = view.state.doc.toString();
	if (current === next) return;
	let start = 0;
	const max = Math.min(current.length, next.length);
	while (start < max && current.charCodeAt(start) === next.charCodeAt(start)) start++;
	let end = 0;
	while (end < max - start && current.charCodeAt(current.length - 1 - end) === next.charCodeAt(next.length - 1 - end)) end++;
	view.dispatch({
		changes: { from: start, to: current.length - end, insert: next.slice(start, next.length - end) },
		annotations: [fromDisk.of(true)]
	});
}

/** Offset of a 1-based line / 0-based column. */
export function offsetOf(doc: string, line: number, column: number): number {
	let offset = 0;
	for (let n = 1; n < line; n++) {
		const next = doc.indexOf('\n', offset);
		if (next < 0) return doc.length;
		offset = next + 1;
	}
	return Math.min(doc.length, offset + column);
}

/** End of the opening tag starting at `from` (skips quoted strings and {expressions}). */
export function openTagEnd(doc: string, from: number): number {
	let depth = 0;
	let quote: string | null = null;
	for (let i = from + 1; i < doc.length; i++) {
		const ch = doc[i];
		if (quote) {
			if (ch === quote) quote = null;
		} else if (ch === '"' || ch === "'") quote = depth === 0 ? ch : quote;
		else if (ch === '{') depth++;
		else if (ch === '}') depth--;
		else if (ch === '>' && depth === 0) return i + 1;
	}
	return from;
}
