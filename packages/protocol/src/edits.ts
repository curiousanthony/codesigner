import type { SourceLoc } from './bridge.js';

/**
 * Source edits requested by the editor. Elements are addressed by the start
 * location of their opening tag, exactly as Svelte's `__svelte_meta.loc`
 * reports it (file relative to the working copy, 1-based line, 0-based column).
 */
export type EditOp =
	| {
			type: 'classes';
			target: SourceLoc;
			/** Classes to remove (exact tokens, including variants such as `md:gap-4`). */
			remove: string[];
			/** Classes to add after removal. */
			add: string[];
	  }
	| { type: 'text'; target: SourceLoc; text: string }
	| {
			type: 'attribute';
			target: SourceLoc;
			name: string;
			/** null removes the attribute; true writes a bare boolean attribute. */
			value: string | number | boolean | null;
			/** "expression" writes name={value}; "string" writes name="value". */
			kind?: 'string' | 'expression';
	  }
	| { type: 'wrap'; targets: SourceLoc[]; tag: string; className: string }
	| { type: 'unwrap'; target: SourceLoc }
	| {
			type: 'insert';
			parent: SourceLoc | { file: string; root: true };
			/** Child index among element/component siblings; -1 appends. */
			index: number;
			markup: string;
	  }
	| { type: 'remove'; targets: SourceLoc[] }
	| { type: 'duplicate'; targets: SourceLoc[] }
	| { type: 'move'; target: SourceLoc; parent: SourceLoc; index: number }
	| { type: 'rename-tag'; target: SourceLoc; tag: string };

export interface EditRequest {
	/** Human label used for undo history and checkpoint commits, e.g. "Change gap". */
	label: string;
	ops: EditOp[];
	/** Coalesce with the previous history entry when the label and targets match (e.g. scrubbing). */
	coalesce?: boolean;
}

export interface FileChange {
	file: string;
	before: string;
	after: string;
}

export interface EditResult {
	ok: boolean;
	changes: FileChange[];
	/** Where each target ended up after the edit, keyed by the input loc "file:line:column". */
	relocated?: Record<string, SourceLoc>;
	error?: string;
	warnings?: string[];
}

export const locKey = (loc: SourceLoc) => `${loc.file}:${loc.line}:${loc.column}`;

/** What the source says about one element (for the properties panel). */
export interface ElementSource {
	file: string;
	tag: string;
	isComponent: boolean;
	attributes: SourceAttribute[];
	/** How the class attribute is written: static string, cn() call, mixed, … */
	classForm: 'none' | 'boolean' | 'static' | 'mixed' | 'literal' | 'call' | 'array' | 'template' | 'expression';
	/** Unconditional static class tokens (editable). */
	staticClasses: string[];
	/** Source of conditional/dynamic class parts (read-only "states"). */
	dynamicClasses: string[];
	/** Static text content when the element only contains text, else null. */
	text: string | null;
	selfClosing: boolean;
	/** Number of direct element children. */
	childCount: number;
}

export interface SourceAttribute {
	name: string;
	kind: 'string' | 'expression' | 'boolean' | 'spread' | 'directive';
	/** String value, expression source, or "true". */
	value: string;
}
