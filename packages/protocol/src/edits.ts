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
			/** Insert next to this layer instead (its enclosing child of `parent`); wins over `index`. */
			anchor?: { target: SourceLoc; position: 'before' | 'after' };
			/** Imports the markup needs (a component dropped from Assets), added to the script when missing. */
			imports?: ImportSpec[];
	  }
	| { type: 'remove'; targets: SourceLoc[] }
	| { type: 'duplicate'; targets: SourceLoc[] }
	| {
			type: 'move';
			target: SourceLoc;
			parent: SourceLoc;
			index: number;
			/** Move next to this sibling instead (as for `insert`); wins over `index`. */
			anchor?: { target: SourceLoc; position: 'before' | 'after' };
	  }
	| { type: 'rename-tag'; target: SourceLoc; tag: string }
	| {
			/** Classes of one variant combination of a tv() component (edits that variant's own entry). */
			type: 'variant-classes';
			file: string;
			/** Variant values, e.g. { variant: 'destructive', size: 'sm' }; missing axes use defaultVariants. */
			context: Record<string, string>;
			remove: string[];
			add: string[];
	  }
	| { type: 'add-variant'; file: string; axis: string; value: string; copyFrom?: string };

/** `import { Button } …`, `import * as Card …` or `import NavItem …` for markup that uses a component. */
export interface ImportSpec {
	kind: 'named' | 'namespace' | 'default';
	/** Name used in the markup (`Button`, `Card`, `NavItem`). */
	local: string;
	/** Exported name when it differs from `local` (named imports only). */
	imported?: string;
	from: string;
}

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
	/** Opening tag of each layer created by `insert` ops (and moved by `move` ops), in order. */
	created?: SourceLoc[];
	error?: string;
	warnings?: string[];
}

/** A whole-file write from the code panel. */
export interface CodeWriteRequest {
	file: string;
	content: string;
	/** The text the code panel started editing from; the write is refused if the file has changed since. */
	base?: string;
}

export interface CodeWriteResult {
	ok: boolean;
	changes: FileChange[];
	/** The file changed on disk since `base`: `current` holds its text. */
	conflict?: boolean;
	current?: string;
	/** Invalid Svelte: nothing was written. */
	error?: string;
	errorLine?: number;
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
